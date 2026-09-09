import type { MediaAssetStorage } from "@affichannel/api/media/media-asset-storage";
import {
	CompositionPreviewAccessError,
	createCompositionPreviewDependencyGrant,
	readCompositionPreviewDependency,
} from "@affichannel/api/services/composition-preview-grants";
import type { CompositionVersionReadModel } from "@affichannel/api/services/composition-version-repository";
import type { MediaAssetRecord } from "@affichannel/api/services/media-asset-repository";
import { sha256Bytes } from "@affichannel/api/services/voice-segment-hashing";
import type { VoiceAudioStorage } from "@affichannel/api/storage/voice-audio-storage";
import type {
	CompositionInputV1,
	TechnicalPreflightResult,
	VoiceSegmentArtifact,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const actor = { workspaceId: "workspace-1", userId: "user-1" } as const;
const bytes = new Uint8Array([1, 2, 3, 4]);
const checksum = sha256Bytes(bytes);

function makeAuthorities() {
	const pin = {
		dependencyKey: "media-1",
		role: "background",
		semantic: {
			mediaType: "image",
			mimeType: "image/png",
			checksumSha256: checksum,
			byteSize: bytes.byteLength,
			width: 1,
			height: 1,
			durationMs: null,
		},
		provenance: {
			mediaAssetId: "media-1",
			workspaceId: actor.workspaceId,
			projectId: "project-1",
		},
	} as CompositionInputV1["media"][number];
	const version = {
		id: "composition-1",
		workspaceId: actor.workspaceId,
		projectId: "project-1",
		compositionFingerprint: "composition-fingerprint",
		compositionInput: { media: [pin] },
	} as unknown as CompositionVersionReadModel;
	const asset = {
		id: "media-1",
		workspaceId: actor.workspaceId,
		storageProvider: "local",
		storageKey: "media/v1/workspace-1/media-1/object.png",
		checksumSha256: checksum,
		byteSize: bytes.byteLength,
		mimeType: "image/png",
	} as unknown as MediaAssetRecord;
	const mutableAsset = asset as unknown as { checksumSha256: string };
	const preflightResult = {
		status: "VALID",
		retryable: false,
		reasonCode: null,
		compositionVersionId: version.id,
		compositionFingerprint: version.compositionFingerprint,
		issues: [],
		technicalManifest: {
			schemaVersion: "composition-technical-manifest.v1",
			compositionFingerprint: version.compositionFingerprint,
			media: [
				{
					dependencyKey: "media-1",
					mediaAssetId: "media-1",
					byteSize: bytes.byteLength,
					checksumSha256: checksum,
					mimeType: "image/png",
					width: 1,
					height: 1,
				},
			],
			voice: [],
			fonts: [],
			timing: [],
		},
	} satisfies TechnicalPreflightResult;
	const storage = {
		get: async (storageKey: string) => {
			expect(storageKey).toBe(asset.storageKey);
			return new Uint8Array(bytes);
		},
	} as unknown as MediaAssetStorage;
	return {
		version,
		asset,
		preflightResult,
		storage,
		findVersion: async () => version,
		preflight: async () => preflightResult,
		findMediaAsset: async () => asset,
		mediaStorage: () => storage,
		mutableAsset,
	};
}

describe("AFF-US-021 protected composition preview dependencies", () => {
	it("issues a scoped short-lived grant and permits exact same-token reuse", async () => {
		const authorities = makeAuthorities();
		const now = new Date("2026-01-01T00:00:00.000Z");
		const grant = await createCompositionPreviewDependencyGrant(
			actor,
			"composition-1",
			"media",
			"media-1",
			{ ...authorities, now: () => now },
		);
		expect(grant).not.toHaveProperty("storageKey");
		expect(grant.token).not.toContain("media/v1/");
		const options = { ...authorities, now: () => now };
		expect(
			await readCompositionPreviewDependency(actor, grant.token, options),
		).toMatchObject({
			contentType: "image/png",
			byteSize: bytes.byteLength,
			checksum,
		});
		expect(
			await readCompositionPreviewDependency(actor, grant.token, options),
		).toMatchObject({
			contentType: "image/png",
		});
	});

	it("denies token tampering, expiry, and a different workspace actor", async () => {
		const authorities = makeAuthorities();
		const now = new Date("2026-01-01T00:00:00.000Z");
		const grant = await createCompositionPreviewDependencyGrant(
			actor,
			"composition-1",
			"media",
			"media-1",
			{ ...authorities, now: () => now, ttlMs: 10 },
		);
		await expect(
			readCompositionPreviewDependency(actor, `${grant.token}x`, {
				...authorities,
				now: () => now,
			}),
		).rejects.toMatchObject({ code: "PREVIEW_GRANT_INVALID" });
		await expect(
			readCompositionPreviewDependency(actor, grant.token, {
				...authorities,
				now: () => new Date(now.getTime() + 11),
			}),
		).rejects.toMatchObject({ code: "PREVIEW_GRANT_EXPIRED" });
		await expect(
			readCompositionPreviewDependency(
				{ workspaceId: "workspace-2", userId: "user-2" },
				grant.token,
				{ ...authorities, now: () => now },
			),
		).rejects.toMatchObject({ code: "PREVIEW_ACCESS_DENIED" });
	});

	it("protects voice dependencies with the same exact version and checksum binding", async () => {
		const base = makeAuthorities();
		const voiceBytes = new Uint8Array([5, 6, 7]);
		const voiceChecksum = sha256Bytes(voiceBytes);
		const voicePin = {
			segmentKey: "voice-1",
			semantic: {
				checksum: voiceChecksum,
				mimeType: "audio/mpeg",
				byteSize: voiceBytes.byteLength,
				sourceSampleRate: 44100,
				sourceSampleCount: "3",
				durationMs: 1,
			},
			provenance: {
				artifactId: "voice-1",
				sourceScriptVersionId: "script-1",
				sourceScriptRevision: 1,
				textSnapshot: "Xin chào",
				textHash: "a".repeat(64),
				configId: "config-1",
				configRevision: 1,
				provider: "fixture",
				voiceId: "fixture-voice",
				language: "vi-VN",
				speed: 1,
				storageProvider: "local",
			},
		} as CompositionInputV1["voice"]["segments"][number];
		const version = {
			...base.version,
			compositionInput: { voice: { segments: [voicePin] } },
		} as unknown as CompositionVersionReadModel;
		const artifact = {
			id: "voice-1",
			workspaceId: actor.workspaceId,
			projectId: "project-1",
			status: "completed",
			storageProvider: "local",
			storageKey: "voice/v1/workspace-1/project-1/voice-1.mp3",
			checksum: voiceChecksum,
			byteSize: voiceBytes.byteLength,
			mimeType: "audio/mpeg",
		} as unknown as VoiceSegmentArtifact;
		const voicePreflight = {
			...base.preflightResult,
			technicalManifest: {
				...base.preflightResult.technicalManifest,
				media: [],
				voice: [
					{
						segmentKey: "voice-1",
						artifactId: "voice-1",
						byteSize: voiceBytes.byteLength,
						checksum: voiceChecksum,
						mimeType: "audio/mpeg" as const,
						sourceSampleRate: 44100,
						sourceSampleCount: "3",
					},
				],
			},
		} satisfies TechnicalPreflightResult;
		const voiceStorage = {
			get: async (storageKey: string) => {
				expect(storageKey).toBe(artifact.storageKey);
				return new Uint8Array(voiceBytes);
			},
		} as unknown as VoiceAudioStorage;
		const authorities = {
			...base,
			version,
			findVersion: async () => version,
			preflight: async () => voicePreflight,
			findVoiceArtifact: async () => artifact,
			voiceStorage: () => voiceStorage,
		};
		const grant = await createCompositionPreviewDependencyGrant(
			actor,
			"composition-1",
			"voice",
			"voice-1",
			authorities,
		);
		expect(
			await readCompositionPreviewDependency(actor, grant.token, authorities),
		).toMatchObject({
			contentType: "audio/mpeg",
			checksum: voiceChecksum,
		});
	});

	it.each([
		[
			"dependency substitution",
			(authorities: ReturnType<typeof makeAuthorities>) => {
				(
					authorities.version.compositionInput as unknown as {
						media: unknown[];
					}
				).media = [];
			},
		],
		[
			"checksum substitution",
			(authorities: ReturnType<typeof makeAuthorities>) => {
				authorities.mutableAsset.checksumSha256 = "0".repeat(64);
			},
		],
		[
			"composition version substitution",
			(authorities: ReturnType<typeof makeAuthorities>) => {
				authorities.version.id = "composition-2";
			},
		],
		[
			"project substitution",
			(authorities: ReturnType<typeof makeAuthorities>) => {
				authorities.version.projectId = "project-2";
			},
		],
	] as const)(
		"denies %s after authoritative binding changes",
		async (_label, mutate) => {
			const authorities = makeAuthorities();
			const grant = await createCompositionPreviewDependencyGrant(
				actor,
				"composition-1",
				"media",
				"media-1",
				{ ...authorities, now: () => new Date("2026-01-01T00:00:00.000Z") },
			);
			mutate(authorities);
			await expect(
				readCompositionPreviewDependency(actor, grant.token, {
					...authorities,
					now: () => new Date("2026-01-01T00:00:00.000Z"),
				}),
			).rejects.toBeInstanceOf(CompositionPreviewAccessError);
		},
	);
});
