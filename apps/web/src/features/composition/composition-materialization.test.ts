import type { ServerOwnedCompositionAuthorities } from "@affichannel/api/services/composition-assembly-service";
import {
	assembleCompositionInputV1,
	materializeServerOwnedRenderInputs,
} from "@affichannel/api/services/composition-assembly-service";
import {
	type CompositionVersionCreationDependencies,
	createCompositionVersion,
} from "@affichannel/api/services/composition-service";
import type { CompositionTechnicalLoader } from "@affichannel/api/services/composition-technical-loader";
import type { CompositionVersionReadModel } from "@affichannel/api/services/composition-version-repository";
import {
	defaultOutputRules,
	type MediaAsset,
	type ScriptVersionReadModel,
	type VoiceConfig,
	type VoiceSegmentArtifact,
} from "@affichannel/core";
import { describe, expect, it, vi } from "vitest";

const actor = { workspaceId: "workspace-1", userId: "user-1" } as const;

function script(overrides: { durationSeconds?: number } = {}) {
	return {
		id: "script-1",
		workspaceId: actor.workspaceId,
		projectId: "project-1",
		sourceGenerationId: "generation-1",
		status: "draft",
		versionNumber: 1,
		revision: 1,
		restoredFromVersionId: null,
		createdByUserId: actor.userId,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		savedAt: null,
		editableSnapshot: {
			schemaVersion: "script-draft.v2",
			language: "vi-VN",
			hookVariants: [{ key: "hook-1", text: "Hook" }],
			selectedHookKey: "hook-1",
			voiceoverSegments: [{ key: "voice-1", text: "Xin chào" }],
			scenes: [
				{
					order: 1,
					durationSeconds: overrides.durationSeconds ?? 1,
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
	} as ScriptVersionReadModel;
}

function voiceArtifact(overrides: Partial<VoiceSegmentArtifact> = {}) {
	return {
		id: "voice-1",
		workspaceId: actor.workspaceId,
		projectId: "project-1",
		sourceScriptVersionId: "script-1",
		sourceScriptRevision: 1,
		segmentKey: "voice-1",
		segmentTextSnapshot: "Xin chào",
		textHash: "a".repeat(64),
		voiceConfigRevision: 1,
		provider: "fixture",
		voiceId: "fixture-voice",
		language: "vi-VN",
		speed: 1,
		createdByUserId: actor.userId,
		idempotencyKey: "voice-idempotency",
		requestHash: "b".repeat(64),
		status: "completed",
		providerRequestId: null,
		errorCode: null,
		storageProvider: "local",
		storageKey: "voice/v1/workspace-1/project-1/voice-1.mp3",
		mimeType: "audio/mpeg",
		byteSize: 4,
		checksum: "c".repeat(64),
		durationMs: 1_000,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		finishedAt: new Date("2026-01-01T00:00:01.000Z"),
		...overrides,
	} as VoiceSegmentArtifact;
}

function mediaAsset(overrides: Partial<MediaAsset> = {}) {
	return {
		id: "media-1",
		workspaceId: actor.workspaceId,
		createdByUserId: actor.userId,
		origin: "user_upload",
		mediaType: "image",
		status: "ready",
		storageProvider: "local",
		storageKey: "media/v1/workspace-1/media-1/object.png",
		uploadSessionId: "upload-1",
		prepareIdempotencyKey: "prepare-1",
		uploadExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
		originalFilename: "object.png",
		displayName: "Object",
		declaredMimeType: "image/png",
		mimeType: "image/png",
		byteSize: 4,
		checksumSha256: "d".repeat(64),
		width: 1,
		height: 1,
		durationMs: null,
		usageRights: "owned",
		tags: [],
		failureCode: null,
		finalizedAt: new Date("2026-01-01T00:00:00.000Z"),
		archivedAt: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		...overrides,
	} as MediaAsset;
}

function loader(options: {
	voiceStatus?: "VALID" | "UNSUPPORTED";
	mediaStatus?: "VALID" | "INVALID";
	fontStatus?: "VALID" | "INVALID";
}) {
	const voiceStatus = options.voiceStatus ?? "VALID";
	const mediaStatus = options.mediaStatus ?? "VALID";
	const fontStatus = options.fontStatus ?? "VALID";
	return {
		inspectVoiceArtifact: vi.fn(async () =>
			voiceStatus === "VALID"
				? {
						status: "VALID" as const,
						facts: {
							segmentKey: "voice-1",
							artifactId: "voice-1",
							byteSize: 4,
							checksum: "c".repeat(64),
							mimeType: "audio/mpeg" as const,
							sourceSampleRate: 44100,
							sourceSampleCount: "44100",
						},
						bytes: new Uint8Array([1, 2, 3, 4]),
					}
				: {
						status: "UNSUPPORTED" as const,
						reasonCode: "AUDIO_SAMPLE_DOMAIN_UNPROVABLE" as const,
						issue: "fixture cannot prove samples",
					},
		),
		inspectMediaAsset: vi.fn(async () =>
			mediaStatus === "VALID"
				? {
						status: "VALID" as const,
						facts: {
							dependencyKey: "media-1",
							mediaAssetId: "media-1",
							byteSize: 4,
							checksumSha256: "d".repeat(64),
							mimeType: "image/png" as const,
							width: 1,
							height: 1,
						},
						bytes: new Uint8Array([1, 2, 3, 4]),
					}
				: {
						status: "INVALID" as const,
						reasonCode: "MISSING_MEDIA_OBJECT" as const,
						issue: "fixture media missing",
					},
		),
		loadBundledFontBundle: vi.fn(async () =>
			fontStatus === "VALID"
				? {
						status: "VALID" as const,
						facts: [
							...([400, 600, 700] as const).map((weight) => ({
								fontStableId: `noto-sans-${weight}`,
								family: "Noto Sans" as const,
								weight,
								style: "normal" as const,
								format: "ttf" as const,
								byteLength: 1,
								sha256: "e".repeat(64),
								glyphCodePoints: [],
							})),
						],
					}
				: {
						status: "INVALID" as const,
						reasonCode: "FONT_NOT_AVAILABLE" as const,
						issue: "fixture font missing",
					},
		),
	} as unknown as CompositionTechnicalLoader;
}

function authorities(
	materialization: Awaited<
		ReturnType<typeof materializeServerOwnedRenderInputs>
	>,
	scriptRecord = script(),
	voice = voiceArtifact(),
	media = mediaAsset(),
): ServerOwnedCompositionAuthorities {
	const voiceConfig: VoiceConfig = {
		id: "config-1",
		workspaceId: actor.workspaceId,
		projectId: "project-1",
		provider: "fixture",
		voiceId: "fixture-voice",
		language: "vi-VN",
		speed: 1,
		revision: 1,
		createdBy: actor.userId,
		updatedBy: actor.userId,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	};
	return {
		project: {} as ServerOwnedCompositionAuthorities["project"],
		script: scriptRecord,
		voiceConfig,
		voiceArtifacts: [voice],
		media: [
			{ dependencyKey: "media-1", role: "project_resource", asset: media },
		],
		outputRules: defaultOutputRules,
		renderMaterialization: materialization,
	};
}

async function materialize(
	overrides: Parameters<typeof loader>[0] = {},
	durationSeconds = 1,
) {
	const scriptRecord = script({ durationSeconds });
	return materializeServerOwnedRenderInputs({
		actor,
		projectId: "project-1",
		script: scriptRecord,
		voiceConfig: {
			id: "config-1",
			workspaceId: actor.workspaceId,
			projectId: "project-1",
			provider: "fixture",
			voiceId: "fixture-voice",
			language: "vi-VN",
			speed: 1,
			revision: 1,
			createdBy: actor.userId,
			updatedBy: actor.userId,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		},
		voiceArtifacts: [voiceArtifact()],
		media: [
			{
				dependencyKey: "media-1",
				role: "project_resource",
				asset: mediaAsset(),
			},
		],
		loader: loader(overrides),
	});
}

describe("AFF-US-021 server-owned materialization", () => {
	it("materializes authoritative technical dependencies and inserts once", async () => {
		const materialization = await materialize();
		expect(materialization.timeline?.totalFrames).toBe("30");
		const insert = vi.fn(async () => ({ id: "composition-1" }));
		const result = await createCompositionVersion(actor, "project-1", {
			assemble: async () =>
				assembleCompositionInputV1(actor, "project-1", {
					read: async () => authorities(materialization),
				}),
			insert: insert as unknown as (
				input: Parameters<
					NonNullable<CompositionVersionCreationDependencies["insert"]>
				>[0],
			) => Promise<CompositionVersionReadModel>,
		});
		expect(result).toEqual({ id: "composition-1" });
		expect(insert).toHaveBeenCalledTimes(1);
	});

	it.each([
		[
			"unprovable voice sample domain",
			{ voiceStatus: "UNSUPPORTED" as const },
			undefined,
		],
		["missing media object", { mediaStatus: "INVALID" as const }, undefined],
		["missing font", { fontStatus: "INVALID" as const }, undefined],
		["invalid scene timing", {}, 0],
	] as const)(
		"does not insert after %s",
		async (_label, options, durationSeconds) => {
			const materialization = await materialize(options, durationSeconds ?? 1);
			const invalidScript =
				durationSeconds === undefined ? script() : script({ durationSeconds });
			const insert = vi.fn();
			await expect(
				createCompositionVersion(actor, "project-1", {
					assemble: async () =>
						assembleCompositionInputV1(actor, "project-1", {
							read: async () => authorities(materialization, invalidScript),
						}),
					insert: insert as never,
				}),
			).rejects.toMatchObject({
				code:
					durationSeconds === undefined
						? "COMPOSITION_INPUT_INCOMPLETE"
						: "COMPOSITION_INPUT_INVALID",
			});
			expect(insert).not.toHaveBeenCalled();
		},
	);
});
