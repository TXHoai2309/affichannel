import { z } from "zod";

import {
	aiBudgetPeriods,
	aiCapabilities,
	aiOperationKinds,
	aiOperationStatuses,
	aiProviderIds,
} from "./types";

const idText = z.string().trim().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

export const aiGovernanceSettingsInputSchema = z
	.object({
		expectedVersion: z.number().int().nonnegative().nullable(),
		providerId: z.enum(aiProviderIds),
		modelId: idText,
		providerEnabled: z.boolean(),
		modelEnabled: z.boolean(),
		killSwitch: z.boolean(),
		pricingVersion: idText,
		budgetPeriod: z.enum(aiBudgetPeriods),
		budgetLimitMicros: z
			.number()
			.int()
			.nonnegative()
			.max(9_000_000_000_000_000),
		budgetCurrency: z.string().regex(/^[A-Z]{3}$/),
	})
	.strict();

export type AiGovernanceSettingsInput = z.infer<
	typeof aiGovernanceSettingsInputSchema
>;

export const governedOperationInputSchema = z
	.object({
		operationKind: z.enum(aiOperationKinds),
		capability: z.enum(aiCapabilities),
		projectId: idText.nullable().optional(),
		idempotencyKey: z.string().trim().min(8).max(200),
		semanticInput: z.record(z.string(), z.unknown()).default({}),
	})
	.strict();

export type GovernedOperationInput = z.infer<
	typeof governedOperationInputSchema
>;

export const aiOperationFilterSchema = z
	.object({
		projectId: idText.optional(),
		providerId: z.enum(aiProviderIds).optional(),
		status: z.enum(aiOperationStatuses).optional(),
		startDate: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/)
			.optional(),
		endDate: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/)
			.optional(),
	})
	.strict();

export const aiRecoveryActionSchema = z.enum([
	"RECONCILE",
	"RELEASE_RESERVATION",
	"MARK_FAILED",
	"ATTACH_ORPHAN_ARTIFACT",
	"ACKNOWLEDGE_UNRESOLVED",
]);

export type AiRecoveryAction = z.infer<typeof aiRecoveryActionSchema>;

export const aiOperationIdSchema = z.object({ id: idText }).strict();

export const aiGovernanceReadModelSchema = z.object({
	version: z.number(),
	providerId: idText,
	modelId: idText,
	providerEnabled: z.boolean(),
	modelEnabled: z.boolean(),
	killSwitch: z.boolean(),
	pricingVersion: idText.nullable(),
	budgetPeriod: z.enum(aiBudgetPeriods),
	budgetLimitMicros: z.number(),
	budgetCurrency: z.string(),
	reservedMicros: z.number(),
	settledMicros: z.number(),
	uncertainMicros: z.number(),
	remainingMicros: z.number(),
});

export { hash };
