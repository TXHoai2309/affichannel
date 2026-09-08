import {
	buildCompositionInputV1,
	type CompositionInputBuilderSource,
	canonicalRequestHash,
	compositionInputV1Schema,
	evaluateCompositionCurrentness,
	fingerprintOutputEncodingProfile,
	MP4_H264_AAC_V1,
	type RenderRequestSpecV1,
	VERTICAL_STANDARD_PROFILE,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const HASH = "a".repeat(64);

function script() {
	return {
		schemaVersion: "script-draft.v2" as const,
		language: "vi-VN",
		hookVariants: [{ key: "hook-a", text: "Một hook" }],
		selectedHookKey: "hook-a",
		voiceoverSegments: [{ key: "voice-a", text: "Một đoạn thoại" }],
		scenes: [
			{
				order: 1,
				durationSeconds: 15,
				visualDirection: "Cận cảnh",
				onScreenText: "Xin chào",
				voiceoverSegmentKeys: ["voice-a"],
			},
		],
		cta: { text: "Mua ngay" },
		caption: "Mô tả",
		hashtags: ["#demo"],
		disclosure: "",
		claims: [],
		claimsSourceRevision: 1,
		claimsStatus: "current" as const,
	};
}

function source(
	overrides: Partial<CompositionInputBuilderSource> = {},
): CompositionInputBuilderSource {
	return {
		workspaceId: "w1",
		projectId: "p1",
		script: {
			semantic: script(),
			provenance: {
				scriptVersionId: "sv1",
				revision: 1,
				status: "draft",
				versionNumber: null,
			},
		},
		voice: {
			semantic: {
				config: {
					provider: "apikeyfun",
					voiceId: "vi-1",
					language: "vi-VN",
					speed: 1,
				},
				segments: [
					{
						segmentKey: "voice-a",
						textSnapshot: "Một đoạn thoại",
						textHash: HASH,
						checksum: HASH,
						mimeType: "audio/mpeg",
						byteSize: 10,
						durationMs: 500,
						timing: {
							sourceSampleRate: 48000,
							trimStartSample: "0",
							trimEndSample: "24000",
							videoStartFrame: "0",
							videoDurationFrames: "15",
						},
					},
				],
			},
			provenance: {
				configId: "vc1",
				configRevision: 1,
				segments: [
					{
						artifactId: "va1",
						sourceScriptVersionId: "sv1",
						sourceScriptRevision: 1,
						segmentKey: "voice-a",
						provider: "apikeyfun",
						storageProvider: "local",
					},
				],
			},
		},
		media: [
			{
				role: "background",
				semantic: {
					mediaType: "image",
					mimeType: "image/png",
					checksumSha256: HASH,
					byteSize: 100,
					width: 1080,
					height: 1920,
					durationMs: null,
				},
				provenance: { mediaAssetId: "ma1", workspaceId: "w1", projectId: "p1" },
			},
		],
		fonts: {
			bundleId: "affichannel-fonts-v1",
			faces: [
				{
					family: "Noto Sans",
					weight: 400,
					style: "normal",
					fontId: "noto-400",
					contentSha256: HASH,
				},
				{
					family: "Noto Sans",
					weight: 600,
					style: "normal",
					fontId: "noto-600",
					contentSha256: HASH,
				},
				{
					family: "Noto Sans",
					weight: 700,
					style: "normal",
					fontId: "noto-700",
					contentSha256: HASH,
				},
			],
		},
		config: {
			semantic: {
				compositionProfileId: "vertical-standard-v1",
				outputRules: {
					language: "vi-VN",
					aspectRatio: "9:16",
					subtitleSafeArea: "standard",
					claimLimit: 3,
					requireFinalCta: true,
				},
			},
			provenance: { outputRulesRevision: null },
		},
		timeline: {
			fps: { numerator: 30, denominator: 1 },
			totalFrames: "450",
			scenes: [{ order: 1, startFrame: "0", durationFrames: "450" }],
		},
		...overrides,
	};
}

async function built() {
	const result = await buildCompositionInputV1(source());
	if (!result.ok) throw new Error(result.code);
	return result;
}

describe("CompositionInputV1", () => {
	it("validates the frozen profile and exact timing authority", async () => {
		const result = await built();
		expect(compositionInputV1Schema.parse(result.input).profile).toEqual(
			VERTICAL_STANDARD_PROFILE,
		);
		expect(result.input.timeline.totalFrames).toBe("450");
	});

	it("fails closed when voice timing or fonts are incomplete", async () => {
		const noFonts = await buildCompositionInputV1({
			...source(),
			fonts: null as never,
		});
		expect(noFonts.ok).toBe(false);
		const noTiming = await buildCompositionInputV1({
			...source(),
			voice: {
				...source().voice,
				semantic: {
					...source().voice.semantic,
					segments: [
						{ ...source().voice.semantic.segments[0], timing: null as never },
					],
				},
			},
		});
		expect(noTiming.ok).toBe(false);
	});

	it("canonicalizes semantic input while excluding provenance-only identity", async () => {
		const first = await built();
		const second = await buildCompositionInputV1({
			...source(),
			script: {
				...source().script,
				provenance: {
					...source().script.provenance,
					scriptVersionId: "sv-other",
				},
			},
			media: [
				{
					...source().media[0],
					provenance: {
						...source().media[0].provenance,
						mediaAssetId: "ma-other",
					},
				},
			],
		});
		if (!second.ok || !first.ok) throw new Error("fixture incomplete");
		expect(second.fingerprint).toBe(first.fingerprint);
	});

	it("changes fingerprint for semantic media changes", async () => {
		const first = await built();
		const second = await buildCompositionInputV1({
			...source(),
			media: [
				{
					...source().media[0],
					semantic: {
						...source().media[0].semantic,
						checksumSha256: "b".repeat(64),
					},
				},
			],
		});
		if (!first.ok || !second.ok) throw new Error("fixture incomplete");
		expect(second.fingerprint).not.toBe(first.fingerprint);
	});
});

describe("OutputEncodingProfile and render request boundary", () => {
	it("detects the built-in profile as incomplete", async () => {
		await expect(
			fingerprintOutputEncodingProfile(MP4_H264_AAC_V1),
		).rejects.toThrow("OUTPUT_ENCODING_PROFILE_INCOMPLETE");
	});

	it("excludes CompositionVersion ID from request hash", async () => {
		const profile = {
			...MP4_H264_AAC_V1,
			videoBitrateKbps: 5000,
			videoCrf: 20,
			audioBitrateKbps: 192,
			keyframeIntervalFrames: 60,
		};
		const profileFingerprint = await fingerprintOutputEncodingProfile(profile);
		const a: RenderRequestSpecV1 = {
			schemaVersion: "render-request.v1",
			compositionVersionId: "cv-a",
			compositionFingerprint: HASH,
			outputEncodingProfile: profile,
			outputEncodingProfileFingerprint: profileFingerprint,
			outputContractVersion: "output.v1",
		};
		const b = { ...a, compositionVersionId: "cv-b" };
		expect(await canonicalRequestHash(a)).toBe(await canonicalRequestHash(b));
	});
});

describe("Composition currentness", () => {
	it("marks script revision changes stale and archive-only changes current", async () => {
		const result = await built();
		if (!result.ok) throw new Error("fixture incomplete");
		expect(
			evaluateCompositionCurrentness(result.input, {
				scriptVersionId: "sv1",
				scriptRevision: 2,
				voiceConfigRevision: 1,
				voiceArtifactIds: ["va1"],
				mediaChecksums: [HASH],
				compositionProfileId: "vertical-standard-v1",
			}).state,
		).toBe("STALE");
		expect(
			evaluateCompositionCurrentness(result.input, {
				scriptVersionId: "sv1",
				scriptRevision: 1,
				voiceConfigRevision: 1,
				voiceArtifactIds: ["va1"],
				mediaChecksums: [HASH],
				compositionProfileId: "vertical-standard-v1",
			}).state,
		).toBe("CURRENT");
	});

	it("marks voice and render-affecting config changes stale", async () => {
		const result = await built();
		if (!result.ok) throw new Error("fixture incomplete");
		const base = {
			scriptVersionId: "sv1",
			scriptRevision: 1,
			voiceConfigRevision: 1,
			voiceArtifactIds: ["va1"],
			voiceArtifactChecksums: [HASH],
			mediaChecksums: [HASH],
			compositionProfileId: "vertical-standard-v1",
		};
		const voiceChanged = evaluateCompositionCurrentness(result.input, {
			...base,
			voiceArtifactChecksums: ["b".repeat(64)],
		});
		expect(voiceChanged.state).toBe("STALE");
		if (voiceChanged.state === "STALE")
			expect(voiceChanged.reason).toBe("VOICE_SOURCE_CHANGED");
		const configChanged = evaluateCompositionCurrentness(result.input, {
			...base,
			currentConfigSemantic: {
				...result.input.config.semantic,
				outputRules: {
					...result.input.config.semantic.outputRules,
					claimLimit: 4,
				},
			},
		});
		expect(configChanged.state).toBe("STALE");
		if (configChanged.state === "STALE")
			expect(configChanged.reason).toBe("CONFIG_CHANGED");
	});
});
