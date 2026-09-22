export const aiCapabilities = [
	"TEXT_GENERATION",
	"IMAGE_GENERATION",
	"IMAGE_TO_VIDEO",
	"VIDEO_GENERATION",
] as const;

export type AiCapability = (typeof aiCapabilities)[number];

export const aiOperationKinds = [
	"TEXT_GENERATION",
	"IMAGE_GENERATION",
	"IMAGE_TO_VIDEO",
	"VIDEO_GENERATION",
] as const;

export type AiOperationKind = (typeof aiOperationKinds)[number];

export const aiProviderIds = ["deterministic", "apikeyfun"] as const;
export type AiProviderId = (typeof aiProviderIds)[number];

export const aiOperationStatuses = [
	"PENDING",
	"COMPLETED",
	"FAILED",
	"INDETERMINATE",
] as const;

export const aiVisualGenerationStatuses = aiOperationStatuses;
export type AiOperationStatus = (typeof aiOperationStatuses)[number];

export const aiProviderCallStages = [
	"NOT_STARTED",
	"POSSIBLY_SENT",
	"REQUEST_IDENTIFIED",
	"RESPONSE_RECEIVED",
	"FINALIZED",
] as const;
export type AiProviderCallStage = (typeof aiProviderCallStages)[number];

export const aiReservationStatuses = [
	"ACTIVE",
	"SETTLED",
	"RELEASED",
	"UNCERTAIN",
] as const;
export type AiReservationStatus = (typeof aiReservationStatuses)[number];

export const aiBudgetPeriods = ["MONTHLY"] as const;
export type AiBudgetPeriod = (typeof aiBudgetPeriods)[number];

export const aiGovernanceErrorCodes = [
	"AI_GOVERNANCE_NOT_CONFIGURED",
	"AI_PROVIDER_NOT_FOUND",
	"AI_MODEL_NOT_FOUND",
	"AI_CAPABILITY_NOT_ALLOWED",
	"AI_PROVIDER_DISABLED",
	"AI_MODEL_DISABLED",
	"AI_KILL_SWITCH_ACTIVE",
	"AI_PRICING_UNAVAILABLE",
	"AI_BUDGET_UNAVAILABLE",
	"AI_BUDGET_EXCEEDED",
	"AI_PRODUCTION_RELEASE_BLOCKED",
	"AI_SECRET_UNAVAILABLE",
	"AI_REQUEST_DUPLICATE",
	"AI_OPERATION_NOT_FOUND",
	"AI_LEASE_CONFLICT",
	"AI_RECOVERY_NOT_ALLOWED",
	"AI_VERSION_CONFLICT",
	"AI_TEST_PROVIDER_FORBIDDEN",
	"AI_ESTIMATE_STALE",
	"AI_VISUAL_SOURCE_NOT_ELIGIBLE",
	"AI_VISUAL_OUTPUT_INVALID",
	"AI_VISUAL_RECOVERY_REQUIRED",
] as const;

export type AiGovernanceErrorCode = (typeof aiGovernanceErrorCodes)[number];

export type AiProviderModel = Readonly<{
	providerId: AiProviderId;
	modelId: string;
	capabilities: readonly AiCapability[];
	paid: boolean;
	productionRelease: boolean;
	configurationSecretEnv: string | null;
	pricingVersions: readonly string[];
}>;

export type AiProviderDefinition = Readonly<{
	providerId: AiProviderId;
	displayName: string;
	paid: boolean;
	productionRelease: boolean;
	models: readonly AiProviderModel[];
}>;

export type AiPricingDefinition = Readonly<{
	providerId: AiProviderId;
	modelId: string;
	operationKind: AiOperationKind;
	pricingVersion: string;
	currency: string;
	unit: "REQUEST" | "TOKENS";
	inputMicrosPerMillionTokens: bigint;
	outputMicrosPerMillionTokens: bigint;
	fixedMicros: bigint;
}>;
