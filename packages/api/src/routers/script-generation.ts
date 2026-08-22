import { randomUUID } from "node:crypto";
import { ScriptGenerationError } from "@affichannel/core";
import type { ScriptGenerationArtifact } from "@affichannel/core/script-generation/types";
import { scriptGenerationSections } from "@affichannel/core/script-generation/types";
import { env } from "@affichannel/env/server";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import type {
	TextProvider,
	TextProviderEstimate,
} from "../providers/text/text-provider";
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
import {
	requireWorkspaceActor,
	type WorkspaceActor,
} from "../services/workspace";

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
	if (config.provider === "apikeyfun" && !env.APIKEY_FUN_API_KEY) {
		throw new ScriptGenerationError(
			"TEXT_PROVIDER_NOT_CONFIGURED",
			"The configured text provider is missing its server-side API key.",
		);
	}
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

type PreparedGenerationDependencies = {
	resolveProvider: typeof resolveProvider;
	estimate: typeof estimatePreparedScriptGeneration;
	recordEstimate: typeof recordScriptGenerationEstimate;
	run: typeof runPreparedScriptGeneration;
	finalize: typeof finalizeScriptGeneration;
};

const defaultPreparedGenerationDependencies: PreparedGenerationDependencies = {
	resolveProvider,
	estimate: estimatePreparedScriptGeneration,
	recordEstimate: recordScriptGenerationEstimate,
	run: runPreparedScriptGeneration,
	finalize: finalizeScriptGeneration,
};

async function finalizePreflightFailure(
	actor: WorkspaceActor,
	generation: ScriptGenerationArtifact,
	error: unknown,
	code:
		| "TEXT_PROVIDER_NOT_CONFIGURED"
		| "TEXT_PROVIDER_UNAVAILABLE"
		| "COST_ESTIMATE_UNAVAILABLE",
	dependencies: PreparedGenerationDependencies,
): Promise<never> {
	const domainError =
		error instanceof ScriptGenerationError
			? error
			: new ScriptGenerationError(code, "Generation preflight failed.");
	await dependencies.finalize(actor, {
		generationId: generation.id,
		outcome: { kind: "failure", code },
	});
	throw domainError;
}

export async function executePreparedGeneration(
	actor: WorkspaceActor,
	config: { provider: string },
	generation: ScriptGenerationArtifact,
	dependencies: PreparedGenerationDependencies = defaultPreparedGenerationDependencies,
) {
	let provider: TextProvider;
	try {
		provider = dependencies.resolveProvider(config, generation.inputSnapshot);
	} catch (error) {
		if (
			error instanceof ScriptGenerationError &&
			(error.code === "TEXT_PROVIDER_NOT_CONFIGURED" ||
				error.code === "TEXT_PROVIDER_UNAVAILABLE")
		)
			return finalizePreflightFailure(
				actor,
				generation,
				error,
				error.code,
				dependencies,
			);
		throw error;
	}

	let estimate: TextProviderEstimate;
	try {
		estimate = await dependencies.estimate(generation, provider);
	} catch (error) {
		if (
			error instanceof ScriptGenerationError &&
			error.code === "COST_ESTIMATE_UNAVAILABLE"
		)
			return finalizePreflightFailure(
				actor,
				generation,
				error,
				"COST_ESTIMATE_UNAVAILABLE",
				dependencies,
			);
		throw error;
	}

	const estimated = await dependencies.recordEstimate(
		actor,
		generation.id,
		estimate,
	);
	return dependencies.run(actor, estimated, provider);
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
				return await executePreparedGeneration(actor, config, generation);
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
				return await executePreparedGeneration(actor, config, generation);
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
