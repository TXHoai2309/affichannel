import { z } from "zod";
import { outputRulesSchema } from "../script-generation/input-contract";
import { scriptVersionEditableSnapshotSchema } from "../script-version/schema";
import { compositionProfileSchema, fontBundleManifestSchema } from "./profile";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const decimal = z.string().regex(/^0$|^[1-9][0-9]*$/);
const positiveDecimal = z.string().regex(/^[1-9][0-9]*$/);
const finiteNumber = z.number().finite();
const integerPixel = z.number().int().finite();
const basisPoints = z.number().int().min(0).max(10_000);
const signedBasisPoints = z.number().int().min(-10_000).max(10_000);
const nonEmptyKey = z.string().trim().min(1).max(120);

export const compositionSceneTimingSchema = z
	.object({
		sceneKey: nonEmptyKey,
		order: z.number().int().positive(),
		startFrame: decimal,
		durationFrames: positiveDecimal,
	})
	.strict();

export const voiceCompositionSegmentSchema = z
	.object({
		segmentKey: nonEmptyKey,
		semantic: z
			.object({
				checksum: sha256,
				mimeType: z.literal("audio/mpeg"),
				byteSize: z.number().int().positive(),
				sourceSampleRate: z.number().int().positive(),
				sourceSampleCount: positiveDecimal,
				durationMs: z.number().int().positive(),
			})
			.strict(),
		provenance: z
			.object({
				artifactId: z.string().min(1),
				sourceScriptVersionId: z.string().min(1),
				sourceScriptRevision: z.number().int().positive(),
				textSnapshot: z.string().trim().min(1),
				textHash: sha256,
				configId: z.string().min(1),
				configRevision: z.number().int().positive(),
				provider: z.string().min(1),
				voiceId: z.string().min(1),
				language: z.string().min(2),
				speed: finiteNumber,
				storageProvider: z.enum(["local", "r2"]),
			})
			.strict(),
	})
	.strict();

export const voiceCompositionDependencySchema = z
	.object({
		segments: z.array(voiceCompositionSegmentSchema).min(1),
	})
	.strict();

export const mediaCompositionDependencySchema = z
	.object({
		dependencyKey: nonEmptyKey,
		role: z.string().trim().min(1).max(80),
		semantic: z
			.object({
				mediaType: z.enum(["image", "video", "audio"]),
				mimeType: z.enum([
					"image/jpeg",
					"image/png",
					"image/webp",
					"video/mp4",
					"audio/mpeg",
				]),
				checksumSha256: sha256,
				byteSize: z.number().int().positive(),
				width: z.number().int().positive().nullable(),
				height: z.number().int().positive().nullable(),
				durationMs: z.number().int().positive().nullable(),
			})
			.strict(),
		provenance: z
			.object({
				mediaAssetId: z.string().min(1),
				workspaceId: z.string().min(1),
				projectId: z.string().min(1),
			})
			.strict(),
	})
	.strict();

const layerBoxSchema = z
	.object({
		xPx: integerPixel,
		yPx: integerPixel,
		widthPx: z.number().int().positive(),
		heightPx: z.number().int().positive(),
	})
	.strict();

const visualLayerBaseSchema = z
	.object({
		layerId: nonEmptyKey,
		zIndex: z.number().int(),
		startOffsetFrame: decimal,
		durationFrames: positiveDecimal,
		box: layerBoxSchema,
		opacityBasisPoints: basisPoints,
	})
	.strict();

export const mediaVisualLayerSchema = visualLayerBaseSchema
	.extend({
		kind: z.literal("MEDIA"),
		sourceMediaKey: nonEmptyKey,
		fit: z.enum(["COVER", "CONTAIN"]),
		objectPositionXBasisPoints: basisPoints,
		objectPositionYBasisPoints: basisPoints,
	})
	.strict();

export const textVisualLayerSchema = visualLayerBaseSchema
	.extend({
		kind: z.literal("TEXT"),
		text: z.string().trim().min(1),
		fontStableId: nonEmptyKey,
		fontWeight: z.union([z.literal(400), z.literal(600), z.literal(700)]),
		fontStyle: z.literal("normal"),
		fontSizePx: z.number().int().positive(),
		lineHeightPx: z.number().int().positive(),
		textAlign: z.enum(["LEFT", "CENTER", "RIGHT"]),
		colorRgba: z
			.object({
				r: z.number().int().min(0).max(255),
				g: z.number().int().min(0).max(255),
				b: z.number().int().min(0).max(255),
				a: z.number().int().min(0).max(255),
			})
			.strict(),
		maxLines: z.number().int().positive(),
		textLayoutVersion: z.literal("affichannel-text-layout-v1"),
	})
	.strict();

export const visualLayerSchema = z.discriminatedUnion("kind", [
	mediaVisualLayerSchema,
	textVisualLayerSchema,
]);

export const audioTrackSchema = z
	.object({
		trackId: nonEmptyKey,
		sourceVoiceKey: nonEmptyKey,
		startFrame: decimal,
		durationFrames: positiveDecimal,
		endFrame: positiveDecimal,
		trimStartSample: decimal,
		trimEndSample: decimal,
		gainMilliDb: z.number().int(),
		panBasisPoints: signedBasisPoints,
		fadeInSamples: decimal,
		fadeOutSamples: decimal,
	})
	.strict()
	.refine(
		(value) => BigInt(value.trimEndSample) > BigInt(value.trimStartSample),
		"Audio trim boundary must be increasing.",
	);

export const sceneCompositionSchema = z
	.object({
		version: z.literal("scene-composition.v1"),
		scenes: z
			.array(
				z
					.object({ sceneKey: nonEmptyKey, layers: z.array(visualLayerSchema) })
					.strict(),
			)
			.min(1),
		audioTracks: z.array(audioTrackSchema),
	})
	.strict();

export const outputRulesSemanticSchema = outputRulesSchema;

export const compositionInputV1Schema = z
	.object({
		schemaVersion: z.literal("composition-input.v1"),
		workspaceId: z.string().min(1),
		projectId: z.string().min(1),
		profile: compositionProfileSchema,
		script: z
			.object({
				semantic: scriptVersionEditableSnapshotSchema,
				provenance: z
					.object({
						scriptVersionId: z.string().min(1),
						revision: z.number().int().positive(),
						status: z.enum(["draft", "saved"]),
						versionNumber: z.number().int().positive().nullable(),
					})
					.strict(),
			})
			.strict(),
		voice: voiceCompositionDependencySchema,
		media: z.array(mediaCompositionDependencySchema),
		fonts: fontBundleManifestSchema,
		config: z
			.object({
				semantic: z
					.object({
						compositionProfileId: z.literal("vertical-standard-v1"),
						outputRules: outputRulesSemanticSchema,
					})
					.strict(),
				provenance: z
					.object({
						outputRulesRevision: z.number().int().positive().nullable(),
					})
					.strict(),
			})
			.strict(),
		timeline: z
			.object({
				fps: z
					.object({
						numerator: z.number().int().positive(),
						denominator: z.number().int().positive(),
					})
					.strict(),
				totalFrames: positiveDecimal,
				scenes: z.array(compositionSceneTimingSchema).min(1),
			})
			.strict(),
		sceneComposition: sceneCompositionSchema,
	})
	.strict()
	.superRefine((input, context) => {
		if (
			input.timeline.fps.numerator !== input.profile.fps.numerator ||
			input.timeline.fps.denominator !== input.profile.fps.denominator
		) {
			context.addIssue({
				code: "custom",
				path: ["timeline", "fps"],
				message: "Timeline FPS must match the frozen composition profile.",
			});
		}
		const timelineScenes = new Map(
			input.timeline.scenes.map((scene) => [scene.sceneKey, scene]),
		);
		if (timelineScenes.size !== input.timeline.scenes.length) {
			context.addIssue({
				code: "custom",
				path: ["timeline", "scenes"],
				message: "Timeline scene keys must be unique.",
			});
		}
		const timelineOrders = new Set(
			input.timeline.scenes.map((scene) => scene.order),
		);
		if (timelineOrders.size !== input.timeline.scenes.length) {
			context.addIssue({
				code: "custom",
				path: ["timeline", "scenes"],
				message: "Timeline scene order values must be unique.",
			});
		}
		for (let index = 1; index < input.timeline.scenes.length; index += 1) {
			const previousScene = input.timeline.scenes[index - 1];
			const currentScene = input.timeline.scenes[index];
			if (
				previousScene &&
				currentScene &&
				previousScene.order >= currentScene.order
			) {
				context.addIssue({
					code: "custom",
					path: ["timeline", "scenes", index, "order"],
					message: "Timeline scenes must be strictly ascending by order.",
				});
			}
		}
		for (const [index, scene] of input.timeline.scenes.entries()) {
			if (
				BigInt(scene.startFrame) + BigInt(scene.durationFrames) >
				BigInt(input.timeline.totalFrames)
			) {
				context.addIssue({
					code: "custom",
					path: ["timeline", "scenes", index],
					message: "Timeline scene must fit within totalFrames.",
				});
			}
		}
		const scriptSceneOrders = input.script.semantic.scenes.map(
			(scene) => scene.order,
		);
		if (
			input.timeline.scenes.length !== scriptSceneOrders.length ||
			input.timeline.scenes.some(
				(scene, index) => scene.order !== scriptSceneOrders[index],
			)
		) {
			context.addIssue({
				code: "custom",
				path: ["timeline", "scenes"],
				message: "Timeline scenes must match script scene order.",
			});
		}
		if (input.script.semantic.selectedHookKey === null) {
			context.addIssue({
				code: "custom",
				path: ["script", "semantic", "selectedHookKey"],
				message: "Composition requires one selected hook to render.",
			});
		}
		const compositionSceneKeys = new Set(
			input.sceneComposition.scenes.map((scene) => scene.sceneKey),
		);
		if (compositionSceneKeys.size !== input.sceneComposition.scenes.length) {
			context.addIssue({
				code: "custom",
				path: ["sceneComposition", "scenes"],
				message: "Scene composition keys must be unique.",
			});
		}
		if (
			compositionSceneKeys.size !== timelineScenes.size ||
			[...compositionSceneKeys].some((key) => !timelineScenes.has(key))
		) {
			context.addIssue({
				code: "custom",
				path: ["sceneComposition", "scenes"],
				message:
					"Every composed scene must resolve to canonical timeline timing.",
			});
		}
		const orderedTimelineScenes = [...input.timeline.scenes].sort(
			(left, right) => left.order - right.order,
		);
		if (
			input.sceneComposition.scenes.some(
				(scene, index) =>
					scene.sceneKey !== orderedTimelineScenes[index]?.sceneKey,
			)
		) {
			context.addIssue({
				code: "custom",
				path: ["sceneComposition", "scenes"],
				message: "Scene composition order must match canonical timeline order.",
			});
		}
		const mediaKeys = new Set(input.media.map((media) => media.dependencyKey));
		if (mediaKeys.size !== input.media.length) {
			context.addIssue({
				code: "custom",
				path: ["media"],
				message: "Media dependency keys must be unique.",
			});
		}
		for (const [index, media] of input.media.entries()) {
			if (
				media.provenance.workspaceId !== input.workspaceId ||
				media.provenance.projectId !== input.projectId
			) {
				context.addIssue({
					code: "custom",
					path: ["media", index, "provenance"],
					message: "Media provenance must resolve to the composition scope.",
				});
			}
		}
		const voiceKeys = new Set(
			input.voice.segments.map((segment) => segment.segmentKey),
		);
		if (voiceKeys.size !== input.voice.segments.length) {
			context.addIssue({
				code: "custom",
				path: ["voice", "segments"],
				message: "Voice segment keys must be unique.",
			});
		}
		for (const [index, segment] of input.voice.segments.entries()) {
			if (
				segment.provenance.sourceScriptVersionId !==
				input.script.provenance.scriptVersionId
			) {
				context.addIssue({
					code: "custom",
					path: [
						"voice",
						"segments",
						index,
						"provenance",
						"sourceScriptVersionId",
					],
					message: "Voice artifact must belong to the pinned ScriptVersion.",
				});
			}
			if (
				segment.provenance.sourceScriptRevision !==
				input.script.provenance.revision
			) {
				context.addIssue({
					code: "custom",
					path: [
						"voice",
						"segments",
						index,
						"provenance",
						"sourceScriptRevision",
					],
					message: "Voice artifact must belong to the pinned Script revision.",
				});
			}
		}
		const firstVoice = input.voice.segments[0];
		if (firstVoice) {
			for (const [index, segment] of input.voice.segments.entries()) {
				const firstProvenance = firstVoice.provenance;
				const provenance = segment.provenance;
				if (
					provenance.configId !== firstProvenance.configId ||
					provenance.configRevision !== firstProvenance.configRevision ||
					provenance.provider !== firstProvenance.provider ||
					provenance.voiceId !== firstProvenance.voiceId ||
					provenance.language !== firstProvenance.language ||
					provenance.speed !== firstProvenance.speed
				) {
					context.addIssue({
						code: "custom",
						path: ["voice", "segments", index, "provenance"],
						message: "Voice segment provenance must use one VoiceConfig.",
					});
				}
			}
		}
		const fontById = new Map(
			input.fonts.faces.map((face) => [face.fontId, face]),
		);
		const layerIds = new Set<string>();
		for (const [sceneIndex, scene] of input.sceneComposition.scenes.entries()) {
			const timing = timelineScenes.get(scene.sceneKey);
			if (!timing) continue;
			const zIndexes = new Set<number>();
			for (const [layerIndex, layer] of scene.layers.entries()) {
				const previousLayer = scene.layers[layerIndex - 1];
				if (
					layerIndex > 0 &&
					previousLayer !== undefined &&
					previousLayer.zIndex >= layer.zIndex
				) {
					context.addIssue({
						code: "custom",
						path: [
							"sceneComposition",
							"scenes",
							sceneIndex,
							"layers",
							layerIndex,
							"zIndex",
						],
						message: "Scene layers must be strictly ascending by z-index.",
					});
				}
				if (layerIds.has(layer.layerId))
					context.addIssue({
						code: "custom",
						path: [
							"sceneComposition",
							"scenes",
							sceneIndex,
							"layers",
							layerIndex,
							"layerId",
						],
						message: "Layer IDs must be unique.",
					});
				layerIds.add(layer.layerId);
				if (zIndexes.has(layer.zIndex))
					context.addIssue({
						code: "custom",
						path: [
							"sceneComposition",
							"scenes",
							sceneIndex,
							"layers",
							layerIndex,
							"zIndex",
						],
						message: "Layer z-index values must be unique within a scene.",
					});
				zIndexes.add(layer.zIndex);
				if (
					BigInt(layer.startOffsetFrame) + BigInt(layer.durationFrames) >
					BigInt(timing.durationFrames)
				)
					context.addIssue({
						code: "custom",
						path: [
							"sceneComposition",
							"scenes",
							sceneIndex,
							"layers",
							layerIndex,
						],
						message: "Layer timing must fit within its scene.",
					});
				if (
					layer.box.xPx < 0 ||
					layer.box.yPx < 0 ||
					layer.box.xPx + layer.box.widthPx > input.profile.logicalWidth ||
					layer.box.yPx + layer.box.heightPx > input.profile.logicalHeight
				)
					context.addIssue({
						code: "custom",
						path: [
							"sceneComposition",
							"scenes",
							sceneIndex,
							"layers",
							layerIndex,
							"box",
						],
						message: "Layer geometry must fit the logical composition.",
					});
				if (layer.kind === "MEDIA") {
					const media = input.media.find(
						(item) => item.dependencyKey === layer.sourceMediaKey,
					);
					if (!mediaKeys.has(layer.sourceMediaKey))
						context.addIssue({
							code: "custom",
							path: [
								"sceneComposition",
								"scenes",
								sceneIndex,
								"layers",
								layerIndex,
								"sourceMediaKey",
							],
							message:
								"Media layer source must resolve to one pinned media dependency.",
						});
					else if (media?.semantic.mediaType === "audio")
						context.addIssue({
							code: "custom",
							path: [
								"sceneComposition",
								"scenes",
								sceneIndex,
								"layers",
								layerIndex,
								"sourceMediaKey",
							],
							message: "Audio assets cannot be visual MEDIA layers.",
						});
				}
				if (layer.kind === "TEXT") {
					const font = fontById.get(layer.fontStableId);
					if (!font || font.weight !== layer.fontWeight)
						context.addIssue({
							code: "custom",
							path: [
								"sceneComposition",
								"scenes",
								sceneIndex,
								"layers",
								layerIndex,
								"fontStableId",
							],
							message:
								"Text layer font must resolve to the pinned font manifest weight.",
						});
				}
			}
		}
		const trackIds = new Set<string>();
		const trackVoiceKeys = new Set<string>();
		for (const [index, track] of input.sceneComposition.audioTracks.entries()) {
			if (trackIds.has(track.trackId))
				context.addIssue({
					code: "custom",
					path: ["sceneComposition", "audioTracks", index, "trackId"],
					message: "Audio track IDs must be unique.",
				});
			trackIds.add(track.trackId);
			trackVoiceKeys.add(track.sourceVoiceKey);
			if (!voiceKeys.has(track.sourceVoiceKey))
				context.addIssue({
					code: "custom",
					path: ["sceneComposition", "audioTracks", index, "sourceVoiceKey"],
					message:
						"Audio track source must resolve to one pinned voice dependency.",
				});
			if (
				BigInt(track.endFrame) !==
				BigInt(track.startFrame) + BigInt(track.durationFrames)
			)
				context.addIssue({
					code: "custom",
					path: ["sceneComposition", "audioTracks", index, "endFrame"],
					message: "Audio endFrame must equal startFrame + durationFrames.",
				});
			if (BigInt(track.endFrame) > BigInt(input.timeline.totalFrames))
				context.addIssue({
					code: "custom",
					path: ["sceneComposition", "audioTracks", index, "endFrame"],
					message: "Audio track endFrame must fit within totalFrames.",
				});
		}
		if (
			input.sceneComposition.audioTracks.length > 0 &&
			(trackVoiceKeys.size !== voiceKeys.size ||
				trackVoiceKeys.size !== input.sceneComposition.audioTracks.length ||
				[...voiceKeys].some((key) => !trackVoiceKeys.has(key)))
		)
			context.addIssue({
				code: "custom",
				path: ["sceneComposition", "audioTracks"],
				message:
					"Every pinned voice dependency must be materialized in one audio track.",
			});
		const scriptKeys = input.script.semantic.voiceoverSegments.map(
			(segment) => segment.key,
		);
		if (
			scriptKeys.length !== voiceKeys.size ||
			scriptKeys.some((key) => !voiceKeys.has(key))
		)
			context.addIssue({
				code: "custom",
				path: ["voice", "segments"],
				message:
					"Every script voiceover segment needs one exact voice artifact.",
			});
	});

export type CompositionInputV1 = z.infer<typeof compositionInputV1Schema>;

/** Voice dependencies referenced by the render timeline; audit-only voice is excluded. */
export function renderedVoiceKeysForComposition(
	input: Pick<CompositionInputV1, "sceneComposition">,
) {
	return new Set(
		input.sceneComposition.audioTracks.map((track) => track.sourceVoiceKey),
	);
}

export type CompositionInputV1Result =
	| { ok: true; input: CompositionInputV1; fingerprint: string }
	| {
			ok: false;
			code: "COMPOSITION_INPUT_INCOMPLETE" | "COMPOSITION_INPUT_INVALID";
			issues?: string[];
	  };

export type CompositionCurrentness =
	| { state: "CURRENT" }
	| {
			state: "STALE";
			reason:
				| "SCRIPT_REVISION_CHANGED"
				| "VOICE_SOURCE_CHANGED"
				| "MEDIA_BINARY_CHANGED"
				| "CONFIG_CHANGED"
				| "PROFILE_MISMATCH";
	  }
	| { state: "UNKNOWN"; reason: string };
