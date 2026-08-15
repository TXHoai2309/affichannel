import { randomUUID } from "node:crypto";
import { ScriptGenerationError } from "@affichannel/core";
import { scriptGenerationSections } from "@affichannel/core/script-generation/types";
import { env } from "@affichannel/env/server";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { resolveTextProvider } from "../providers/text/text-provider-registry";
import {
	buildScriptGenerationPreview,
	estimatePreparedScriptGeneration,
	estimateScriptGenerationInput,
	finalizeScriptGeneration,
	getScriptGenerationReadModel,
	prepareScriptGeneration,
	recordScriptGenerationEstimate,
	resolveServerGenerationConfig,
	runPreparedScriptGeneration,
} from "../services/script-generation-service";
import { requireWorkspaceActor } from "../services/workspace";

const projectIdSchema = z.string().trim().min(1).max(120);
const idempotencyKeySchema = z.string().trim().min(8).max(200);
const sectionSchema = z.enum(scriptGenerationSections);

const fullGenerationInputSchema = z
	.object({
		projectId: projectIdSchema,
		idempotencyKey: idempotencyKeySchema,
	})
	.strict();

const repairGenerationInputSchema = z
	.object({
		projectId: projectIdSchema,
		baseGenerationRequestId: projectIdSchema,
		sections: z
			.array(sectionSchema)
			.min(1)
			.max(scriptGenerationSections.length),
		idempotencyKey: idempotencyKeySchema,
	})
	.strict();

const estimateInputSchema = z.object({ projectId: projectIdSchema }).strict();

function toScriptGenerationOrpcError(error: unknown): never {
	if (!(error instanceof ScriptGenerationError)) throw error;
	if (error.code === "GENERATION_NOT_FOUND") {
		throw new ORPCError("NOT_FOUND", {
			message: error.code,
			data: { code: error.code },
		});
	}
	throw new ORPCError("BAD_REQUEST", {
		message: error.code,
		data: { code: error.code },
	});
}

function resolveProvider(
	config: { provider: string },
	snapshot: Parameters<typeof resolveTextProvider>[1],
) {
	const provider = resolveTextProvider(config.provider, snapshot, {
		allowDeterministic: env.NODE_ENV !== "production",
	});
	if (!provider)
		throw new ScriptGenerationError(
			"TEXT_PROVIDER_UNAVAILABLE",
			"Configured text provider is not available on the server.",
		);
	return provider;
}

export const scriptGenerationRouter = {
	estimate: protectedProcedure
		.input(estimateInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				const config = await resolveServerGenerationConfig(actor);
				const preview = await buildScriptGenerationPreview(
					actor,
					{
						projectId: input.projectId,
						idempotencyKey: `estimate-${randomUUID()}`,
						mode: "full",
					},
					config,
				);
				const provider = resolveProvider(config, preview.snapshot);
				const estimate = await estimateScriptGenerationInput(
					preview.snapshot,
					config,
					provider,
				);
				return {
					provider: config.provider,
					model: config.model,
					estimatedCostMicros: estimate.estimatedCostMicros,
					currency: estimate.currency,
					inputTokens: estimate.inputTokens,
					pricingBasis: estimate.pricingBasis,
				};
			} catch (error) {
				return toScriptGenerationOrpcError(error);
			}
		}),
	generate: protectedProcedure
		.input(fullGenerationInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				const config = await resolveServerGenerationConfig(actor);
				const generation = await prepareScriptGeneration(
					actor,
					{ ...input, mode: "full" },
					config,
				);
				if (generation.status !== "pending") return generation;
				try {
					const provider = resolveProvider(config, generation.inputSnapshot);
					const estimate = await estimatePreparedScriptGeneration(
						generation,
						provider,
					);
					const estimated = await recordScriptGenerationEstimate(
						actor,
						generation.id,
						estimate,
					);
					return await runPreparedScriptGeneration(actor, estimated, provider);
				} catch (error) {
					const code =
						error instanceof ScriptGenerationError &&
						error.code === "COST_ESTIMATE_UNAVAILABLE"
							? "COST_ESTIMATE_UNAVAILABLE"
							: error instanceof ScriptGenerationError &&
									error.code === "TEXT_PROVIDER_UNAVAILABLE"
								? "TEXT_PROVIDER_UNAVAILABLE"
								: "AI_PROVIDER_ERROR";
					await finalizeScriptGeneration(actor, {
						generationId: generation.id,
						outcome: { kind: "failure", code },
					});
					return toScriptGenerationOrpcError(
						error instanceof ScriptGenerationError
							? error
							: new ScriptGenerationError(code, "AI provider request failed."),
					);
				}
			} catch (error) {
				return toScriptGenerationOrpcError(error);
			}
		}),
	repair: protectedProcedure
		.input(repairGenerationInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				const config = await resolveServerGenerationConfig(actor);
				const generation = await prepareScriptGeneration(
					actor,
					{
						projectId: input.projectId,
						idempotencyKey: input.idempotencyKey,
						mode: "repair",
						parentGenerationId: input.baseGenerationRequestId,
						repairSections: input.sections,
					},
					config,
				);
				if (generation.status !== "pending") return generation;
				try {
					const provider = resolveProvider(config, generation.inputSnapshot);
					const estimate = await estimatePreparedScriptGeneration(
						generation,
						provider,
					);
					const estimated = await recordScriptGenerationEstimate(
						actor,
						generation.id,
						estimate,
					);
					return await runPreparedScriptGeneration(actor, estimated, provider);
				} catch (error) {
					const code =
						error instanceof ScriptGenerationError &&
						error.code === "COST_ESTIMATE_UNAVAILABLE"
							? "COST_ESTIMATE_UNAVAILABLE"
							: error instanceof ScriptGenerationError &&
									error.code === "TEXT_PROVIDER_UNAVAILABLE"
								? "TEXT_PROVIDER_UNAVAILABLE"
								: "AI_PROVIDER_ERROR";
					await finalizeScriptGeneration(actor, {
						generationId: generation.id,
						outcome: { kind: "failure", code },
					});
					return toScriptGenerationOrpcError(
						error instanceof ScriptGenerationError
							? error
							: new ScriptGenerationError(code, "AI provider request failed."),
					);
				}
			} catch (error) {
				return toScriptGenerationOrpcError(error);
			}
		}),
	getState: protectedProcedure
		.input(z.object({ projectId: projectIdSchema }).strict())
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await getScriptGenerationReadModel(actor, input.projectId);
			} catch (error) {
				return toScriptGenerationOrpcError(error);
			}
		}),
};
