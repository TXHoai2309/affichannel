import { FactLockError } from "@affichannel/core";
import { env } from "@affichannel/env/server";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../index";
import { resolveTextProvider } from "../providers/text/text-provider-registry";
import {
	ClaimManifestServiceError,
	createClaimManifestFromScriptVersion,
	isClaimManifestNotRequiredResult,
} from "../services/claim-manifest-service";
import { FactLockGate } from "../services/fact-lock-gate-service";
import { executeManifestFactLock } from "../services/fact-lock-manifest-service";
import {
	getFactLockState,
	manualApproveFactLockClaim,
	mutateFactLockClaimSourceAndRefresh,
} from "../services/fact-lock-service";
import { requireWorkspaceActor } from "../services/workspace";

const idSchema = z.string().trim().min(1).max(120);
const prepareManifestInput = z
	.object({
		projectId: idSchema,
		scriptVersionId: idSchema,
		expectedScriptVersionRevision: z.number().int().positive(),
	})
	.strict();
const runInput = z
	.object({
		projectId: idSchema,
		claimManifestId: idSchema,
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
	if (error instanceof ClaimManifestServiceError) {
		if (
			error.code === "CLAIM_MANIFEST_PROJECT_NOT_FOUND" ||
			error.code === "CLAIM_MANIFEST_SOURCE_NOT_FOUND" ||
			error.code === "CLAIM_MANIFEST_SOURCE_SCOPE_MISMATCH"
		)
			throw new ORPCError("NOT_FOUND", {
				message: "CLAIM_MANIFEST_NOT_FOUND",
				data: { code: "CLAIM_MANIFEST_NOT_FOUND" },
			});
		if (error.code === "CLAIM_MANIFEST_SOURCE_REVISION_CONFLICT")
			throw new ORPCError("CONFLICT", {
				message: error.code,
				data: { code: error.code },
			});
		throw new ORPCError("CONFLICT", {
			message: error.code,
			data: { code: error.code },
		});
	}
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
	if (error.code === "FACT_LOCK_REQUIRED")
		throw new ORPCError("CONFLICT", {
			message: error.code,
			data: { code: error.code, ...error.metadata },
		});
	if (error.code === "FACT_LOCK_MANIFEST_REQUIRED")
		throw new ORPCError("BAD_REQUEST", {
			message: error.code,
			data: { code: error.code, ...error.metadata },
		});
	if (error.code === "CLAIM_MANIFEST_NOT_FOUND")
		throw new ORPCError("NOT_FOUND", {
			message: error.code,
			data: { code: error.code },
		});
	if (error.code === "CLAIM_MANIFEST_NOT_EXECUTABLE")
		throw new ORPCError("CONFLICT", {
			message: error.code,
			data: { code: error.code },
		});
	if (error.code === "CLAIM_MANIFEST_FINGERPRINT_MISMATCH")
		throw new ORPCError("BAD_REQUEST", {
			message: "CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
			data: { code: "CLAIM_MANIFEST_FINGERPRINT_MISMATCH" },
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

function toFactLockSourceMutationOrpcError(error: unknown): never {
	if (
		error instanceof FactLockError &&
		error.code === "FACT_LOCK_SCRIPT_NOT_READY"
	)
		throw new ORPCError("CONFLICT", {
			message: "CLAIM_MANIFEST_NOT_EXECUTABLE",
			data: { code: "CLAIM_MANIFEST_NOT_EXECUTABLE" },
		});
	return toFactLockOrpcError(error);
}

export const factLockRouter = {
	prepareManifest: protectedProcedure
		.input(prepareManifestInput)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				const result = await createClaimManifestFromScriptVersion({
					actor,
					...input,
				});
				if (isClaimManifestNotRequiredResult(result)) {
					return {
						kind: "not_required" as const,
						reason: result.reason,
						scriptVersionId: result.scriptVersionId,
						scriptVersionRevision: result.scriptVersionRevision,
						claimCount: 0,
						isEmpty: true,
					};
				}
				const { manifest } = result;
				return {
					claimManifestId: manifest.id,
					fingerprint: manifest.fingerprint,
					source: {
						sourceType: manifest.source.sourceType,
						scriptVersionId:
							manifest.source.sourceType === "SCRIPT_VERSION"
								? manifest.source.scriptVersionId
								: null,
						scriptVersionRevision:
							manifest.source.sourceType === "SCRIPT_VERSION"
								? manifest.source.scriptVersionRevision
								: null,
					},
					claimCount: manifest.claimCount,
					isEmpty: manifest.isEmpty,
					created: result.created,
					reused: !result.created,
				};
			} catch (error) {
				return toFactLockOrpcError(error);
			}
		}),
	run: protectedProcedure
		.input(runInput)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await executeManifestFactLock(actor, input, (config) => {
					if (config.provider === "apikeyfun" && !env.APIKEY_FUN_API_KEY) {
						throw new FactLockError(
							"FACT_LOCK_PROVIDER_NOT_CONFIGURED",
							"Text provider chưa có API key server-side.",
						);
					}
					const provider = resolveTextProvider(config.provider, null, {
						allowDeterministic: env.NODE_ENV !== "production",
						model: config.model,
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
	getGate: protectedProcedure
		.input(z.object({ projectId: idSchema }).strict())
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await FactLockGate.evaluate(actor, input.projectId);
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
				return toFactLockSourceMutationOrpcError(error);
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
				return toFactLockSourceMutationOrpcError(error);
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
				return toFactLockSourceMutationOrpcError(error);
			}
		}),
};
