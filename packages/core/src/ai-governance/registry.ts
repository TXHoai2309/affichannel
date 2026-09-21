import type {
	AiCapability,
	AiOperationKind,
	AiPricingDefinition,
	AiProviderDefinition,
	AiProviderId,
} from "./types";

const deterministicModel = {
	providerId: "deterministic",
	modelId: "deterministic-text-v1",
	capabilities: ["TEXT_GENERATION"] as const satisfies readonly AiCapability[],
	paid: false,
	productionRelease: false,
	configurationSecretEnv: null,
	pricingVersions: ["deterministic-text.v1", "deterministic-text.v2"],
} as const;

const apikeyfunModel = {
	providerId: "apikeyfun",
	modelId: "claude-sonnet-4-6",
	capabilities: ["TEXT_GENERATION"] as const satisfies readonly AiCapability[],
	paid: true,
	productionRelease: false,
	configurationSecretEnv: "APIKEY_FUN_API_KEY",
	pricingVersions: ["apikeyfun-text.v1"],
} as const;

export const aiProviderRegistry = [
	{
		providerId: "deterministic",
		displayName: "Deterministic test provider",
		paid: false,
		productionRelease: false,
		models: [deterministicModel],
	},
	{
		providerId: "apikeyfun",
		displayName: "APIKEY.FUN relay",
		paid: true,
		productionRelease: false,
		models: [apikeyfunModel],
	},
] as const satisfies readonly AiProviderDefinition[];

export const aiPricingRegistry = [
	{
		providerId: "deterministic",
		modelId: "deterministic-text-v1",
		operationKind: "TEXT_GENERATION",
		pricingVersion: "deterministic-text.v1",
		currency: "VND",
		unit: "REQUEST",
		inputMicrosPerMillionTokens: BigInt(0),
		outputMicrosPerMillionTokens: BigInt(0),
		fixedMicros: BigInt(0),
	},
	{
		providerId: "apikeyfun",
		modelId: "claude-sonnet-4-6",
		operationKind: "TEXT_GENERATION",
		pricingVersion: "apikeyfun-text.v1",
		currency: "USD",
		unit: "TOKENS",
		inputMicrosPerMillionTokens: BigInt(3_000_000),
		outputMicrosPerMillionTokens: BigInt(15_000_000),
		fixedMicros: BigInt(0),
	},
	{
		providerId: "deterministic",
		modelId: "deterministic-text-v1",
		operationKind: "TEXT_GENERATION",
		pricingVersion: "deterministic-text.v2",
		currency: "VND",
		unit: "TOKENS",
		inputMicrosPerMillionTokens: BigInt(1_000_000),
		outputMicrosPerMillionTokens: BigInt(0),
		fixedMicros: BigInt(0),
	},
] as const satisfies readonly AiPricingDefinition[];

export function findProvider(providerId: string) {
	return aiProviderRegistry.find(
		(provider) => provider.providerId === providerId,
	);
}

export function findModel(providerId: string, modelId: string) {
	return findProvider(providerId)?.models.find(
		(model) => model.modelId === modelId,
	);
}

export function findPricing(
	providerId: string,
	modelId: string,
	operationKind: AiOperationKind,
	pricingVersion: string,
) {
	return aiPricingRegistry.find(
		(pricing) =>
			pricing.providerId === providerId &&
			pricing.modelId === modelId &&
			pricing.operationKind === operationKind &&
			pricing.pricingVersion === pricingVersion,
	);
}

export function registryModelIds(providerId: AiProviderId) {
	return findProvider(providerId)?.models.map((model) => model.modelId) ?? [];
}
