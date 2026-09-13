import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildT09FfmpegCommandPlan } from "@affichannel/api/services/render-prototype-command-plan";
import {
	buildT09CanonicalCompositionFixture,
	T09_COMPOSITION_FIXTURE,
	T09_MEDIA_PNG_BASE64,
} from "@affichannel/api/services/render-prototype-fixture";
import {
	buildT09RenderPlan,
	T09RenderPlanError,
} from "@affichannel/api/services/render-prototype-plan";
import { createT09ServerOwnedStagingPath } from "@affichannel/api/services/render-prototype-staging";
import {
	inspectT09ShapedRun,
	layoutT09Text,
	T09_OPEN_TYPE_FEATURES,
} from "@affichannel/api/services/render-prototype-text-layout";
import { resolveT09FfmpegTool } from "@affichannel/api/services/render-prototype-tool-resolver";
import {
	buildCompositionInputV1,
	type CompositionInputBuilderSource,
	fingerprintT09PrototypeProfile,
	materializeT09TextLayout,
	type PrototypeToolManifest,
	parseOutputEncodingProfile,
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

async function canonicalFixture() {
	return buildT09CanonicalCompositionFixture();
}

function stagingInputs(root: string) {
	const textFilePaths: Record<
		string,
		ReturnType<typeof createT09ServerOwnedStagingPath>
	> = {};
	for (const layerId of ["t09-text-scene-1", "t09-text-scene-2"]) {
		for (const lineIndex of [0, 1]) {
			textFilePaths[`${layerId}:${lineIndex}`] =
				createT09ServerOwnedStagingPath({
					rootPath: root,
					relativePath: `${layerId}-${lineIndex}.txt`,
				});
		}
	}
	return textFilePaths;
}

function approvedManifest(binarySha256: string, suffix = "a") {
	return {
		...T09_FFMPEG_TOOL_MANIFEST,
		approvalStatus: "APPROVED" as const,
		version: `pinned-test-build-${suffix}`,
		binarySha256,
		buildIdentity: `test-build-identity-${suffix}`,
		sourceOrDistributionReference: `owner-approved-test-fixture-${suffix}`,
		licenseMetadata: {
			ffmpegLicense: "LGPL-2.1-or-later",
			encoderLicenses: ["x264-license-review-required"],
			noticeSha256: binarySha256,
		},
	};
}

async function planFor(input: {
	root: string;
	manifest?: PrototypeToolManifest;
	composition?: Awaited<ReturnType<typeof canonicalFixture>>;
}) {
	const composition = input.composition ?? (await canonicalFixture());
	return buildT09RenderPlan({
		composition,
		tool: { manifest: input.manifest ?? T09_FFMPEG_TOOL_MANIFEST },
		assetPaths: {
			"t09-background-png": resolve(input.root, "background.png"),
		},
		fontFilePaths: {
			"noto-sans-700": resolve(input.root, "NotoSans-Bold.ttf"),
		},
		textFilePaths: stagingInputs(input.root),
		outputReservation: {
			jobId: "job-t09",
			attemptId: "attempt-t09",
			attemptNumber: 1,
			outputReservationId: "reservation-t09",
		},
	});
}

async function commandForPlan(
	root: string,
	plan: Awaited<ReturnType<typeof planFor>>,
	manifest: PrototypeToolManifest,
) {
	const binarySha256 = manifest.binarySha256;
	if (!binarySha256) throw new Error("missing test binary hash");
	return buildT09FfmpegCommandPlan({
		plan,
		tool: {
			executablePath: resolve(root, "ffmpeg.exe"),
			manifest,
			manifestIdentity: plan.exactToolManifestIdentity,
			binarySha256,
		},
		outputPath: createT09ServerOwnedStagingPath({
			rootPath: root,
			relativePath: "render-output.mp4",
		}),
	});
}

function argvValue(argv: readonly string[], flag: string) {
	const index = argv.indexOf(flag);
	if (index < 0 || argv[index + 1] === undefined)
		throw new Error(`Missing argv flag ${flag}`);
	return argv[index + 1] as string;
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

	it("builds canonical CompositionInputV1 and uses its exact fingerprint", async () => {
		const fixture = await canonicalFixture();
		expect(fixture.compositionInput.schemaVersion).toBe("composition-input.v1");
		expect(fixture.compositionInput.sceneComposition.audioTracks).toEqual([]);
		expect(fixture.compositionInput.timeline.totalFrames).toBe("60");
		expect(fixture.compositionFingerprint).toBe(
			"4b8d10c5ee81d5978fa317f2c8e220e8ab1bf979ec85020e2063f1290714bfd9",
		);
		const root = await mkdtemp(join(resolve("."), "t09-canonical-"));
		try {
			const plan = await planFor({ root, composition: fixture });
			expect(plan.compositionFingerprint).toBe(fixture.compositionFingerprint);
			expect(plan.renderLayers.map((layer) => layer.layerId)).toEqual([
				"t09-media-scene-1",
				"t09-text-scene-1",
				"t09-media-scene-2",
				"t09-text-scene-2",
			]);
			expect(plan.renderLayers[1]).toMatchObject({
				kind: "TEXT",
				text: "VIDEO\nDEMO",
				colorRgba: { r: 255, g: 255, b: 255, a: 255 },
				opacityBasisPoints: 10_000,
				zIndex: 1,
				startFrame: 0,
				endFrame: 30,
			});
			expect(plan.materializedTextLines.map((line) => line.line.text)).toEqual([
				"VIDEO",
				"DEMO",
				"PHASE",
				"TEST",
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	const fingerprintMutations: readonly [
		string,
		(source: CompositionInputBuilderSource) => void,
	][] = [
		[
			"text color",
			(source) => {
				const layer = source.sceneComposition.scenes[0]?.layers[1];
				if (layer?.kind !== "TEXT") throw new Error("missing text fixture");
				layer.colorRgba.r = 1;
			},
		],
		[
			"opacity",
			(source) => {
				const layer = source.sceneComposition.scenes[0]?.layers[1];
				if (layer?.kind !== "TEXT") throw new Error("missing text fixture");
				layer.opacityBasisPoints = 9_999;
			},
		],
		[
			"MEDIA fit",
			(source) => {
				const layer = source.sceneComposition.scenes[0]?.layers[0];
				if (layer?.kind !== "MEDIA") throw new Error("missing media fixture");
				layer.fit = "CONTAIN";
			},
		],
		[
			"object position",
			(source) => {
				const layer = source.sceneComposition.scenes[0]?.layers[0];
				if (layer?.kind !== "MEDIA") throw new Error("missing media fixture");
				layer.objectPositionXBasisPoints = 1;
			},
		],
	];

	it.each(fingerprintMutations)(
		"changes canonical fingerprint for %s",
		async (_name, mutate) => {
			const base = await buildCompositionInputV1(T09_COMPOSITION_FIXTURE);
			const changedSource = structuredClone(
				T09_COMPOSITION_FIXTURE,
			) as CompositionInputBuilderSource;
			mutate(changedSource);
			const changed = await buildCompositionInputV1(changedSource);
			if (!base.ok || !changed.ok) throw new Error("fixture must remain valid");
			expect(changed.fingerprint).not.toBe(base.fingerprint);
		},
	);

	it("preserves canonical visual semantics and derives command filter values", async () => {
		const root = await mkdtemp(join(resolve("."), "t09-semantics-"));
		try {
			const fixture = await canonicalFixture();
			const changedInput = structuredClone(fixture.compositionInput);
			const text = changedInput.sceneComposition.scenes[0]?.layers[1];
			if (text?.kind !== "TEXT") throw new Error("missing text fixture");
			text.colorRgba = { r: 12, g: 34, b: 56, a: 128 };
			text.opacityBasisPoints = 5_000;
			const changedResult = await buildCompositionInputV1(changedInput);
			if (!changedResult.ok)
				throw new Error("changed fixture must remain valid");
			const composition = {
				compositionInput: changedResult.input,
				compositionFingerprint: changedResult.fingerprint,
				compositionVersionId: fixture.compositionVersionId,
			};
			const manifest = approvedManifest(
				createHash("sha256").update("binary-a").digest("hex"),
			);
			const binarySha256 = manifest.binarySha256;
			if (!binarySha256) throw new Error("missing test binary hash");
			const plan = await planFor({ root, composition, manifest });
			const command = await buildT09FfmpegCommandPlan({
				plan,
				tool: {
					executablePath: resolve(root, "ffmpeg.exe"),
					manifest,
					manifestIdentity: plan.exactToolManifestIdentity,
					binarySha256,
				},
				outputPath: createT09ServerOwnedStagingPath({
					rootPath: root,
					relativePath: "render-output.mp4",
				}),
			});
			expect(command.argv).toContain("-n");
			expect(command.argv).not.toContain("-y");
			expect(command.argv).toContain("-an");
			expect(command.argv).not.toContain("aac");
			expect(command.filterGraph).toContain("0x0C2238@0.250980392156862745");
			expect(command.filterGraph).toContain(
				"colorspace=all=bt709:iall=bt709:fast=0",
			);
			expect(command.filterGraph).toContain("y_align=baseline");
			expect(command.filterGraph).toContain(":y=197:");
			expect(command.filterGraph).toContain("expansion=none");
			expect(command.filterGraph).toContain("between(n,0,29)");
			expect(command.filterGraph).toContain("between(n,30,59)");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("passes through a persisted CompositionVersion ID", async () => {
		const root = await mkdtemp(join(resolve("."), "t09-version-id-"));
		try {
			const fixture = await canonicalFixture();
			const plan = await planFor({
				root,
				composition: {
					...fixture,
					compositionVersionId: "0199a-real-persisted-composition-version",
				},
			});
			expect(plan.compositionVersionId).toBe(
				"0199a-real-persisted-composition-version",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps expression-like text literal at the text-file boundary", async () => {
		const root = await mkdtemp(join(resolve("."), "t09-text-safety-"));
		try {
			const fixture = await canonicalFixture();
			const changedInput = structuredClone(fixture.compositionInput);
			const text = changedInput.sceneComposition.scenes[0]?.layers[1];
			if (text?.kind !== "TEXT") throw new Error("missing text fixture");
			text.text = "PRICE %{n} 100%\nDEMO";
			const changed = await buildCompositionInputV1(changedInput);
			if (!changed.ok) throw new Error("changed fixture must remain valid");
			const manifest = approvedManifest(
				createHash("sha256").update("text-safety").digest("hex"),
			);
			const plan = await planFor({
				root,
				manifest,
				composition: {
					compositionInput: changed.input,
					compositionFingerprint: changed.fingerprint,
					compositionVersionId: fixture.compositionVersionId,
				},
			});
			const command = await commandForPlan(root, plan, manifest);
			expect(command.filterGraph).toContain("textfile=");
			expect(command.filterGraph).toContain("expansion=none");
			expect(command.filterGraph).not.toContain("PRICE %{n} 100%");
			expect(command.filterGraph).not.toContain("PRICE");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it.each(["CENTER", "RIGHT"] as const)(
		"fails closed for unsupported %s FFmpeg alignment",
		async (textAlign) => {
			const root = await mkdtemp(join(resolve("."), "t09-alignment-"));
			try {
				const manifest = approvedManifest(
					createHash("sha256").update(textAlign).digest("hex"),
				);
				const plan = await planFor({ root, manifest });
				const tampered = structuredClone(plan);
				const textLayer = tampered.renderLayers.find(
					(layer) => layer.kind === "TEXT",
				);
				if (textLayer?.kind !== "TEXT")
					throw new Error("missing planned text layer");
				textLayer.textAlign = textAlign;
				await expect(
					commandForPlan(root, tampered, manifest),
				).rejects.toMatchObject({ code: "RENDERER_FEATURE_UNSUPPORTED" });
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);

	it("binds the complete profile snapshot and derives all command settings", async () => {
		const root = await mkdtemp(join(resolve("."), "t09-profile-"));
		try {
			const manifest = approvedManifest(
				createHash("sha256").update("profile").digest("hex"),
			);
			const plan = await planFor({ root, manifest });
			expect(plan.outputProfile).toEqual(T09_VIDEO_ONLY_PROFILE);
			expect(plan.outputProfileFingerprint).toBe(
				await fingerprintT09PrototypeProfile(plan.outputProfile),
			);
			const command = await commandForPlan(root, plan, manifest);
			expect(argvValue(command.argv, "-threads")).toBe(
				String(plan.outputProfile.threads),
			);
			expect(argvValue(command.argv, "-pix_fmt")).toBe(
				plan.outputProfile.pixelFormat,
			);
			expect(argvValue(command.argv, "-b:v")).toBe(
				`${plan.outputProfile.videoBitrateKbps}k`,
			);
			expect(argvValue(command.argv, "-g")).toBe(
				String(plan.outputProfile.keyint),
			);
			expect(argvValue(command.argv, "-keyint_min")).toBe(
				String(plan.outputProfile.minKeyint),
			);
			expect(argvValue(command.argv, "-bf")).toBe(
				String(plan.outputProfile.bFrames),
			);
			expect(argvValue(command.argv, "-framerate")).toBe("30/1");
			expect(argvValue(command.argv, "-r")).toBe("30/1");
			expect(argvValue(command.argv, "-sc_threshold")).toBe("0");
			expect(argvValue(command.argv, "-flags")).toBe("+cgop");
			expect(argvValue(command.argv, "-color_primaries")).toBe("bt709");
			expect(argvValue(command.argv, "-color_trc")).toBe("bt709");
			expect(argvValue(command.argv, "-colorspace")).toBe("bt709");
			expect(argvValue(command.argv, "-c:v")).toBe("libx264");
			expect(argvValue(command.argv, "-f")).toBe("mp4");
			expect(command.filterGraph).toContain("scale=1080:1920");
			expect(command.argv).toContain("-an");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects profile drift and keeps the T09 profile out of production requests", async () => {
		const root = await mkdtemp(join(resolve("."), "t09-profile-drift-"));
		try {
			const manifest = approvedManifest(
				createHash("sha256").update("profile-drift").digest("hex"),
			);
			const plan = await planFor({ root, manifest });
			const changedProfile = structuredClone(plan);
			Reflect.set(changedProfile.outputProfile, "videoBitrateKbps", 1999);
			await expect(
				commandForPlan(root, changedProfile, manifest),
			).rejects.toMatchObject({ code: "T09_PROFILE_MISMATCH" });
			const changedFingerprint = structuredClone(plan);
			changedFingerprint.outputProfileFingerprint = "0".repeat(64);
			await expect(
				commandForPlan(root, changedFingerprint, manifest),
			).rejects.toMatchObject({ code: "T09_PROFILE_MISMATCH" });
			expect(
				parseOutputEncodingProfile({
					id: "mp4-h264-video-only-t09-v1",
				}),
			).toMatchObject({ success: false });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("uses deterministic high-precision alpha ratios", async () => {
		const root = await mkdtemp(join(resolve("."), "t09-alpha-"));
		try {
			const manifest = approvedManifest(
				createHash("sha256").update("alpha").digest("hex"),
			);
			const plan = await planFor({ root, manifest });
			const cases = [
				[255, 10_000, "1"],
				[128, 5_000, "0.250980392156862745"],
				[1, 1, "0.000000392156862745"],
			] as const;
			for (const [channelAlpha, opacity, expected] of cases) {
				const tampered = structuredClone(plan);
				const textLayer = tampered.renderLayers.find(
					(layer) => layer.kind === "TEXT",
				);
				if (textLayer?.kind !== "TEXT")
					throw new Error("missing planned text layer");
				textLayer.colorRgba.a = channelAlpha;
				textLayer.opacityBasisPoints = opacity;
				const command = await commandForPlan(root, tampered, manifest);
				expect(command.filterGraph).toContain(`@${expected}`);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("blocks arbitrary text and output paths at the staging boundary", async () => {
		const root = await mkdtemp(join(resolve("."), "t09-paths-"));
		try {
			await expect(
				buildT09RenderPlan({
					tool: { manifest: T09_FFMPEG_TOOL_MANIFEST },
					assetPaths: { "t09-background-png": resolve(root, "background.png") },
					fontFilePaths: {
						"noto-sans-700": resolve(root, "NotoSans-Bold.ttf"),
					},
					textFilePaths: {
						"t09-text-scene-1:0": resolve(root, "text.txt") as never,
					},
					outputReservation: {
						jobId: "j",
						attemptId: "a",
						attemptNumber: 1,
						outputReservationId: "r",
					},
				}),
			).rejects.toMatchObject({ code: "T09_STAGING_PATH_INVALID" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
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

	it.each(["LEFT", "CENTER", "RIGHT"] as const)(
		"supports %s alignment",
		(textAlign) => {
			const layout = materializeT09TextLayout(
				{
					text: "AB",
					box: { xPx: 10, yPx: 20, widthPx: 50, heightPx: 40 },
					fontStableId: "noto-sans-700",
					fontFamily: "Noto Sans",
					fontWeight: 700,
					fontSizePx: 10,
					lineHeightPx: 20,
					textAlign,
					maxLines: 1,
					fontContentSha256: fontSha256,
				},
				fakeMetrics(),
			);
			expect(layout.lines[0]).toMatchObject({
				xPx: textAlign === "LEFT" ? 10 : textAlign === "CENTER" ? 25 : 40,
				baselineYPx: 28,
				measuredWidthPx: 20,
			});
		},
	);

	it("covers text normalization, spaces, empty lines, and overflow matrix", () => {
		const base = {
			box: { xPx: 0, yPx: 0, widthPx: 100, heightPx: 100 },
			fontStableId: "noto-sans-700" as const,
			fontFamily: "Noto Sans" as const,
			fontWeight: 700 as const,
			fontSizePx: 10,
			lineHeightPx: 20,
			textAlign: "LEFT" as const,
			maxLines: 5,
			fontContentSha256: fontSha256,
		};
		expect(
			materializeT09TextLayout({ ...base, text: "A\r\nB" }, fakeMetrics())
				.normalizedText,
		).toBe("A\nB");
		expect(
			materializeT09TextLayout({ ...base, text: "e\u0301" }, fakeMetrics())
				.normalizedText,
		).toBe("é");
		expect(
			materializeT09TextLayout({ ...base, text: "A  B" }, fakeMetrics())
				.normalizedText,
		).toBe("A  B");
		expect(
			materializeT09TextLayout(
				{ ...base, text: "A\n\nB" },
				fakeMetrics(),
			).lines.map((line) => line.text),
		).toEqual(["A", "", "B"]);
		expect(() =>
			materializeT09TextLayout(
				{ ...base, text: "TOOLONG", box: { ...base.box, widthPx: 10 } },
				fakeMetrics(),
			),
		).toThrowError(T09TextLayoutError);
		expect(() =>
			materializeT09TextLayout(
				{ ...base, text: "A\nB", maxLines: 1 },
				fakeMetrics(),
			),
		).toThrowError(T09TextLayoutError);
		expect(() =>
			materializeT09TextLayout(
				{
					...base,
					text: "A\nB\nC\nD\nE\nF",
					box: { ...base.box, heightPx: 20 },
				},
				fakeMetrics(),
			),
		).toThrowError(T09TextLayoutError);
		expect(() =>
			materializeT09TextLayout({ ...base, text: "☃" }, fakeMetrics()),
		).toThrowError(T09TextLayoutError);
	});

	it("uses all pinned Noto Sans weights and exact repeatability", async () => {
		const results = await Promise.all(
			([400, 600, 700] as const).map((fontWeight) =>
				layoutT09Text({
					text: "AFFI",
					box: { xPx: 0, yPx: 0, widthPx: 900, heightPx: 200 },
					fontStableId: `noto-sans-${fontWeight}`,
					fontFamily: "Noto Sans",
					fontWeight,
					fontSizePx: 72,
					lineHeightPx: 88,
					textAlign: "LEFT",
					maxLines: 1,
					fontContentSha256:
						fontWeight === 400
							? "b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5"
							: fontWeight === 600
								? "87a8b90ece1e89746b544e4e086f85a3710e41485a8078f9be874837dfad45d5"
								: fontSha256,
				}),
			),
		);
		expect(
			results.every((result) => result.lines[0]?.measuredWidthPx > 0),
		).toBe(true);
		const again = await layoutT09Text({
			text: "AFFI",
			box: { xPx: 0, yPx: 0, widthPx: 900, heightPx: 200 },
			fontStableId: "noto-sans-700",
			fontFamily: "Noto Sans",
			fontWeight: 700,
			fontSizePx: 72,
			lineHeightPx: 88,
			textAlign: "LEFT",
			maxLines: 1,
			fontContentSha256: fontSha256,
		});
		expect(again).toEqual(results[2]);
	});

	it("uses shaped positions for kerning-sensitive AV width", async () => {
		const shaping = await inspectT09ShapedRun({
			text: "AV",
			box: { xPx: 0, yPx: 0, widthPx: 200, heightPx: 100 },
			fontStableId: "noto-sans-700",
			fontFamily: "Noto Sans",
			fontWeight: 700,
			fontSizePx: 10,
			lineHeightPx: 20,
			textAlign: "LEFT",
			maxLines: 1,
			fontContentSha256: fontSha256,
		});
		const layout = await layoutT09Text({
			text: "AV",
			box: { xPx: 0, yPx: 0, widthPx: 200, heightPx: 100 },
			fontStableId: "noto-sans-700",
			fontFamily: "Noto Sans",
			fontWeight: 700,
			fontSizePx: 10,
			lineHeightPx: 20,
			textAlign: "LEFT",
			maxLines: 1,
			fontContentSha256: fontSha256,
		});
		expect(layout.lines[0]?.measuredWidthPx).toBe(
			Math.floor((shaping.shapedUnits * 10) / 1000 + 0.5),
		);
		expect(shaping.shapedUnits).not.toBe(shaping.nominalUnits);
	});

	it("exposes the complete explicit OpenType policy", () => {
		expect(T09_OPEN_TYPE_FEATURES).toEqual({
			rvrn: false,
			ltra: false,
			ltrm: false,
			frac: false,
			numr: false,
			dnom: false,
			ccmp: true,
			locl: false,
			rlig: false,
			mark: false,
			mkmk: false,
			calt: false,
			clig: false,
			liga: false,
			rclt: false,
			curs: false,
			kern: true,
			vert: false,
			rtla: false,
			rtlm: false,
			dist: false,
			dlig: false,
			hlig: false,
		});
	});

	it("derives manifest identity, gates malformed approval, and rejects tool mismatch", async () => {
		const root = await mkdtemp(join(resolve("."), "t09-tools-"));
		try {
			const bytesA = Buffer.from("exact-test-binary-a");
			const binaryPathA = join(root, "ffmpeg-a.exe");
			await writeFile(binaryPathA, bytesA);
			const shaA = createHash("sha256").update(bytesA).digest("hex");
			const manifestA = approvedManifest(shaA, "a");
			const plan = await planFor({ root, manifest: manifestA });
			expect(plan.exactToolManifestIdentity).toMatch(/^[a-f0-9]{64}$/);
			const resolvedA = await resolveT09FfmpegTool({
				configuredPath: binaryPathA,
				manifest: manifestA,
			});
			const command = await buildT09FfmpegCommandPlan({
				plan,
				tool: resolvedA,
				outputPath: createT09ServerOwnedStagingPath({
					rootPath: root,
					relativePath: "output-a.mp4",
				}),
			});
			expect(command.executablePath).toBe(binaryPathA);

			const bytesB = Buffer.from("exact-test-binary-b");
			const binaryPathB = join(root, "ffmpeg-b.exe");
			await writeFile(binaryPathB, bytesB);
			const manifestB = approvedManifest(
				createHash("sha256").update(bytesB).digest("hex"),
				"b",
			);
			const resolvedB = await resolveT09FfmpegTool({
				configuredPath: binaryPathB,
				manifest: manifestB,
			});
			await expect(
				buildT09FfmpegCommandPlan({
					plan,
					tool: resolvedB,
					outputPath: createT09ServerOwnedStagingPath({
						rootPath: root,
						relativePath: "output-b.mp4",
					}),
				}),
			).rejects.toMatchObject({ code: "T09_PLAN_TOOL_MISMATCH" });

			await expect(
				planFor({
					root,
					manifest: { ...manifestA, buildIdentity: "" } as never,
				}),
			).rejects.toBeInstanceOf(T09RenderPlanError);
			await expect(
				resolveT09FfmpegTool({
					configuredPath: "ffmpeg.exe",
					manifest: manifestA,
				}),
			).rejects.toMatchObject({ code: "T09_FFMPEG_PATH_MUST_BE_ABSOLUTE" });
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
	});

	it("keeps the checked-in PNG fixture byte identity explicit", () => {
		const bytes = Buffer.from(T09_MEDIA_PNG_BASE64, "base64");
		expect(bytes.byteLength).toBe(68);
		expect(createHash("sha256").update(bytes).digest("hex")).toBe(
			"431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
		);
	});
});
