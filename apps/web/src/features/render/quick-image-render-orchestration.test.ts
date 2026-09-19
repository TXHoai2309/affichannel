import {
	createDeniedQuickImageExecutionAdapter,
	createFakeQuickImageExecutionAdapter,
} from "@affichannel/api/services/quick-image-render-execution-adapter";
import type { QuickImageRenderPreflightValue } from "@affichannel/api/services/quick-image-render-preflight";
import {
	retryFailedQuickImageRender,
	startQuickImageRender,
} from "@affichannel/api/services/quick-image-render-service";
import type { RenderJobReadModel } from "@affichannel/api/services/render-job-repository";
import { canonicalQuickImageRenderJobRequestHash } from "@affichannel/api/services/render-job-repository";
import type { WorkspaceActor } from "@affichannel/api/services/workspace";
import {
	buildCompositionInputV2QuickImage,
	canonicalCompositionSemanticJsonV2,
	type QuickImageRenderRequest,
	sha256Hex,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const actor: WorkspaceActor = {
	workspaceId: "d2-workspace",
	userId: "d2-user",
};

async function frozenQuickImage(): Promise<QuickImageRenderPreflightValue> {
	const source = {
		id: "d2-asset-a",
		workspaceId: actor.workspaceId,
		checksumSha256: "a".repeat(64),
		storageProvider: "local" as const,
		storageKey: "media/v1/d2-workspace/d2-asset-a/image.png",
		mimeType: "image/png" as const,
		byteSize: 1024,
		width: 800,
		height: 600,
	};
	const built = await buildCompositionInputV2QuickImage({
		workspaceId: actor.workspaceId,
		projectId: "d2-project",
		source,
		durationSeconds: 5,
	});
	if (!built.ok) throw new Error(built.code);
	const fingerprint = await sha256Hex(
		canonicalCompositionSemanticJsonV2(built.input),
	);
	const version = {
		id: "d2-composition-a",
		workspaceId: actor.workspaceId,
		projectId: "d2-project",
		compositionFingerprint: fingerprint,
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
	};
	const asset = {
		id: source.id,
		workspaceId: actor.workspaceId,
		mediaType: "image",
		status: "ready",
		storageProvider: source.storageProvider,
		storageKey: source.storageKey,
		checksumSha256: source.checksumSha256,
		byteSize: source.byteSize,
		mimeType: source.mimeType,
		width: source.width,
		height: source.height,
	} as QuickImageRenderPreflightValue["asset"];
	return {
		version,
		input: built.input,
		asset,
		dependency: built.input.media[0],
		preflightVersion: "quick-image-render-preflight.v1",
		outputProfile: {
			id: "mp4-h264-video-only-v1",
			container: "MP4",
			videoCodec: "H.264/AVC",
			pixelFormat: "yuv420p",
			width: 1080,
			height: 1920,
			fps: { numerator: 30, denominator: 1 },
			videoBitrateKbps: 2000,
			gop: 30,
			keyint: 30,
			minKeyint: 30,
			scenecut: false,
			bFrames: 0,
			closedGop: true,
			threads: 1,
			colorPrimaries: "BT.709",
			colorTransfer: "BT.709",
			colorSpace: "BT.709",
			colorRange: "LIMITED_TV",
			audio: "NONE",
		},
		outputProfileFingerprint:
			"6e72408da1c49c0f869ecb286bb89644fc6142a3a684a9f168f85f30384efb26",
		outputContractVersion: "quick-image-output.v1",
	};
}

function job(requestSpec: QuickImageRenderRequest): RenderJobReadModel {
	return {
		id: "d2-job-a",
		workspaceId: actor.workspaceId,
		projectId: "d2-project",
		compositionVersionId: requestSpec.compositionVersionId,
		compositionFingerprint: requestSpec.compositionFingerprint,
		canonicalRequestHash: "b".repeat(64),
		requestSpec,
		outputEncodingProfileFingerprint: requestSpec.outputProfileFingerprint,
		outputContractVersion: requestSpec.outputContractVersion,
		operation: "START_RENDER",
		sourceRenderJobId: null,
		idempotencyKey: "d2-key-a",
		status: "FAILED",
		attemptCount: 1,
		reasonCode: "FAKE_PROCESS_FAILED",
		errorCode: "FAKE_PROCESS_FAILED",
		errorMessage: "fake",
		createdAt: new Date(),
		finishedAt: new Date(),
	};
}

describe("AFF-US-022-D2 Quick Image orchestration boundary", () => {
	it("derives a canonical request from the frozen V2 authority only", async () => {
		const value = await frozenQuickImage();
		let created: unknown;
		const started = await startQuickImageRender(
			actor,
			{
				projectId: "d2-project",
				compositionVersionId: value.version.id,
				idempotencyKey: "d2-start-key",
			},
			{
				preflight: async () => ({ ok: true, value }),
				createJob: async (input) => {
					created = input;
					return job(input.requestSpec as QuickImageRenderRequest);
				},
			},
		);
		const request = (created as { requestSpec: QuickImageRenderRequest })
			.requestSpec;
		expect(started.projectId).toBe("d2-project");
		expect(request.schemaVersion).toBe("render-request.quick-image.v1");
		expect(request.compositionVersionId).toBe(value.version.id);
		expect(request.outputProfileFingerprint).toBe(
			"6e72408da1c49c0f869ecb286bb89644fc6142a3a684a9f168f85f30384efb26",
		);
		expect(request).not.toHaveProperty("sourcePath");
		expect(request).not.toHaveProperty("durationSeconds");
	});

	it("uses a new job/key for failed retry and preserves the frozen request", async () => {
		const value = await frozenQuickImage();
		const start = await startQuickImageRender(
			actor,
			{
				projectId: "d2-project",
				compositionVersionId: value.version.id,
				idempotencyKey: "d2-start-key",
			},
			{
				preflight: async () => ({ ok: true, value }),
				createJob: async (input) =>
					job(input.requestSpec as QuickImageRenderRequest),
			},
		);
		const retried = await retryFailedQuickImageRender(
			actor,
			{
				projectId: "d2-project",
				failedRenderJobId: start.id,
				idempotencyKey: "d2-retry-key",
			},
			{
				findJob: async () => start,
				createJob: async (input) => ({
					...start,
					id: "d2-job-b",
					idempotencyKey: input.idempotencyKey,
					requestSpec: input.requestSpec as QuickImageRenderRequest,
				}),
			},
		);
		expect(retried.id).toBe("d2-job-b");
		expect(retried.idempotencyKey).toBe("d2-retry-key");
		expect(retried.compositionVersionId).toBe(start.compositionVersionId);
		expect(retried.requestSpec).toEqual(start.requestSpec);
	});

	it("keeps Quick Image job identity distinct by frozen version ID", async () => {
		const value = await frozenQuickImage();
		const request = {
			schemaVersion: "render-request.quick-image.v1" as const,
			compositionVersionId: value.version.id,
			compositionFingerprint: value.version.compositionFingerprint,
			renderPlanFingerprint: "c".repeat(64),
			outputProfile: value.outputProfile,
			outputProfileFingerprint: value.outputProfileFingerprint,
			outputContractVersion: value.outputContractVersion,
		};
		const other = { ...request, compositionVersionId: "d2-composition-b" };
		expect(await canonicalQuickImageRenderJobRequestHash(request)).not.toBe(
			await canonicalQuickImageRenderJobRequestHash(other),
		);
	});

	it("has an explicit denied default and a pure fake adapter seam", async () => {
		const denied = createDeniedQuickImageExecutionAdapter();
		expect(await denied({} as never)).toMatchObject({
			outcome: "BLOCKED",
			errorCode: "QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED",
		});
		let invoked = false;
		const fake = createFakeQuickImageExecutionAdapter({
			result: async () => {
				invoked = true;
				return { outcome: "INDETERMINATE", errorCode: "FAKE_AMBIGUOUS" };
			},
		});
		expect(await fake({} as never)).toEqual({
			outcome: "INDETERMINATE",
			errorCode: "FAKE_AMBIGUOUS",
		});
		expect(invoked).toBe(true);
	});
});
