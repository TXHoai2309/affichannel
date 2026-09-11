import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildT09FfmpegCommandPlan } from "@affichannel/api/services/render-prototype-command-plan";
import {
	fingerprintT09CompositionFixture,
	T09_COMPOSITION_FIXTURE,
	T09_MEDIA_PNG_BASE64,
} from "@affichannel/api/services/render-prototype-fixture";
import { buildT09RenderPlan } from "@affichannel/api/services/render-prototype-plan";
import {
	layoutT09Text,
	T09_OPEN_TYPE_FEATURES,
} from "@affichannel/api/services/render-prototype-text-layout";
import {
	resolveT09FfmpegTool,
	T09ToolResolutionError,
} from "@affichannel/api/services/render-prototype-tool-resolver";
import {
	fingerprintT09PrototypeProfile,
	materializeT09TextLayout,
	T09_FFMPEG_TOOL_MANIFEST,
	T09_VIDEO_ONLY_PROFILE,
	T09TextLayoutError,
	t09OutputReadySchema,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const fontSha256 =
	"c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a";

function fakeMetrics() {
	return {
		fontStableId: "noto-sans-700",
		fontFamily: "Noto Sans",
		fontWeight: 700 as const,
		fontContentSha256: fontSha256,
		unitsPerEm: 1000,
		ascent: 800,
		hasGlyphs: (text: string) => !text.includes("☃"),
		measureUnits: (text: string) => text.length * 1000,
	};
}

describe("AFF-US-021 21E-A prototype contracts", () => {
	it("keeps the T09 profile internal and video-only", async () => {
		expect(T09_VIDEO_ONLY_PROFILE).toMatchObject({
			id: "mp4-h264-video-only-t09-v1",
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
			color: "BT.709",
			audio: "NONE",
		});
		expect(await fingerprintT09PrototypeProfile()).toBe(
			"a81616db09ba0390b90ef19efd4b20fd06886a3a3b270d053a12c5b29f0ec9ec",
		);
	});

	it("materializes normalized, greedy, pixel-stable text layout", () => {
		const layout = materializeT09TextLayout(
			{
				text: "AB CD EF\r\nGH",
				box: { xPx: 10, yPx: 20, widthPx: 50, heightPx: 100 },
				fontStableId: "noto-sans-700",
				fontFamily: "Noto Sans",
				fontWeight: 700,
				fontSizePx: 10,
				lineHeightPx: 20,
				textAlign: "CENTER",
				maxLines: 4,
				fontContentSha256: fontSha256,
			},
			fakeMetrics(),
		);
		expect(layout.normalizedText).toBe("AB CD EF\nGH");
		expect(layout.lines.map((line) => line.text)).toEqual([
			"AB CD",
			"EF",
			"GH",
		]);
		expect(layout.lines.map((line) => line.measuredWidthPx)).toEqual([
			50, 20, 20,
		]);
		expect(layout.lines.map((line) => line.xPx)).toEqual([10, 25, 25]);
		expect(layout.lines.map((line) => line.baselineYPx)).toEqual([28, 48, 68]);
	});

	it("fails closed for unsupported glyphs and line overflow", () => {
		expect(() =>
			materializeT09TextLayout(
				{
					text: "☃",
					box: { xPx: 0, yPx: 0, widthPx: 100, heightPx: 100 },
					fontStableId: "noto-sans-700",
					fontFamily: "Noto Sans",
					fontWeight: 700,
					fontSizePx: 10,
					lineHeightPx: 20,
					textAlign: "LEFT",
					maxLines: 1,
					fontContentSha256: fontSha256,
				},
				fakeMetrics(),
			),
		).toThrowError(T09TextLayoutError);
		expect(() =>
			materializeT09TextLayout(
				{
					text: "TOOLONG",
					box: { xPx: 0, yPx: 0, widthPx: 10, heightPx: 20 },
					fontStableId: "noto-sans-700",
					fontFamily: "Noto Sans",
					fontWeight: 700,
					fontSizePx: 10,
					lineHeightPx: 20,
					textAlign: "LEFT",
					maxLines: 1,
					fontContentSha256: fontSha256,
				},
				fakeMetrics(),
			),
		).toThrowError(T09TextLayoutError);
	});

	it("uses the pinned fontkit bundle and explicit OpenType features", async () => {
		const layer = T09_COMPOSITION_FIXTURE.scenes[0].textLayer;
		const layout = await layoutT09Text({
			text: layer.text,
			box: layer.box,
			fontStableId: layer.fontStableId,
			fontFamily: layer.fontFamily,
			fontWeight: layer.fontWeight,
			fontSizePx: layer.fontSizePx,
			lineHeightPx: layer.lineHeightPx,
			textAlign: layer.textAlign,
			maxLines: layer.maxLines,
			fontContentSha256: fontSha256,
		});
		expect(layout.version).toBe("affichannel-text-layout-v1");
		expect(layout.lines).toHaveLength(2);
		expect(layout.lines.every((line) => line.measuredWidthPx > 0)).toBe(true);
		expect(T09_OPEN_TYPE_FEATURES).toMatchObject({
			ccmp: true,
			kern: true,
			liga: false,
			clig: false,
			calt: false,
			dlig: false,
			hlig: false,
		});
	});

	it("builds a blocked, deterministic two-scene video-only render plan", async () => {
		const root = resolve(".t09-test-paths");
		const plan = await buildT09RenderPlan({
			tool: {
				manifest: T09_FFMPEG_TOOL_MANIFEST,
				manifestIdentity:
					"affichannel-render-tool-manifest.v1:pending-binary-approval",
			},
			assetPaths: { "t09-background-png": join(root, "background.png") },
			fontFilePaths: { "noto-sans-700": join(root, "NotoSans-Bold.ttf") },
			textFilePaths: {
				"t09-text-scene-1:0": join(root, "scene-1-line-0.txt"),
				"t09-text-scene-1:1": join(root, "scene-1-line-1.txt"),
				"t09-text-scene-2:0": join(root, "scene-2-line-0.txt"),
				"t09-text-scene-2:1": join(root, "scene-2-line-1.txt"),
			},
			outputReservation: {
				jobId: "job-t09",
				attemptId: "attempt-t09",
				attemptNumber: 1,
				outputReservationId: "reservation-t09",
			},
		});
		expect(plan.executionGate).toBe("BLOCKED_PENDING_BINARY_APPROVAL");
		expect(plan.totalFrames).toBe(60);
		expect(plan.inputAssets[0]).toMatchObject({
			sha256:
				"431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
			byteSize: 68,
			width: 1,
			height: 1,
		});
		expect(plan.materializedTextLines).toHaveLength(4);
		expect(T09_COMPOSITION_FIXTURE.audioTracks).toEqual([]);
		expect(await fingerprintT09CompositionFixture()).toBe(
			"11cae6ae3dbccbeb754079e09ea3ad74f149809420b9739d0751a522b3f299a0",
		);
	});

	it("emits an argv array with no shell interpolation or audio", async () => {
		const approvedBinary = "prototype-ffmpeg-binary";
		const binarySha256 = createHash("sha256")
			.update(approvedBinary)
			.digest("hex");
		const manifest = {
			...T09_FFMPEG_TOOL_MANIFEST,
			approvalStatus: "APPROVED" as const,
			version: "pinned-test-build",
			binarySha256,
			buildIdentity: "test-build-identity",
			sourceOrDistributionReference: "owner-approved-test-fixture",
			licenseMetadata: {
				ffmpegLicense: "LGPL-2.1-or-later",
				encoderLicenses: ["x264-license-review-required"],
				noticeSha256: binarySha256,
			},
		};
		const plan = await buildT09RenderPlan({
			tool: { manifest, manifestIdentity: "approved-test-manifest" },
			assetPaths: { "t09-background-png": resolve("asset.png") },
			fontFilePaths: { "noto-sans-700": resolve("NotoSans-Bold.ttf") },
			textFilePaths: {
				"t09-text-scene-1:0": resolve("s1-0.txt"),
				"t09-text-scene-1:1": resolve("s1-1.txt"),
				"t09-text-scene-2:0": resolve("s2-0.txt"),
				"t09-text-scene-2:1": resolve("s2-1.txt"),
			},
			outputReservation: {
				jobId: "job-t09",
				attemptId: "attempt-t09",
				attemptNumber: 1,
				outputReservationId: "reservation-t09",
			},
		});
		const command = buildT09FfmpegCommandPlan({
			plan,
			tool: {
				executablePath: resolve("ffmpeg.exe"),
				manifest,
				manifestIdentity: "approved-test-manifest",
				binarySha256,
			},
			outputPath: resolve("render-output.mp4"),
		});
		expect(command.executablePath).toBe(resolve("ffmpeg.exe"));
		expect(command.argv).toContain("-an");
		expect(command.argv).toContain("-threads");
		expect(command.argv).toContain("1");
		expect(command.argv).not.toContain("-c:a");
		expect(command.argv).not.toContain("aac");
		expect(command.filterGraph).toContain("textfile=");
		expect(command.filterGraph).not.toContain("AFFI");
	});

	it("requires exact approved binary bytes and never falls back to PATH", async () => {
		const root = await mkdtemp(join(tmpdir(), "affichannel-t09-tool-"));
		try {
			const binaryPath = join(root, "ffmpeg.exe");
			const bytes = Buffer.from("exact-test-binary");
			await writeFile(binaryPath, bytes);
			const binarySha256 = createHash("sha256").update(bytes).digest("hex");
			const manifest = {
				...T09_FFMPEG_TOOL_MANIFEST,
				approvalStatus: "APPROVED" as const,
				version: "pinned-test-build",
				binarySha256,
				buildIdentity: "test-build-identity",
				sourceOrDistributionReference: "owner-approved-test-fixture",
				licenseMetadata: {
					ffmpegLicense: "LGPL-2.1-or-later",
					encoderLicenses: ["x264-license-review-required"],
					noticeSha256: binarySha256,
				},
			};
			const resolved = await resolveT09FfmpegTool({
				configuredPath: binaryPath,
				manifest,
			});
			expect(resolved.binarySha256).toBe(binarySha256);
			await expect(
				resolveT09FfmpegTool({
					configuredPath: "ffmpeg.exe",
					manifest,
				}),
			).rejects.toMatchObject({
				code: "T09_FFMPEG_PATH_MUST_BE_ABSOLUTE",
			});
			await expect(
				resolveT09FfmpegTool({
					configuredPath: binaryPath,
					manifest: T09_FFMPEG_TOOL_MANIFEST,
				}),
			).rejects.toBeInstanceOf(T09ToolResolutionError);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps output-ready handoff limited to the reserved attempt", () => {
		const parsed = t09OutputReadySchema.parse({
			schemaVersion: "t09-output-ready.v1",
			kind: "OUTPUT_READY",
			jobId: "job-t09",
			attemptId: "attempt-t09",
			attemptNumber: 1,
			outputReservationId: "reservation-t09",
		});
		expect(parsed).not.toHaveProperty("checksumSha256");
		expect(parsed).not.toHaveProperty("storageKey");
		expect(parsed).not.toHaveProperty("proof");
		expect(() =>
			t09OutputReadySchema.parse({
				...parsed,
				checksumSha256: "not-authority",
			}),
		).toThrow();
	});

	it("keeps the checked-in PNG fixture byte identity explicit", () => {
		const bytes = Buffer.from(T09_MEDIA_PNG_BASE64, "base64");
		expect(bytes.byteLength).toBe(68);
		expect(createHash("sha256").update(bytes).digest("hex")).toBe(
			T09_COMPOSITION_FIXTURE.media[0].sha256,
		);
	});
});
