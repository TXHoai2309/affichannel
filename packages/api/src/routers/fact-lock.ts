import { FactLockError } from "@affichannel/core";
import { env } from "@affichannel/env/server";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../index";
import { resolveTextProvider } from "../providers/text/text-provider-registry";
import {
	executeFactLockRun,
	getFactLockState,
	manualApproveFactLockClaim,
	mutateFactLockClaimSourceAndRefresh,
	prepareFactLockRun,
	resolveServerFactLockConfig,
} from "../services/fact-lock-service";
import { requireWorkspaceActor } from "../services/workspace";

const idSchema = z.string().trim().min(1).max(120);
const runInput = z
	.object({
		projectId: idSchema,
		idempotencyKey: z.string().trim().min(8).max(200),
	})
	.strict();
const resolutionInput = z
	.object({
		projectId: idSchema,
		factLockRunId: idSchema,
		claimId: idSchema,
		scriptVersionId: idSchema,
		baseRevision: z.number().int().positive(),
	})
	.strict();
const approveInput = resolutionInput.extend({
	reviewNote: z.string().trim().max(1_000).nullable().optional(),
});
const editInput = resolutionInput.extend({
	newText: z.string().trim().min(1).max(4_000),
});

function toFactLockOrpcError(error: unknown): never {
	if (!(error instanceof FactLockError)) throw error;
	if (error.code === "FACT_LOCK_NOT_FOUND")
		throw new ORPCError("NOT_FOUND", {
			message: error.code,
			data: { code: error.code },
		});
	if (
		error.code === "FACT_LOCK_ALREADY_PENDING" ||
		error.code === "FACT_LOCK_IDEMPOTENCY_CONFLICT" ||
		error.code === "FACT_LOCK_STALE" ||
		error.code === "FACT_LOCK_CONFLICT" ||
		error.code === "FACT_LOCK_CLAIM_NOT_REVIEWABLE"
	)
		throw new ORPCError("CONFLICT", {
			message: error.code,
			data: { code: error.code, ...error.metadata },
		});
	if (
		error.code === "FACT_LOCK_CLAIM_NOT_FOUND" ||
		error.code === "FACT_LOCK_SCRIPT_VERSION_NOT_FOUND"
	)
		throw new ORPCError("NOT_FOUND", {
			message: error.code,
			data: { code: error.code, ...error.metadata },
		});
	throw new ORPCError("BAD_REQUEST", {
		message: error.code,
		data: { code: error.code, ...error.metadata },
	});
}

export const factLockRouter = {
	run: protectedProcedure
		.input(runInput)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			let run: Awaited<ReturnType<typeof prepareFactLockRun>> | null = null;
			try {
				const config = await resolveServerFactLockConfig(actor);
				run = await prepareFactLockRun(actor, input, config);
				if (run.status !== "pending") return run;
				return await executeFactLockRun(actor, run, () => {
					if (config.provider === "apikeyfun" && !env.APIKEY_FUN_API_KEY) {
						throw new FactLockError(
							"FACT_LOCK_PROVIDER_NOT_CONFIGURED",
							"Text provider chưa có API key server-side.",
						);
					}
					const provider = resolveTextProvider(config.provider, null, {
						allowDeterministic: env.NODE_ENV !== "production",
						factLockSnapshot: run?.inputSnapshot,
					});
					if (!provider) {
						throw new FactLockError(
							"FACT_LOCK_PROVIDER_UNAVAILABLE",
							"Text provider không khả dụng.",
						);
					}
					return provider;
				});
			} catch (error) {
				return toFactLockOrpcError(error);
			}
		}),
	getState: protectedProcedure
		.input(z.object({ projectId: idSchema }).strict())
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await getFactLockState(actor, input.projectId);
			} catch (error) {
				return toFactLockOrpcError(error);
			}
		}),
	manualApprove: protectedProcedure
		.input(approveInput)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await manualApproveFactLockClaim(actor, input);
			} catch (error) {
				return toFactLockOrpcError(error);
			}
		}),
	editClaimSource: protectedProcedure
		.input(editInput)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await mutateFactLockClaimSourceAndRefresh(actor, input, {
					action: "edit",
					newText: input.newText,
				});
			} catch (error) {
				return toFactLockOrpcError(error);
			}
		}),
	deleteClaimSource: protectedProcedure
		.input(resolutionInput)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await mutateFactLockClaimSourceAndRefresh(actor, input, {
					action: "delete",
				});
			} catch (error) {
				return toFactLockOrpcError(error);
			}
		}),
	applySuggestion: protectedProcedure
		.input(resolutionInput)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await mutateFactLockClaimSourceAndRefresh(actor, input, {
					action: "suggestion",
					newText: "",
				});
			} catch (error) {
				return toFactLockOrpcError(error);
			}
		}),
};
