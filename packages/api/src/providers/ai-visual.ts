import type {
	AiVisualGenerationInput,
	AiVisualTestScenario,
} from "@affichannel/core";

export type AiVisualProviderInput = Readonly<{
	requestId: string;
	sourceMediaAssetId: string;
	prompt: string;
	motion: string;
	durationSeconds: number;
	aspectRatio: "9:16";
	scenario: AiVisualTestScenario;
}>;

export type AiVisualProviderResult = Readonly<{
	providerRequestId: string | null;
	bytes: Uint8Array | null;
	mimeType: string | null;
	durationMs: number | null;
	usage: Record<string, unknown> | null;
	actualCostMicros: bigint | null;
	safeError: Record<string, unknown> | null;
	callStage:
		| "NOT_STARTED"
		| "POSSIBLY_SENT"
		| "REQUEST_IDENTIFIED"
		| "RESPONSE_RECEIVED";
}>;

// A deterministic, non-playable MP4 container header is sufficient for the
// server's narrow container proof. No encoder or FFmpeg process is involved.
const DETERMINISTIC_MP4 = new Uint8Array([
	0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00,
	0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
]);

export function createDeterministicAiVisualProvider() {
	return {
		generate(input: AiVisualProviderInput): AiVisualProviderResult {
			const providerRequestId =
				input.scenario === "TIMEOUT_AFTER_POSSIBLE_SEND" ||
				input.scenario === "NETWORK_UNCERTAINTY" ||
				input.scenario === "STORAGE_FAILURE" ||
				input.scenario === "DB_FINALIZE_FAILURE" ||
				input.scenario === "ORPHAN_ARTIFACT" ||
				input.scenario === "SUCCESS" ||
				input.scenario === "INVALID_OUTPUT"
					? `det-visual-${input.requestId}`
					: null;
			if (input.scenario === "DEFINITIVE_FAILURE") {
				return {
					providerRequestId: null,
					bytes: null,
					mimeType: null,
					durationMs: null,
					usage: null,
					actualCostMicros: null,
					safeError: { code: "DEFINITIVE_PROVIDER_ERROR" },
					callStage: "NOT_STARTED",
				};
			}
			if (input.scenario === "TIMEOUT_BEFORE_SEND") {
				return {
					providerRequestId: null,
					bytes: null,
					mimeType: null,
					durationMs: null,
					usage: null,
					actualCostMicros: null,
					safeError: { code: "TIMEOUT_BEFORE_SEND" },
					callStage: "NOT_STARTED",
				};
			}
			if (
				input.scenario === "TIMEOUT_AFTER_POSSIBLE_SEND" ||
				input.scenario === "NETWORK_UNCERTAINTY"
			) {
				return {
					providerRequestId,
					bytes: null,
					mimeType: null,
					durationMs: null,
					usage: null,
					actualCostMicros: null,
					safeError: {
						code:
							input.scenario === "NETWORK_UNCERTAINTY"
								? "NETWORK_UNCERTAINTY"
								: "POSSIBLY_SENT_TIMEOUT",
					},
					callStage: "POSSIBLY_SENT",
				};
			}
			if (input.scenario === "INVALID_OUTPUT") {
				return {
					providerRequestId,
					bytes: new TextEncoder().encode("not-an-mp4"),
					mimeType: "video/mp4",
					durationMs: input.durationSeconds * 1_000,
					usage: { simulated: true, scenario: input.scenario },
					actualCostMicros: BigInt(1),
					safeError: null,
					callStage: "RESPONSE_RECEIVED",
				};
			}
			return {
				providerRequestId,
				bytes: DETERMINISTIC_MP4,
				mimeType: "video/mp4",
				durationMs: input.durationSeconds * 1_000,
				usage: {
					provider: "deterministic",
					simulated: true,
					operationKind: "IMAGE_TO_VIDEO",
					sourceMediaAssetId: input.sourceMediaAssetId,
					promptLength: input.prompt.length,
					motionLength: input.motion.length,
					aspectRatio: input.aspectRatio,
					scenario: input.scenario,
				},
				actualCostMicros: BigInt(1),
				safeError: null,
				callStage: "RESPONSE_RECEIVED",
			};
		},
	};
}

export type AiVisualProviderInputFromGeneration = AiVisualGenerationInput;
