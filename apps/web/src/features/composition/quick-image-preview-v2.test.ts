import type { MediaAssetStorage } from "@affichannel/api/media/media-asset-storage";
import { createQuickImageCompositionPreviewDescriptor } from "@affichannel/api/services/composition-preview-descriptor";
import {
	createCompositionPreviewDependencyGrant,
	readCompositionPreviewDependency,
} from "@affichannel/api/services/composition-preview-grants";
import type { CompositionVersionReadModel } from "@affichannel/api/services/composition-version-repository";
import type { MediaAssetRecord } from "@affichannel/api/services/media-asset-repository";
import { sha256Bytes } from "@affichannel/api/services/voice-segment-hashing";
import type { WorkspaceActor } from "@affichannel/api/services/workspace";
import {
	buildCompositionInputV2QuickImage,
	type CompositionInputV2,
	canonicalCompositionSemanticJsonV2,
	sha256Hex,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const actor: WorkspaceActor = { workspaceId: "workspace-1", userId: "user-1" };
const bytes = new Uint8Array([11, 22, 33, 44]);
const checksum = sha256Bytes(bytes);

async function authorities(status: "ready" | "archived" = "ready") {
	const source = {
		id: "asset-1",
		workspaceId: actor.workspaceId,
		checksumSha256: checksum,
		storageProvider: "local" as const,
		storageKey: "media/v1/workspace-1/asset-1/image.png",
		mimeType: "image/png" as const,
		byteSize: bytes.byteLength,
		width: 800,
		height: 600,
	};
	const built = await buildCompositionInputV2QuickImage({
		workspaceId: actor.workspaceId,
		projectId: "project-1",
		source,
		durationSeconds: 10,
	});
	if (!built.ok) throw new Error(built.code);
	const version = {
		id: "composition-1",
		workspaceId: actor.workspaceId,
		projectId: "project-1",
		compositionFingerprint: await sha256Hex(
			canonicalCompositionSemanticJsonV2(built.input),
		),
		createdByUserId: actor.userId,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		schemaVersion: "composition-input.v2" as const,
		compositionInput: built.input,
		sourceScriptVersionId: null,
		sourceScriptRevision: null,
		sourceMediaAssetId: source.id,
		sourceMediaChecksumSha256: source.checksumSha256,
		sourceMediaStorageProvider: source.storageProvider,
		sourceMediaStorageKey: source.storageKey,
		sourceMediaMimeType: source.mimeType,
		sourceMediaByteSize: source.byteSize,
		sourceMediaWidth: source.width,
		sourceMediaHeight: source.height,
	} as CompositionVersionReadModel;
	const asset = {
		id: source.id,
		workspaceId: actor.workspaceId,
		mediaType: "image",
		status,
		storageProvider: source.storageProvider,
		storageKey: source.storageKey,
		checksumSha256: source.checksumSha256,
		byteSize: source.byteSize,
		mimeType: source.mimeType,
		width: source.width,
		height: source.height,
	} as MediaAssetRecord;
	const storage = {
		get: async (key: string) => {
			expect(key).toBe(source.storageKey);
			return new Uint8Array(bytes);
		},
	} as unknown as MediaAssetStorage;
	return {
		version,
		asset,
		findVersion: async () => version,
		findMediaAsset: async () => asset,
		mediaStorage: () => storage,
	};
}

describe("AFF-US-022-C Quick Image V2 preview authority", () => {
	it("describes the frozen profile, timeline, motion, source and protected dependency", async () => {
		const base = await authorities("archived");
		const descriptor = await createQuickImageCompositionPreviewDescriptor(
			actor,
			"project-1",
			"composition-1",
			{ ...base, now: () => new Date("2026-01-01T00:00:00.000Z") },
		);
		expect(descriptor).toMatchObject({
			schemaVersion: "composition-preview-descriptor.v2",
			access: "protected",
			compositionVersionId: "composition-1",
			sourceKind: "QUICK_IMAGE",
			profile: {
				id: "vertical-standard-v1",
				logicalWidth: 1080,
				logicalHeight: 1920,
				aspectRatio: "9:16",
			},
			timeline: {
				durationSeconds: 10,
				fps: { numerator: 30, denominator: 1 },
				totalFrames: 300,
			},
			motion: { kind: "CENTER_ZOOM_IN_V1", startScale: 1, endScale: 1.08 },
			source: { width: 800, height: 600, mimeType: "image/png" },
			dependency: {
				dependencyKey: "quick-image-source",
				contentType: "image/png",
				byteSize: bytes.byteLength,
				checksum,
			},
		});
		expect(descriptor.dependency.token).not.toContain(base.asset.storageKey);
		expect(descriptor).not.toHaveProperty("storageKey");
	});

	it("issues and reads a narrow protected V2 grant without current-source reads", async () => {
		const base = await authorities();
		const now = new Date("2026-01-01T00:00:00.000Z");
		const grant = await createCompositionPreviewDependencyGrant(
			actor,
			"composition-1",
			"media",
			"quick-image-source",
			{ ...base, projectId: "project-1", now: () => now },
		);
		const read = await readCompositionPreviewDependency(actor, grant.token, {
			...base,
			now: () => now,
		});
		expect(read).toMatchObject({
			contentType: "image/png",
			byteSize: bytes.byteLength,
			checksum,
		});
	});

	it("fails closed for wrong project and does not resolve latest/current state", async () => {
		const base = await authorities();
		await expect(
			createQuickImageCompositionPreviewDescriptor(
				actor,
				"project-2",
				"composition-1",
				base,
			),
		).rejects.toMatchObject({
			code: "PREVIEW_PROJECT_MISMATCH",
		});
	});

	it("denies a missing frozen dependency", async () => {
		const base = await authorities();
		await expect(
			createQuickImageCompositionPreviewDescriptor(
				actor,
				"project-1",
				"composition-1",
				{
					...base,
					findMediaAsset: async () => undefined,
				},
			),
		).rejects.toMatchObject({ code: "PREVIEW_DEPENDENCY_MISSING" });
	});

	it.each([
		[
			"unknown V2 schema",
			(base: Awaited<ReturnType<typeof authorities>>) => ({
				...base.version,
				schemaVersion: "composition-input.v3",
			}),
			"PREVIEW_UNSUPPORTED_SCHEMA",
		],
		[
			"malformed V2 input",
			(base: Awaited<ReturnType<typeof authorities>>) => {
				const input = base.version.compositionInput as CompositionInputV2;
				return { ...base.version, compositionInput: { ...input, media: [] } };
			},
			"PREVIEW_COMPOSITION_INVALID",
		],
		[
			"wrong profile",
			(base: Awaited<ReturnType<typeof authorities>>) => {
				const input = base.version.compositionInput as CompositionInputV2;
				return {
					...base.version,
					compositionInput: {
						...input,
						profile: { ...input.profile, logicalWidth: 1 },
					},
				};
			},
			"PREVIEW_COMPOSITION_INVALID",
		],
		[
			"wrong motion",
			(base: Awaited<ReturnType<typeof authorities>>) => {
				const input = base.version.compositionInput as CompositionInputV2;
				return {
					...base.version,
					compositionInput: {
						...input,
						motion: { ...input.motion, endScale: 1.07 },
					},
				};
			},
			"PREVIEW_COMPOSITION_INVALID",
		],
		[
			"missing dependency",
			(base: Awaited<ReturnType<typeof authorities>>) => {
				const input = base.version.compositionInput as CompositionInputV2;
				return { ...base.version, compositionInput: { ...input, media: [] } };
			},
			"PREVIEW_COMPOSITION_INVALID",
		],
		[
			"multiple dependencies",
			(base: Awaited<ReturnType<typeof authorities>>) => {
				const input = base.version.compositionInput as CompositionInputV2;
				return {
					...base.version,
					compositionInput: {
						...input,
						media: [input.media[0], input.media[0]],
					},
				};
			},
			"PREVIEW_COMPOSITION_INVALID",
		],
	] as const)("denies %s", async (_label, mutate, code) => {
		const base = await authorities();
		const version = mutate(base) as CompositionVersionReadModel;
		await expect(
			createQuickImageCompositionPreviewDescriptor(
				actor,
				"project-1",
				"composition-1",
				{ ...base, findVersion: async () => version },
			),
		).rejects.toMatchObject({ code });
	});
});
