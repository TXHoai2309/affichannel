import { FactLockError } from "@affichannel/core";
import { env } from "@affichannel/env/server";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../index";
import { resolveTextProvider } from "../providers/text/text-provider-registry";
import {
	executeFactLockRun,
	finalizeFactLockRun,
	getFactLockState,
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

function toFactLockOrpcError(error: unknown): never {
	if (!(error instanceof FactLockError)) throw error;
	if (error.code === "FACT_LOCK_NOT_FOUND")
		throw new ORPCError("NOT_FOUND", {
			message: error.code,
			data: { code: error.code },
		});
	if (
		error.code === "FACT_LOCK_ALREADY_PENDING" ||
		error.code === "FACT_LOCK_IDEMPOTENCY_CONFLICT"
	)
		throw new ORPCError("CONFLICT", {
			message: error.code,
			data: { code: error.code },
		});
	throw new ORPCError("BAD_REQUEST", {
		message: error.code,
		data: { code: error.code },
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
				if (config.provider === "apikeyfun" && !env.APIKEY_FUN_API_KEY) {
					throw new FactLockError(
						"FACT_LOCK_PROVIDER_NOT_CONFIGURED",
						"Text provider chưa có API key server-side.",
					);
				}
				const provider = resolveTextProvider(config.provider, null, {
					allowDeterministic: env.NODE_ENV !== "production",
					factLockSnapshot: run.inputSnapshot,
				});
				if (!provider) {
					throw new FactLockError(
						"FACT_LOCK_PROVIDER_UNAVAILABLE",
						"Text provider không khả dụng.",
					);
				}
				return await executeFactLockRun(actor, run, provider);
			} catch (error) {
				if (
					run?.status === "pending" &&
					error instanceof FactLockError &&
					(error.code === "FACT_LOCK_PROVIDER_NOT_CONFIGURED" ||
						error.code === "FACT_LOCK_PROVIDER_UNAVAILABLE")
				) {
					await finalizeFactLockRun(actor, {
						runId: run.id,
						outcome: { kind: "failure", code: error.code },
					});
				}
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
};
