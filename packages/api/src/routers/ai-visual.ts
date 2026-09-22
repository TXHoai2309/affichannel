import {
	aiVisualConfirmInputSchema,
	aiVisualGenerationIdSchema,
	aiVisualGenerationInputSchema,
	aiVisualHistoryInputSchema,
	aiVisualReconcileInputSchema,
} from "@affichannel/core";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../index";
import { AiGovernanceError } from "../services/ai-governance-service";
import {
	confirmAiVisualGeneration,
	estimateAiVisualGeneration,
	getAiVisualGeneration,
	getAllowedAiVisualRecoveryActions,
	listAiVisualGenerations,
	reconcileAiVisualGeneration,
} from "../services/ai-visual-service";
import { requireWorkspaceActor } from "../services/workspace";

function mapError(error: unknown): never {
	if (!(error instanceof AiGovernanceError)) throw error;
	const conflictCodes = new Set([
		"AI_ESTIMATE_STALE",
		"AI_BUDGET_EXCEEDED",
		"AI_LEASE_CONFLICT",
	]);
	const notFound = error.code === "AI_OPERATION_NOT_FOUND";
	const precondition = new Set([
		"AI_GOVERNANCE_NOT_CONFIGURED",
		"AI_KILL_SWITCH_ACTIVE",
		"AI_PROVIDER_DISABLED",
		"AI_MODEL_DISABLED",
		"AI_PRODUCTION_RELEASE_BLOCKED",
	]);
	throw new ORPCError(
		notFound
			? "NOT_FOUND"
			: conflictCodes.has(error.code)
				? "CONFLICT"
				: precondition.has(error.code)
					? "PRECONDITION_FAILED"
					: "BAD_REQUEST",
		{ message: error.code, data: { code: error.code } },
	);
}

async function withErrors<T>(callback: () => Promise<T>) {
	try {
		return await callback();
	} catch (error) {
		return mapError(error);
	}
}

export const aiVisualRouter = {
	estimate: protectedProcedure
		.input(aiVisualGenerationInputSchema)
		.handler(({ context, input }) =>
			withErrors(async () =>
				estimateAiVisualGeneration(
					await requireWorkspaceActor(context.session.user.id),
					input,
				),
			),
		),
	confirm: protectedProcedure
		.input(aiVisualConfirmInputSchema)
		.handler(({ context, input }) =>
			withErrors(async () =>
				confirmAiVisualGeneration(
					await requireWorkspaceActor(context.session.user.id),
					input,
				),
			),
		),
	getState: protectedProcedure
		.input(aiVisualGenerationIdSchema)
		.handler(({ context, input }) =>
			withErrors(async () =>
				getAiVisualGeneration(
					await requireWorkspaceActor(context.session.user.id),
					input.generationId,
				),
			),
		),
	history: protectedProcedure
		.input(aiVisualHistoryInputSchema)
		.handler(({ context, input }) =>
			withErrors(async () =>
				listAiVisualGenerations(
					await requireWorkspaceActor(context.session.user.id),
					input,
				),
			),
		),
	reconcile: protectedProcedure
		.input(aiVisualReconcileInputSchema)
		.handler(({ context, input }) =>
			withErrors(async () =>
				reconcileAiVisualGeneration(
					await requireWorkspaceActor(context.session.user.id),
					input,
				),
			),
		),
	getAllowedRecoveryActions: protectedProcedure
		.input(aiVisualGenerationIdSchema)
		.handler(({ context, input }) =>
			withErrors(async () =>
				getAllowedAiVisualRecoveryActions(
					await requireWorkspaceActor(context.session.user.id),
					input.generationId,
				),
			),
		),
};
