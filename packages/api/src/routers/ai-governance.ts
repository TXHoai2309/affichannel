import {
	aiGovernanceSettingsInputSchema,
	aiOperationFilterSchema,
	aiOperationIdSchema,
	aiRecoveryActionSchema,
	governedOperationInputSchema,
} from "@affichannel/core";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
	AiGovernanceError,
	getAiBudgetState,
	getAiGovernanceSettings,
	getAiOperation,
	getAiReleaseGateStatus,
	getAllowedAiRecoveryActions,
	listAiOperations,
	listAiProviderRegistry,
	prepareAiOperation,
	reconcileAiOperation,
	updateAiGovernanceSettings,
} from "../services/ai-governance-service";
import { requireWorkspaceActor } from "../services/workspace";

function mapError(error: unknown): never {
	if (error instanceof AiGovernanceError) {
		const status =
			error.code === "AI_OPERATION_NOT_FOUND"
				? "NOT_FOUND"
				: error.code === "AI_VERSION_CONFLICT" ||
						error.code === "AI_BUDGET_EXCEEDED" ||
						error.code === "AI_LEASE_CONFLICT"
					? "CONFLICT"
					: error.code === "AI_GOVERNANCE_NOT_CONFIGURED" ||
							error.code === "AI_PRODUCTION_RELEASE_BLOCKED"
						? "PRECONDITION_FAILED"
						: "BAD_REQUEST";
		throw new ORPCError(status, { message: error.code });
	}
	throw error;
}

async function withGovernanceErrors<T>(callback: () => Promise<T>) {
	try {
		return await callback();
	} catch (error) {
		return mapError(error);
	}
}

export const aiGovernanceRouter = {
	settings: {
		get: protectedProcedure.handler(({ context }) =>
			withGovernanceErrors(async () => {
				const actor = await requireWorkspaceActor(context.session.user.id);
				return getAiGovernanceSettings(actor);
			}),
		),
		update: protectedProcedure
			.input(aiGovernanceSettingsInputSchema)
			.handler(({ context, input }) =>
				withGovernanceErrors(async () => {
					const actor = await requireWorkspaceActor(context.session.user.id);
					return updateAiGovernanceSettings(actor, input);
				}),
			),
	},
	registry: {
		list: protectedProcedure.handler(() => listAiProviderRegistry()),
	},
	budget: {
		get: protectedProcedure.handler(({ context }) =>
			withGovernanceErrors(async () => {
				const actor = await requireWorkspaceActor(context.session.user.id);
				return getAiBudgetState(actor);
			}),
		),
	},
	releaseGate: {
		get: protectedProcedure.handler(() => getAiReleaseGateStatus()),
	},
	operations: {
		prepare: protectedProcedure
			.input(governedOperationInputSchema)
			.handler(({ context, input }) =>
				withGovernanceErrors(async () => {
					const actor = await requireWorkspaceActor(context.session.user.id);
					return prepareAiOperation(actor, input);
				}),
			),
		list: protectedProcedure
			.input(aiOperationFilterSchema.optional())
			.handler(({ context, input }) =>
				withGovernanceErrors(async () => {
					const actor = await requireWorkspaceActor(context.session.user.id);
					return listAiOperations(actor, input);
				}),
			),
		get: protectedProcedure
			.input(aiOperationIdSchema)
			.handler(({ context, input }) =>
				withGovernanceErrors(async () => {
					const actor = await requireWorkspaceActor(context.session.user.id);
					return getAiOperation(actor, input.id);
				}),
			),
		allowedRecoveryActions: protectedProcedure
			.input(aiOperationIdSchema)
			.handler(({ context, input }) =>
				withGovernanceErrors(async () => {
					const actor = await requireWorkspaceActor(context.session.user.id);
					return getAllowedAiRecoveryActions(actor, input.id);
				}),
			),
		reconcile: protectedProcedure
			.input(
				z
					.object({
						id: aiOperationIdSchema.shape.id,
						action: aiRecoveryActionSchema,
					})
					.strict(),
			)
			.handler(({ context, input }) =>
				withGovernanceErrors(async () => {
					const actor = await requireWorkspaceActor(context.session.user.id);
					return reconcileAiOperation(actor, input.id, input.action);
				}),
			),
	},
};
