import { canonicalizeJson } from "../script-generation/canonical-json";
import type { AiCapability, AiOperationKind } from "./types";

export type CanonicalPaidRequest = Readonly<{
	hashVersion: `paid-request.${string}.v1`;
	canonicalInput: Record<string, unknown>;
}>;

function textOrNull(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteIntegerOrNull(value: unknown) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

export function canonicalizePaidRequest(input: {
	operationKind: AiOperationKind;
	capability: AiCapability;
	providerId: string;
	modelId: string;
	semanticInput: Record<string, unknown>;
}): CanonicalPaidRequest {
	const { semanticInput } = input;
	if (input.operationKind === "TEXT_GENERATION") {
		return {
			hashVersion: "paid-request.text-generation.v1",
			canonicalInput: {
				operationKind: input.operationKind,
				capability: input.capability,
				providerId: input.providerId,
				modelId: input.modelId,
				prompt: textOrNull(semanticInput.prompt),
				inputTokens: finiteIntegerOrNull(semanticInput.inputTokens),
				outputTokens: finiteIntegerOrNull(semanticInput.outputTokens),
				requestOptions: semanticInput.requestOptions ?? null,
			},
		};
	}
	if (input.operationKind === "IMAGE_TO_VIDEO") {
		return {
			hashVersion: "paid-request.image-to-video.v1",
			canonicalInput: {
				operationKind: input.operationKind,
				capability: input.capability,
				providerId: input.providerId,
				modelId: input.modelId,
				sourceFingerprint: textOrNull(semanticInput.sourceFingerprint),
				motionPlanFingerprint: textOrNull(semanticInput.motionPlanFingerprint),
				durationSeconds: finiteIntegerOrNull(semanticInput.durationSeconds),
			},
		};
	}
	return {
		hashVersion: `paid-request.${input.operationKind.toLowerCase().replaceAll("_", "-")}.v1`,
		canonicalInput: {
			operationKind: input.operationKind,
			capability: input.capability,
			providerId: input.providerId,
			modelId: input.modelId,
			semanticInput,
		},
	};
}

export function canonicalPaidRequestText(
	input: Parameters<typeof canonicalizePaidRequest>[0],
) {
	return canonicalizeJson(canonicalizePaidRequest(input).canonicalInput);
}
