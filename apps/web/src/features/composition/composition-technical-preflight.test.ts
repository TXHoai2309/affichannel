import { readFile } from "node:fs/promises";
import type { MediaAssetStorage } from "@affichannel/api/media/media-asset-storage";
import {
	CompositionTechnicalLoader,
	readFontAssetManifest,
	technicalPreflightCompositionInput,
	validateDecodedMp3SampleDomain,
} from "@affichannel/api/services/composition-technical-loader";
import { sha256Bytes } from "@affichannel/api/services/voice-segment-hashing";
import type { VoiceAudioStorage } from "@affichannel/api/storage/voice-audio-storage";
import {
	buildCompositionInputV1,
	type CompositionInputV1,
	checkCompositionAudioTiming,
	type MediaAsset,
	VERTICAL_STANDARD_PROFILE,
	type VoiceSegmentArtifact,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";
import {
	id3PrefixedMp3Fixture,
	makeMp3Fixture,
	malformedFrameCountMp3Fixture,
	malformedLameMp3Fixture,
	missingFrameFlagMp3Fixture,
	monoMp3Fixture,
	mp3FixtureProvenance,
	stereoMp3Fixture,
	validGaplessMp3Fixture,
} from "./fixtures/mp3-fixtures";

const actor = { workspaceId: "w1", userId: "u1" } as const;

function supportedMp3Fixture(frameCount = 41) {
	return makeMp3Fixture({
		frameCount,
		encoderDelay: validGaplessMp3Fixture.encoderDelay,
		endPadding: validGaplessMp3Fixture.endPadding,
	}).bytes;
}

function pngFixture() {
	const bytes = new Uint8Array(33);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
	bytes.set([0, 0, 0, 13], 8);
	bytes.set([73, 72, 68, 82], 12);
	bytes.set([0, 0, 4, 56], 16);
	bytes.set([0, 0, 7, 128], 20);
	return bytes;
}

function jpegFixture() {
	const bytes = new Uint8Array(21);
	bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 7, 128, 4, 56]);
	return bytes;
}

function webpFixture() {
	const bytes = new Uint8Array(30);
	bytes.set(new TextEncoder().encode("RIFF"), 0);
	bytes.set(new TextEncoder().encode("WEBP"), 8);
	bytes.set(new TextEncoder().encode("VP8X"), 12);
	bytes.set([10, 0, 0, 0], 16);
	bytes.set([0, 0, 0, 0, 55, 4, 0, 127, 7, 0], 20);
	return bytes;
}

function mediaAsset(bytes: Uint8Array): MediaAsset {
	return {
		id: "media-1",
		workspaceId: actor.workspaceId,
		createdByUserId: actor.userId,
		origin: "user_upload",
		mediaType: "image",
		status: "archived",
		storageProvider: "local",
		storageKey: "media/v1/w1/media-1/object",
		uploadSessionId: "upload-1",
		prepareIdempotencyKey: "prepare-1",
		uploadExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
		originalFilename: "ignored.png",
		displayName: "ignored",
		declaredMimeType: "image/png",
		mimeType: "image/png",
		byteSize: bytes.byteLength,
		checksumSha256: sha256Bytes(bytes),
		width: 1080,
		height: 1920,
		durationMs: null,
		usageRights: "restricted",
		tags: [],
		failureCode: null,
		finalizedAt: null,
		archivedAt: new Date("2026-01-01T00:00:00.000Z"),
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	};
}

function voiceArtifact(bytes: Uint8Array): VoiceSegmentArtifact {
	return {
		id: "voice-1",
		workspaceId: actor.workspaceId,
		projectId: "p1",
		sourceScriptVersionId: "script-1",
		sourceScriptRevision: 1,
		segmentKey: "voice-1",
		textHash: "a".repeat(64),
		segmentTextSnapshot: "Xin chào",
		voiceConfigRevision: 1,
		provider: "fixture",
		voiceId: "fixture-voice",
		language: "vi-VN",
		speed: 1,
		createdByUserId: actor.userId,
		idempotencyKey: "voice-idem-1",
		requestHash: "b".repeat(64),
		status: "completed",
		providerRequestId: null,
		errorCode: null,
		storageProvider: "local",
		storageKey: "voice/v1/w1/p1/voice-1.mp3",
		mimeType: "audio/mpeg",
		byteSize: bytes.byteLength,
		checksum: sha256Bytes(bytes),
		durationMs: 1000,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		finishedAt: new Date("2026-01-01T00:00:01.000Z"),
	};
}

function mediaPin(asset: MediaAsset) {
	return {
		dependencyKey: asset.id,
		role: "background",
		semantic: {
			mediaType: "image" as const,
			mimeType: asset.mimeType as "image/png",
			checksumSha256: asset.checksumSha256 ?? "",
			byteSize: asset.byteSize ?? 0,
			width: asset.width ?? 0,
			height: asset.height ?? 0,
			durationMs: null,
		},
		provenance: {
			mediaAssetId: asset.id,
			workspaceId: asset.workspaceId,
			projectId: "p1",
		},
	} as CompositionInputV1["media"][number];
}

function voicePin(
	artifact: VoiceSegmentArtifact,
	sourceSampleCount = String(validGaplessMp3Fixture.sourceSampleFrames),
) {
	return {
		segmentKey: artifact.segmentKey,
		semantic: {
			checksum: artifact.checksum ?? "",
			mimeType: "audio/mpeg" as const,
			byteSize: artifact.byteSize ?? 0,
			sourceSampleRate: 44100,
			sourceSampleCount,
			durationMs: 999,
		},
		provenance: {
			artifactId: artifact.id,
			sourceScriptVersionId: artifact.sourceScriptVersionId,
			sourceScriptRevision: artifact.sourceScriptRevision,
			textSnapshot: artifact.segmentTextSnapshot,
			textHash: artifact.textHash,
			configId: "config-1",
			configRevision: artifact.voiceConfigRevision,
			provider: artifact.provider,
			voiceId: artifact.voiceId,
			language: artifact.language,
			speed: artifact.speed,
			storageProvider: "local" as const,
		},
	} as CompositionInputV1["voice"]["segments"][number];
}

function mediaStorage(bytes: Uint8Array): MediaAssetStorage {
	const value = {
		provider: "local" as const,
		head: async () => ({ byteSize: bytes.byteLength }),
		get: async () => new Uint8Array(bytes),
		open: async () => new ReadableStream<Uint8Array>(),
		put: async () => ({
			byteSize: bytes.byteLength,
			checksumSha256: sha256Bytes(bytes),
		}),
		createUploadGrant: async () => ({
			urlOrToken: "ignored",
			expiresAt: new Date(),
		}),
		createDownloadGrant: async () => ({
			urlOrToken: "ignored",
			expiresAt: new Date(),
		}),
		delete: async () => undefined,
		cleanup: async () => undefined,
	};
	return value as unknown as MediaAssetStorage;
}

function voiceStorage(bytes: Uint8Array): VoiceAudioStorage {
	const value = {
		provider: "local" as const,
		head: async () => ({ byteSize: bytes.byteLength }),
		get: async () => new Uint8Array(bytes),
		open: async () => new ReadableStream<Uint8Array>(),
		put: async () => ({
			byteSize: bytes.byteLength,
			checksum: sha256Bytes(bytes),
		}),
		delete: async () => undefined,
	};
	return value as unknown as VoiceAudioStorage;
}

async function loadVoiceFixture(
	fixture: {
		bytes: Uint8Array;
		sourceSampleRate: number;
		sourceSampleFrames: number;
	},
	expectedSampleFrames = fixture.sourceSampleFrames,
) {
	const artifact = voiceArtifact(fixture.bytes);
	const loader = new CompositionTechnicalLoader({
		actor,
		projectId: "p1",
		findVoiceArtifact: async () => artifact,
		voiceStorage: () => voiceStorage(fixture.bytes),
	});
	return loader.loadVoice({
		...voicePin(artifact, String(expectedSampleFrames)),
		semantic: {
			...voicePin(artifact, String(expectedSampleFrames)).semantic,
			sourceSampleRate: fixture.sourceSampleRate,
			sourceSampleCount: String(expectedSampleFrames),
			durationMs: 1,
		},
	});
}

async function compositionFixture(
	fontFaces: CompositionInputV1["fonts"]["faces"],
	media: MediaAsset,
	voice: VoiceSegmentArtifact,
) {
	return buildCompositionInputV1({
		workspaceId: actor.workspaceId,
		projectId: "p1",
		profile: VERTICAL_STANDARD_PROFILE,
		script: {
			semantic: {
				schemaVersion: "script-draft.v2",
				language: "vi-VN",
				hookVariants: [{ key: "hook-1", text: "Hook" }],
				selectedHookKey: "hook-1",
				voiceoverSegments: [{ key: "voice-1", text: "Xin chào" }],
				scenes: [
					{
						order: 1,
						durationSeconds: 1,
						visualDirection: "Cận cảnh",
						onScreenText: "Tiếng Việt",
						voiceoverSegmentKeys: ["voice-1"],
					},
				],
				cta: { text: "Mua ngay" },
				caption: "Mô tả",
				hashtags: [],
				disclosure: "",
				claims: [],
				claimsSourceRevision: 1,
				claimsStatus: "current",
			},
			provenance: {
				scriptVersionId: "script-1",
				revision: 1,
				status: "saved",
				versionNumber: 1,
			},
		},
		voice: {
			segments: [
				{
					segmentKey: "voice-1",
					semantic: {
						checksum: voice.checksum ?? "",
						mimeType: "audio/mpeg",
						byteSize: voice.byteSize ?? 0,
						sourceSampleRate: 44100,
						sourceSampleCount: String(
							validGaplessMp3Fixture.sourceSampleFrames,
						),
						durationMs: 1000,
					},
					provenance: {
						artifactId: voice.id,
						sourceScriptVersionId: voice.sourceScriptVersionId,
						sourceScriptRevision: voice.sourceScriptRevision,
						textSnapshot: voice.segmentTextSnapshot,
						textHash: voice.textHash,
						configId: "config-1",
						configRevision: voice.voiceConfigRevision,
						provider: voice.provider,
						voiceId: voice.voiceId,
						language: voice.language,
						speed: voice.speed,
						storageProvider: "local",
					},
				},
			],
		},
		media: [
			{
				dependencyKey: media.id,
				role: "background",
				semantic: {
					mediaType: "image",
					mimeType: "image/png",
					checksumSha256: media.checksumSha256 ?? "",
					byteSize: media.byteSize ?? 0,
					width: media.width,
					height: media.height,
					durationMs: null,
				},
				provenance: {
					mediaAssetId: media.id,
					workspaceId: actor.workspaceId,
					projectId: "p1",
				},
			},
		],
		fonts: { bundleId: "affichannel-fonts-v1", faces: fontFaces },
		config: {
			semantic: {
				compositionProfileId: "vertical-standard-v1",
				outputRules: {
					language: "vi-VN",
					aspectRatio: "9:16",
					subtitleSafeArea: "standard",
					claimLimit: null,
					requireFinalCta: true,
				},
			},
			provenance: { outputRulesRevision: null },
		},
		timeline: {
			fps: { numerator: 30, denominator: 1 },
			totalFrames: "32",
			scenes: [
				{
					sceneKey: "scene-1",
					order: 1,
					startFrame: "0",
					durationFrames: "32",
				},
			],
		},
		sceneComposition: {
			version: "scene-composition.v1",
			scenes: [
				{
					sceneKey: "scene-1",
					layers: [
						{
							kind: "MEDIA",
							layerId: "media-layer",
							zIndex: 0,
							startOffsetFrame: "0",
							durationFrames: "32",
							box: { xPx: 0, yPx: 0, widthPx: 1080, heightPx: 1920 },
							opacityBasisPoints: 10000,
							sourceMediaKey: media.id,
							fit: "COVER",
							objectPositionXBasisPoints: 5000,
							objectPositionYBasisPoints: 5000,
						},
						{
							kind: "TEXT",
							layerId: "text-layer",
							zIndex: 1,
							startOffsetFrame: "0",
							durationFrames: "32",
							box: { xPx: 90, yPx: 120, widthPx: 900, heightPx: 240 },
							opacityBasisPoints: 10000,
							text: "Tiếng Việt",
							fontStableId: "noto-sans-700",
							fontWeight: 700,
							fontStyle: "normal",
							fontSizePx: 64,
							lineHeightPx: 80,
							textAlign: "CENTER",
							colorRgba: { r: 255, g: 255, b: 255, a: 255 },
							maxLines: 2,
							textLayoutVersion: "affichannel-text-layout-v1",
						},
					],
				},
			],
			audioTracks: [
				{
					trackId: "track-voice-1",
					sourceVoiceKey: "voice-1",
					startFrame: "0",
					durationFrames: "30",
					endFrame: "30",
					trimStartSample: "0",
					trimEndSample: "44100",
					gainMilliDb: 0,
					panBasisPoints: 0,
					fadeInSamples: "0",
					fadeOutSamples: "0",
				},
			],
		},
	});
}

describe("AFF-US-021 EN001 deterministic technical preflight", () => {
	it("loads exact archived image bytes without evaluating rights/status", async () => {
		const bytes = pngFixture();
		const asset = mediaAsset(bytes);
		const loader = new CompositionTechnicalLoader({
			actor,
			projectId: "p1",
			findMediaAsset: async () => asset,
			mediaStorage: () => mediaStorage(bytes),
		});
		const result = await loader.loadMedia({
			dependencyKey: asset.id,
			role: "background",
			semantic: {
				mediaType: "image",
				mimeType: "image/png",
				checksumSha256: asset.checksumSha256 ?? "",
				byteSize: bytes.byteLength,
				width: 1080,
				height: 1920,
				durationMs: null,
			},
			provenance: {
				mediaAssetId: asset.id,
				workspaceId: actor.workspaceId,
				projectId: "p1",
			},
		});
		expect(result.status).toBe("VALID");
	});

	it("accepts exact JPEG and WebP bytes with decoded dimensions", async () => {
		for (const [bytes, mimeType] of [
			[jpegFixture(), "image/jpeg"],
			[webpFixture(), "image/webp"],
		] as const) {
			const asset = {
				...mediaAsset(bytes),
				declaredMimeType: mimeType,
				mimeType,
			};
			const loader = new CompositionTechnicalLoader({
				actor,
				projectId: "p1",
				findMediaAsset: async () => asset,
				mediaStorage: () => mediaStorage(bytes),
			});
			const result = await loader.loadMedia(mediaPin(asset));
			expect(result).toMatchObject({
				status: "VALID",
				facts: { mimeType, width: 1080, height: 1920 },
			});
		}
	});

	it("classifies media pin failures, missing objects, transient reads, and MP4", async () => {
		const bytes = pngFixture();
		const asset = mediaAsset(bytes);
		const pin = mediaPin(asset);
		const loader = (storage: MediaAssetStorage) =>
			new CompositionTechnicalLoader({
				actor,
				projectId: "p1",
				findMediaAsset: async () => asset,
				mediaStorage: () => storage,
			});
		expect(
			await loader(mediaStorage(bytes)).loadMedia({
				...pin,
				semantic: { ...pin.semantic, checksumSha256: "0".repeat(64) },
			}),
		).toMatchObject({
			status: "INVALID",
			reasonCode: "MEDIA_CHECKSUM_MISMATCH",
		});
		expect(
			await loader(mediaStorage(bytes)).loadMedia({
				...pin,
				semantic: { ...pin.semantic, byteSize: bytes.byteLength + 1 },
			}),
		).toMatchObject({
			status: "INVALID",
			reasonCode: "MEDIA_BYTE_SIZE_MISMATCH",
		});
		expect(
			await loader(mediaStorage(bytes)).loadMedia({
				...pin,
				semantic: { ...pin.semantic, width: 1 },
			}),
		).toMatchObject({
			status: "INVALID",
			reasonCode: "MEDIA_METADATA_MISMATCH",
		});
		expect(
			await loader(mediaStorage(bytes)).loadMedia({
				...pin,
				semantic: { ...pin.semantic, mimeType: "image/jpeg" },
			}),
		).toMatchObject({
			status: "INVALID",
			reasonCode: "MEDIA_MIME_MISMATCH",
		});
		expect(
			await loader({
				...mediaStorage(bytes),
				head: async () => null,
			} as unknown as MediaAssetStorage).loadMedia(pin),
		).toMatchObject({
			status: "INVALID",
			reasonCode: "MISSING_MEDIA_OBJECT",
		});
		expect(
			await loader({
				...mediaStorage(bytes),
				head: async () => {
					throw new Error("timeout");
				},
			} as unknown as MediaAssetStorage).loadMedia(pin),
		).toMatchObject({
			status: "UNKNOWN",
			reasonCode: "DEPENDENCY_READ_UNAVAILABLE",
		});
		const mp4Pin = {
			...pin,
			semantic: { ...pin.semantic, mediaType: "video", mimeType: "video/mp4" },
		} as unknown as CompositionInputV1["media"][number];
		expect(await loader(mediaStorage(bytes)).loadMedia(mp4Pin)).toMatchObject({
			status: "UNSUPPORTED",
			reasonCode: "MEDIA_FORMAT_UNSUPPORTED",
		});
	});

	it("derives exact MP3 sample facts and ignores duration for sample authority", async () => {
		const bytes = supportedMp3Fixture();
		const artifact = voiceArtifact(bytes);
		const loader = new CompositionTechnicalLoader({
			actor,
			projectId: "p1",
			findVoiceArtifact: async () => artifact,
			voiceStorage: () => voiceStorage(bytes),
		});
		const result = await loader.loadVoice({
			segmentKey: artifact.segmentKey,
			semantic: {
				checksum: artifact.checksum ?? "",
				mimeType: "audio/mpeg",
				byteSize: bytes.byteLength,
				sourceSampleRate: 44100,
				sourceSampleCount: String(validGaplessMp3Fixture.sourceSampleFrames),
				durationMs: 1,
			},
			provenance: {
				artifactId: artifact.id,
				sourceScriptVersionId: artifact.sourceScriptVersionId,
				sourceScriptRevision: artifact.sourceScriptRevision,
				textSnapshot: artifact.segmentTextSnapshot,
				textHash: artifact.textHash,
				configId: "config-1",
				configRevision: artifact.voiceConfigRevision,
				provider: artifact.provider,
				voiceId: artifact.voiceId,
				language: artifact.language,
				speed: artifact.speed,
				storageProvider: "local",
			},
		});
		expect(result).toMatchObject({
			status: "VALID",
			facts: {
				sourceSampleRate: 44100,
				sourceSampleCount: String(validGaplessMp3Fixture.sourceSampleFrames),
			},
		});
	});

	it.each([
		["mono", monoMp3Fixture],
		["stereo", stereoMp3Fixture],
	] as const)(
		"derives %s sample frames from the scalar interleaved PCM count",
		async (_label, fixture) => {
			const provenance =
				_label === "mono"
					? mp3FixtureProvenance.mono
					: mp3FixtureProvenance.stereo;
			const result = await loadVoiceFixture(
				fixture,
				provenance.expectedUsableMp3SampleFrames,
			);
			expect(result).toMatchObject({
				status: "VALID",
				facts: {
					sourceSampleRate: fixture.sourceSampleRate,
					sourceSampleCount: String(provenance.expectedUsableMp3SampleFrames),
				},
			});
		},
	);

	it("applies independently documented nonzero gapless fields exactly once", async () => {
		const result = await loadVoiceFixture(
			validGaplessMp3Fixture,
			mp3FixtureProvenance.gapless.expectedUsableMp3SampleFrames,
		);
		expect(result).toMatchObject({
			status: "VALID",
			facts: {
				sourceSampleCount: String(
					mp3FixtureProvenance.gapless.expectedUsableMp3SampleFrames,
				),
			},
		});
	});

	it("fails closed when decoded scalar samples disagree with proven MPEG frames", () => {
		expect(
			validateDecodedMp3SampleDomain(
				{
					samplingRate: 44100,
					numChannels: 2,
					numSamples: 47230,
					pcmLength: 47230,
				},
				{
					sampleRate: 44100,
					channels: 2,
					encoderDelay: 0,
					endPadding: 0,
					frameCount: 41,
					decodedSampleFrames: 23616,
				},
			),
		).toMatchObject({
			status: "UNSUPPORTED",
			reasonCode: "AUDIO_SAMPLE_DOMAIN_UNPROVABLE",
		});
	});

	it("accepts a valid ID3v2-prefixed MP3 at the post-tag frame boundary", async () => {
		expect(
			await loadVoiceFixture(
				id3PrefixedMp3Fixture,
				mp3FixtureProvenance.id3Prefixed.expectedUsableMp3SampleFrames,
			),
		).toMatchObject({
			status: "VALID",
			facts: {
				sourceSampleCount: String(
					mp3FixtureProvenance.id3Prefixed.expectedUsableMp3SampleFrames,
				),
			},
		});
	});

	it.each([
		["missing Xing frame flag", missingFrameFlagMp3Fixture],
		["malformed frame count", malformedFrameCountMp3Fixture],
		["malformed LAME gapless bytes", malformedLameMp3Fixture],
	] as const)("rejects %s as unprovable", async (_label, fixture) => {
		expect(await loadVoiceFixture(fixture)).toMatchObject({
			status: "UNSUPPORTED",
			reasonCode: "AUDIO_SAMPLE_DOMAIN_UNPROVABLE",
		});
	});

	it("matches checked-in MP3 fixture provenance hashes", () => {
		expect(sha256Bytes(monoMp3Fixture.bytes)).toBe(
			mp3FixtureProvenance.mono.encodedFixtureSha256,
		);
		expect(sha256Bytes(stereoMp3Fixture.bytes)).toBe(
			mp3FixtureProvenance.stereo.encodedFixtureSha256,
		);
		expect(sha256Bytes(validGaplessMp3Fixture.bytes)).toBe(
			mp3FixtureProvenance.gapless.encodedFixtureSha256,
		);
		expect(sha256Bytes(id3PrefixedMp3Fixture.bytes)).toBe(
			mp3FixtureProvenance.id3Prefixed.encodedFixtureSha256,
		);
	});

	it("classifies voice checksum/MIME, missing, and transient failures", async () => {
		const bytes = supportedMp3Fixture();
		const artifact = voiceArtifact(bytes);
		const pin = voicePin(artifact);
		const loader = (
			findVoiceArtifact: NonNullable<
				ConstructorParameters<
					typeof CompositionTechnicalLoader
				>[0]["findVoiceArtifact"]
			>,
		) =>
			new CompositionTechnicalLoader({
				actor,
				projectId: "p1",
				findVoiceArtifact,
				voiceStorage: () => voiceStorage(bytes),
			});
		expect(
			await loader(async () => artifact).loadVoice({
				...pin,
				semantic: { ...pin.semantic, checksum: "0".repeat(64) },
			}),
		).toMatchObject({
			status: "INVALID",
			reasonCode: "VOICE_CHECKSUM_MISMATCH",
		});
		expect(
			await loader(async () => artifact).loadVoice({
				...pin,
				semantic: { ...pin.semantic, mimeType: "audio/wav" },
			} as unknown as CompositionInputV1["voice"]["segments"][number]),
		).toMatchObject({
			status: "INVALID",
			reasonCode: "VOICE_MIME_MISMATCH",
		});
		expect(await loader(async () => undefined).loadVoice(pin)).toMatchObject({
			status: "INVALID",
			reasonCode: "MISSING_VOICE_OBJECT",
		});
		expect(
			await loader(async () => {
				throw new Error("storage outage");
			}).loadVoice(pin),
		).toMatchObject({
			status: "UNKNOWN",
			reasonCode: "DEPENDENCY_READ_UNAVAILABLE",
		});
	});

	it("fails closed when the MP3 sample domain is not provable", async () => {
		const bytes = supportedMp3Fixture();
		bytes.fill(0, 36, 54);
		const artifact = voiceArtifact(bytes);
		const loader = new CompositionTechnicalLoader({
			actor,
			projectId: "p1",
			findVoiceArtifact: async () => artifact,
			voiceStorage: () => voiceStorage(bytes),
		});
		const result = await loader.loadVoice({
			segmentKey: artifact.segmentKey,
			semantic: {
				checksum: artifact.checksum ?? "",
				mimeType: "audio/mpeg",
				byteSize: bytes.byteLength,
				sourceSampleRate: 44100,
				sourceSampleCount: String(validGaplessMp3Fixture.sourceSampleFrames),
				durationMs: 999,
			},
			provenance: {
				artifactId: artifact.id,
				sourceScriptVersionId: artifact.sourceScriptVersionId,
				sourceScriptRevision: artifact.sourceScriptRevision,
				textSnapshot: artifact.segmentTextSnapshot,
				textHash: artifact.textHash,
				configId: "config-1",
				configRevision: artifact.voiceConfigRevision,
				provider: artifact.provider,
				voiceId: artifact.voiceId,
				language: artifact.language,
				speed: artifact.speed,
				storageProvider: "local",
			},
		});
		expect(result).toMatchObject({
			status: "UNSUPPORTED",
			reasonCode: "AUDIO_SAMPLE_DOMAIN_UNPROVABLE",
		});
	});

	it("accepts exact timing and rejects a one-sample mismatch", () => {
		const track = {
			trackId: "track-1",
			sourceVoiceKey: "voice-1",
			startFrame: "0",
			durationFrames: "30",
			endFrame: "30",
			trimStartSample: "0",
			trimEndSample: "44100",
			gainMilliDb: 0,
			panBasisPoints: 0,
			fadeInSamples: "0",
			fadeOutSamples: "0",
		} satisfies CompositionInputV1["sceneComposition"]["audioTracks"][number];
		expect(
			checkCompositionAudioTiming(
				track,
				{
					sourceSampleRate: 44100,
					sourceSampleCount: "47232",
				},
				{ numerator: 30, denominator: 1 },
				"32",
			),
		).toEqual({ ok: true });
		expect(
			checkCompositionAudioTiming(
				{
					...track,
					trimEndSample: "44099",
					durationFrames: "30",
					endFrame: "30",
				},
				{
					sourceSampleRate: 44100,
					sourceSampleCount: "47232",
				},
				{ numerator: 30, denominator: 1 },
				"32",
			),
		).toMatchObject({
			ok: false,
			reasonCode: "AUDIO_TIMING_NOT_FEASIBLE",
		});
		expect(
			checkCompositionAudioTiming(
				{ ...track, trimEndSample: "47233" },
				{ sourceSampleRate: 44100, sourceSampleCount: "47232" },
			),
		).toMatchObject({ ok: false });
		expect(
			checkCompositionAudioTiming(
				{ ...track, trimStartSample: "44100", trimEndSample: "44100" },
				{ sourceSampleRate: 44100, sourceSampleCount: "47232" },
			),
		).toMatchObject({ ok: false });
		expect(
			checkCompositionAudioTiming(
				{ ...track, endFrame: "31" },
				{ sourceSampleRate: 44100, sourceSampleCount: "47232" },
			),
		).toMatchObject({ ok: false });
	});

	it("rejects unavailable fonts and unsupported glyphs without fallback", async () => {
		const manifest = await readFontAssetManifest();
		const face = manifest.faces.find((item) => item.weight === 700);
		if (!face) throw new Error("font fixture missing");
		const pin = {
			family: face.family,
			weight: face.weight,
			style: face.style,
			fontId: face.fontStableId,
			contentSha256: face.sha256,
		} as CompositionInputV1["fonts"]["faces"][number];
		const missing = new CompositionTechnicalLoader({
			actor,
			projectId: "p1",
			fontReadFile: async () => {
				throw new Error("font missing");
			},
		});
		expect(await missing.loadFont(pin)).toMatchObject({
			status: "INVALID",
			reasonCode: "FONT_NOT_AVAILABLE",
		});
		const loader = new CompositionTechnicalLoader({ actor, projectId: "p1" });
		const composed = await loader.loadFont(pin, ["ắ"]);
		const decomposed = await loader.loadFont(pin, ["ắ".normalize("NFD")]);
		expect(composed).toMatchObject({ status: "VALID" });
		expect(decomposed).toMatchObject({ status: "VALID" });
		if (composed.status === "VALID" && decomposed.status === "VALID") {
			expect(decomposed.facts.glyphCodePoints).toEqual(
				composed.facts.glyphCodePoints,
			);
		}
		expect(await loader.loadFont(pin, ["😀"])).toMatchObject({
			status: "UNSUPPORTED",
			reasonCode: "FONT_UNSUPPORTED",
		});
		expect(
			await loader.loadFont({ ...pin, contentSha256: "0".repeat(64) }),
		).toMatchObject({
			status: "INVALID",
			reasonCode: "FONT_METADATA_MISMATCH",
		});
		const originalFont = new Uint8Array(
			await readFile(
				new URL(
					`../../../../../packages/api/src/render-assets/fonts/affichannel-fonts-v1/${face.fileName}`,
					import.meta.url,
				),
			),
		);
		const corruptedFont = new Uint8Array(originalFont);
		corruptedFont[0] = (corruptedFont[0] ?? 0) ^ 0xff;
		const corruptedLoader = new CompositionTechnicalLoader({
			actor,
			projectId: "p1",
			fontReadFile: async () => corruptedFont,
		});
		expect(await corruptedLoader.loadFont(pin)).toMatchObject({
			status: "INVALID",
			reasonCode: "FONT_CHECKSUM_MISMATCH",
		});
		const nonBmp = await loader.loadFont(pin, ["𐐷"]);
		expect(nonBmp.status).toBe("UNSUPPORTED");
	});

	it("returns a valid ephemeral manifest without mutating the input", async () => {
		const mediaBytes = pngFixture();
		const voiceBytes = supportedMp3Fixture();
		const media = mediaAsset(mediaBytes);
		const voice = voiceArtifact(voiceBytes);
		const manifest = await readFontAssetManifest();
		const fonts = manifest.faces.map((face) => ({
			family: face.family,
			weight: face.weight,
			style: face.style,
			fontId: face.fontStableId,
			contentSha256: face.sha256,
		})) as CompositionInputV1["fonts"]["faces"];
		const built = await compositionFixture(fonts, media, voice);
		expect(built.ok).toBe(true);
		if (!built.ok) return;
		const before = JSON.stringify(built.input);
		const loader = new CompositionTechnicalLoader({
			actor,
			projectId: "p1",
			findMediaAsset: async () => media,
			findVoiceArtifact: async () => voice,
			mediaStorage: () => mediaStorage(mediaBytes),
			voiceStorage: () => voiceStorage(voiceBytes),
		});
		const result = await technicalPreflightCompositionInput(
			loader,
			"cv-1",
			built.input,
			built.fingerprint,
		);
		expect(result.status).toBe("VALID");
		expect(result.technicalManifest?.schemaVersion).toBe(
			"composition-technical-manifest.v1",
		);
		expect(JSON.stringify(built.input)).toBe(before);
	});
});
