import { resolve } from "node:path";
import type { CompositionVersionReadModel } from "@affichannel/api/services/composition-version-repository";
import type { MediaAssetRecord } from "@affichannel/api/services/media-asset-repository";
import {
	buildQuickImageCommandPlan,
	compileQuickImageColorMetadata,
	compileQuickImageCoverRaster,
	compileQuickImageMotion,
} from "@affichannel/api/services/quick-image-command-plan";
import {
	createQuickImageServerOwnedPath,
	createQuickImageSourceMaterializationSpec,
} from "@affichannel/api/services/quick-image-materialization";
import {
	buildQuickImageRenderPlan,
	preflightAndBuildQuickImageRenderPlan,
} from "@affichannel/api/services/quick-image-render-plan";
import {
	preflightQuickImageRender,
	type QuickImageRenderPreflightDependencies,
} from "@affichannel/api/services/quick-image-render-preflight";
import { validateRenderOutputBytes } from "@affichannel/api/services/render-output-validator";
import type { WorkspaceActor } from "@affichannel/api/services/workspace";
import {
	buildCompositionInputV2QuickImage,
	canonicalCompositionSemanticJsonV2,
	createQuickImageRenderRequest,
	fingerprintQuickImageRenderRequest,
	fingerprintT09PrototypeProfile,
	fingerprintVideoOnlyOutputProfile,
	MP4_H264_VIDEO_ONLY_V1,
	type QuickImageRenderPlan,
	resolveQuickImageCoverGeometry,
	resolveQuickImageZoomForFrame,
	sha256Hex,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";
import { deterministicVideoOnlyRenderOutputFixtureForFrames } from "./render-output-fixture";

const actor: WorkspaceActor = {
	workspaceId: "workspace-d1",
	userId: "user-d1",
};

async function authority(
	input: {
		durationSeconds?: 5 | 10 | 15;
		mimeType?: "image/jpeg" | "image/png" | "image/webp";
		checksumSha256?: string;
		width?: number;
		height?: number;
	} = {},
) {
	const source = {
		id: "asset-d1-a",
		workspaceId: actor.workspaceId,
		checksumSha256: input.checksumSha256 ?? "a".repeat(64),
		storageProvider: "local" as const,
		storageKey: "media/v1/workspace-d1/asset-d1-a/image",
		mimeType: input.mimeType ?? ("image/png" as const),
		byteSize: 1024,
		width: input.width ?? 800,
		height: input.height ?? 600,
	};
	const built = await buildCompositionInputV2QuickImage({
		workspaceId: actor.workspaceId,
		projectId: "project-d1",
		source,
		durationSeconds: input.durationSeconds ?? 10,
	});
	if (!built.ok) throw new Error(built.code);
	const version = {
		id: "composition-d1-a",
		workspaceId: actor.workspaceId,
		projectId: "project-d1",
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
		status: "ready",
		storageProvider: source.storageProvider,
		storageKey: source.storageKey,
		checksumSha256: source.checksumSha256,
		byteSize: source.byteSize,
		mimeType: source.mimeType,
		width: source.width,
		height: source.height,
	} as MediaAssetRecord;
	const dependencies: QuickImageRenderPreflightDependencies = {
		findVersion: async () => version,
		findMediaAsset: async () => asset,
	};
	return { source, built, version, asset, dependencies };
}

async function planFor(input: Parameters<typeof authority>[0] = {}) {
	const base = await authority(input);
	const result = await preflightAndBuildQuickImageRenderPlan(
		actor,
		"project-d1",
		base.version.id,
		base.dependencies,
	);
	if (!result.ok) throw new Error(result.message);
	return { ...base, plan: result.value };
}

async function commandForPlan(plan: QuickImageRenderPlan) {
	const inputPath = createQuickImageServerOwnedPath({
		rootPath: resolve(process.cwd(), ".d1-contract"),
		relativePath: "attempts/job/attempt/1/source.png",
	});
	const outputPath = createQuickImageServerOwnedPath({
		rootPath: resolve(process.cwd(), ".d1-contract"),
		relativePath: "attempts/job/attempt/1/output.mp4",
	});
	return buildQuickImageCommandPlan({ plan, inputPath, outputPath });
}

async function quickOutputExpectation(durationSeconds: 5 | 10 | 15) {
	const base = await authority({ durationSeconds });
	return {
		kind: "QUICK_IMAGE" as const,
		compositionInput: base.built.input,
		outputProfile: MP4_H264_VIDEO_ONLY_V1,
		outputProfileFingerprint: await fingerprintVideoOnlyOutputProfile(),
		outputContractVersion: "quick-image-output.v1" as const,
		expectedColorRange: "LIMITED_TV" as const,
	};
}

describe("AFF-US-022-D1 Quick Image static render contract", () => {
	it("creates the new production video-only profile without changing T09", async () => {
		expect(MP4_H264_VIDEO_ONLY_V1).toMatchObject({
			id: "mp4-h264-video-only-v1",
			container: "MP4",
			videoCodec: "H.264/AVC",
			pixelFormat: "yuv420p",
			width: 1080,
			height: 1920,
			fps: { numerator: 30, denominator: 1 },
			audio: "NONE",
			colorRange: "LIMITED_TV",
		});
		expect(await fingerprintVideoOnlyOutputProfile()).toBe(
			"6e72408da1c49c0f869ecb286bb89644fc6142a3a684a9f168f85f30384efb26",
		);
		expect(await fingerprintVideoOnlyOutputProfile()).not.toBe(
			await fingerprintT09PrototypeProfile(),
		);
	});

	it.each([
		[5, 150],
		[10, 300],
		[15, 450],
	] as const)("freezes %s seconds as %s frames", async (duration, frames) => {
		const { plan } = await planFor({ durationSeconds: duration });
		expect(plan.timeline).toMatchObject({
			durationSeconds: duration,
			totalFrames: frames,
			fps: { numerator: 30, denominator: 1 },
		});
		expect(plan).toMatchObject({
			kind: "QUICK_IMAGE",
			fit: "CENTERED_COVER",
			audio: "NONE",
			text: "NONE",
			outputContractVersion: "quick-image-output.v1",
		});
		expect(plan.planFingerprint).toMatch(/^[a-f0-9]{64}$/);
	});

	it("uses only the frozen CompositionVersion for historical A-to-B behavior", async () => {
		const currentSourceReads = 0;
		const currentSettingsReads = 0;
		const base = await authority({ durationSeconds: 5 });
		const replacement = await authority({
			durationSeconds: 10,
			checksumSha256: "b".repeat(64),
		});
		const preflight = await preflightQuickImageRender(
			actor,
			"project-d1",
			base.version.id,
			base.dependencies,
		);
		if (!preflight.ok) throw new Error(preflight.message);
		const plan = await buildQuickImageRenderPlan(preflight.value);

		// A later current-source/settings mutation is intentionally not an input
		// to either render preflight or plan construction.
		expect(replacement.source.checksumSha256).toBe("b".repeat(64));
		expect(replacement.built.input.timeline.totalFrames).toBe("300");
		expect(plan.source.checksumSha256).toBe(base.source.checksumSha256);
		expect(plan.timeline.totalFrames).toBe(150);
		expect(currentSourceReads).toBe(0);
		expect(currentSettingsReads).toBe(0);
	});

	it("fails closed for unknown or malformed V2", async () => {
		const base = await authority();
		const unknown = await preflightQuickImageRender(
			actor,
			"project-d1",
			base.version.id,
			{
				findVersion: async () =>
					({ ...base.version, schemaVersion: "composition-input.v3" }) as never,
				findMediaAsset: base.dependencies.findMediaAsset,
			},
		);
		expect(unknown).toMatchObject({
			ok: false,
			code: "RENDER_UNSUPPORTED_SCHEMA",
		});

		const malformed = await preflightQuickImageRender(
			actor,
			"project-d1",
			base.version.id,
			{
				findVersion: async () =>
					({
						...base.version,
						compositionInput: {
							...base.version.compositionInput,
							media: [],
						},
					}) as never,
				findMediaAsset: base.dependencies.findMediaAsset,
			},
		);
		expect(malformed).toMatchObject({
			ok: false,
			code: "RENDER_COMPOSITION_INVALID",
		});
	});

	it.each([
		["exact 9:16", 1080, 1920, "WIDER_OR_EQUAL"],
		["landscape", 1920, 1080, "WIDER_OR_EQUAL"],
		["portrait wider than 9:16", 1080, 1440, "WIDER_OR_EQUAL"],
		["narrow portrait", 900, 2000, "NARROWER"],
		["very wide", 4000, 1000, "WIDER_OR_EQUAL"],
		["very tall", 1000, 4000, "NARROWER"],
	] as const)(
		"compiles %s centered cover before zoom",
		async (_name, width, height, branch) => {
			const { plan } = await planFor({ width, height });
			const raster = compileQuickImageCoverRaster(plan);
			const geometry = resolveQuickImageCoverGeometry({
				frameIndex: 0,
				totalFrames: plan.timeline.totalFrames,
				sourceWidth: width,
				sourceHeight: height,
				profile: plan.compositionInput.profile,
			});
			if (!geometry) throw new Error("C1 geometry unexpectedly invalid");

			expect(raster.branch).toBe(branch);
			expect(raster.semanticBaseScale).toBeCloseTo(geometry.baseScale, 12);
			expect(raster.cropWidth).toBe(1080);
			expect(raster.cropHeight).toBe(1920);
			expect(raster.scaledWidth % 2).toBe(0);
			expect(raster.scaledHeight % 2).toBe(0);
			expect(raster.cropX * 2 + raster.cropWidth).toBe(raster.scaledWidth);
			expect(raster.cropY * 2 + raster.cropHeight).toBe(raster.scaledHeight);
			expect(raster.scaledWidth / raster.scaledHeight).toBeCloseTo(
				width / height,
				3,
			);

			const command = await commandForPlan(plan);
			const scaleIndex = command.filterGraph.indexOf("scale=");
			const cropIndex = command.filterGraph.indexOf("crop=");
			const zoomIndex = command.filterGraph.indexOf("zoompan=");
			expect(scaleIndex).toBeGreaterThanOrEqual(0);
			expect(scaleIndex).toBeLessThan(cropIndex);
			expect(cropIndex).toBeLessThan(zoomIndex);
			expect(command.filterGraph).toContain(
				`scale=w=${raster.scaledWidth}:h=${raster.scaledHeight}`,
			);
			expect(command.filterGraph).toContain(
				`crop=w=1080:h=1920:x=${raster.cropX}:y=${raster.cropY}`,
			);
		},
	);

	it.each([150, 300, 450] as const)(
		"matches C1 motion numerically for %s frames",
		async (totalFrames) => {
			const duration = totalFrames === 150 ? 5 : totalFrames === 300 ? 10 : 15;
			const { plan } = await planFor({ durationSeconds: duration });
			const motion = compileQuickImageMotion(plan);
			const command = await commandForPlan(plan);
			const frameIndexes = [0, Math.floor(totalFrames / 2), totalFrames - 1];

			expect(motion.startScale).toBe(1);
			expect(motion.endScale).toBe(1.08);
			expect(motion.finalFrame).toBe(totalFrames - 1);
			expect(command.filterGraph).toContain(`zoompan=z='${motion.expression}'`);
			expect(command.filterGraph).not.toContain("pzoom");
			expect(command.filterGraph).not.toContain("zoom+");

			for (const frameIndex of frameIndexes) {
				const expected = resolveQuickImageZoomForFrame(frameIndex, totalFrames);
				const compiled =
					motion.startScale + motion.delta * (frameIndex / motion.finalFrame);
				expect(expected).not.toBeNull();
				expect(compiled).toBeCloseTo(expected ?? Number.NaN, 12);
			}
			expect(motion.startScale + motion.delta).toBe(1.08);
		},
	);

	it.each(["image/jpeg", "image/png", "image/webp"] as const)(
		"retains the static %s source contract",
		async (mimeType) => {
			const { plan } = await planFor({ mimeType });
			const sourcePath = createQuickImageServerOwnedPath({
				rootPath: resolve(process.cwd(), ".d1-contract"),
				relativePath: "attempts/job/attempt/1/source.input",
			});
			const spec = createQuickImageSourceMaterializationSpec({
				plan,
				destination: sourcePath,
			});
			expect(spec).toMatchObject({
				kind: "QUICK_IMAGE",
				mimeType,
				byteSize: 1024,
				checksumSha256: "a".repeat(64),
			});
		},
	);

	it("compiles a server-owned video-only command without a tool or process", async () => {
		const { plan } = await planFor({ durationSeconds: 10 });
		const command = await commandForPlan(plan);
		const color = compileQuickImageColorMetadata(plan.outputProfile);
		const motion = compileQuickImageMotion(plan);

		expect(command).toMatchObject({
			kind: "QUICK_IMAGE",
			shell: false,
			executablePath: null,
			toolBinding: "US22_TOOL_APPROVAL_REQUIRED",
		});
		expect(command.argv).toContain("-an");
		expect(command.argv).toContain("-color_range");
		expect(command.argv).toContain(color.colorRange);
		expect(command.argv).toContain("-frames:v");
		expect(command.argv).toContain("300");
		expect(command.argv).not.toContain("-c:a");
		expect(command.filterGraph).toContain("scale=w=2560:h=1920");
		expect(command.filterGraph).toContain("crop=w=1080:h=1920:x=740:y=0");
		expect(command.filterGraph).toContain(`zoompan=z='${motion.expression}'`);
		expect(command.filterGraph).toContain(`setrange=${color.colorRange}`);
		expect(command.filterGraph).toContain(`colorspace=all=${color.colorspace}`);
		expect(command.argv.some((value) => value.includes("http://"))).toBe(false);
		expect(command.argv.some((value) => value.includes("https://"))).toBe(
			false,
		);
	});

	it("fails closed for unsupported motion and color metadata", async () => {
		const { plan } = await planFor();
		const unsupportedMotion = {
			...plan,
			motion: { ...plan.motion, kind: "FUTURE_ZOOM" },
		} as unknown as QuickImageRenderPlan;
		await expect(commandForPlan(unsupportedMotion)).rejects.toThrow(
			"QUICK_IMAGE_MOTION_UNSUPPORTED",
		);
		const profileColor = compileQuickImageColorMetadata(plan.outputProfile);
		expect(profileColor.profileColorRange).toBe(plan.outputProfile.colorRange);
		expect(profileColor.colorRange).toBe("tv");
		expect(profileColor.primaries).toBe("bt709");
		expect(profileColor.transfer).toBe("bt709");
		expect(profileColor.colorspace).toBe("bt709");
		const unsupportedColor = {
			...plan.outputProfile,
			colorRange: "FULL_PC",
		} as never;
		expect(() => compileQuickImageColorMetadata(unsupportedColor)).toThrow(
			"QUICK_IMAGE_COLOR_RANGE_UNSUPPORTED",
		);
	});

	it("preserves plan determinism and changes identity when frozen source changes", async () => {
		const first = await planFor({ checksumSha256: "a".repeat(64) });
		const second = await planFor({ checksumSha256: "b".repeat(64) });
		const repeat = await planFor({ checksumSha256: "a".repeat(64) });
		expect(first.plan.planFingerprint).toBe(repeat.plan.planFingerprint);
		expect(first.plan.planFingerprint).not.toBe(second.plan.planFingerprint);
	});

	it("makes the production profile eligible in an additive Quick Image request", async () => {
		const { plan } = await planFor();
		const request = await createQuickImageRenderRequest(plan);
		expect(request).toMatchObject({
			schemaVersion: "render-request.quick-image.v1",
			outputProfile: { id: "mp4-h264-video-only-v1", audio: "NONE" },
			outputContractVersion: "quick-image-output.v1",
		});
		expect(await fingerprintQuickImageRenderRequest(request)).toMatch(
			/^[a-f0-9]{64}$/,
		);
	});

	it.each([
		[5, 150],
		[10, 300],
		[15, 450],
	] as const)(
		"validates exact video-only output %s sec / %s frames",
		async (duration, frames) => {
			const output = deterministicVideoOnlyRenderOutputFixtureForFrames(frames);
			const result = await validateRenderOutputBytes(
				output,
				await quickOutputExpectation(duration),
			);
			expect(result.validatedMetadata).toMatchObject({
				totalFrames: String(frames),
				frameRate: { numerator: 30, denominator: 1 },
				audio: null,
			});
		},
	);

	it.each([
		[150, 149],
		[150, 151],
		[300, 299],
		[300, 301],
		[450, 449],
		[450, 451],
	] as const)(
		"rejects near-miss frame count %s as %s",
		async (actual, expected) => {
			const duration = actual === 150 ? 5 : actual === 300 ? 10 : 15;
			const expectation = await quickOutputExpectation(duration);
			const malformed = {
				...expectation,
				compositionInput: {
					...expectation.compositionInput,
					timeline: {
						...expectation.compositionInput.timeline,
						totalFrames: String(expected),
					},
				},
			} as typeof expectation;
			await expect(
				validateRenderOutputBytes(
					deterministicVideoOnlyRenderOutputFixtureForFrames(actual),
					malformed,
				),
			).rejects.toMatchObject({ code: "RENDER_OUTPUT_INVALID" });
		},
	);
});
