import type {
	CompositionInputBuilderSource,
	CompositionInputV1,
	CompositionInputV1Result,
	FontBundleManifest,
	MediaAsset,
	OutputRules,
	ScriptVersionReadModel,
	VoiceConfig,
	VoiceSegmentArtifact,
} from "@affichannel/core";
import {
	buildCompositionInputV1,
	checkCompositionAudioTiming,
	defaultOutputRules,
	scriptVersionEditableSnapshotSchema,
	VERTICAL_STANDARD_PROFILE,
} from "@affichannel/core";
import { db, mediaAsset, mediaAssetLink } from "@affichannel/db";
import { and, eq } from "drizzle-orm";
import { CompositionTechnicalLoader } from "./composition-technical-loader";
import { getOutputRules } from "./output-rules-service";
import { getProjectWorkflowSubject } from "./project-repository";
import { findCurrentScriptVersion } from "./script-version-repository";
import { findVoiceConfig } from "./voice-config-service";
import { listVoiceSegmentArtifacts } from "./voice-segment-repository";
import type { WorkspaceActor } from "./workspace";

/**
 * Only server-side authority readers may produce this snapshot. In
 * particular, it has no client-provided CompositionInput or eligibility flags.
 */
export type ServerOwnedCompositionAuthorities = {
	project: Awaited<ReturnType<typeof getProjectWorkflowSubject>>;
	script: ScriptVersionReadModel | undefined;
	voiceConfig: VoiceConfig | null;
	voiceArtifacts: readonly VoiceSegmentArtifact[];
	media: readonly ServerOwnedMediaDependency[];
	outputRules: OutputRules;
	renderMaterialization: ServerOwnedRenderMaterialization;
};

export type ServerOwnedMediaDependency = {
	dependencyKey: string;
	role: string;
	asset: MediaAsset;
};

/** Technical pins are produced only by the server-owned materializer. */
export type ServerOwnedRenderMaterialization = {
	fonts: FontBundleManifest | null;
	voiceSourceFacts: ReadonlyMap<
		string,
		Pick<
			CompositionInputV1["voice"]["segments"][number]["semantic"],
			"sourceSampleRate" | "sourceSampleCount"
		>
	> | null;
	timeline: CompositionInputV1["timeline"] | null;
	sceneComposition: CompositionInputV1["sceneComposition"] | null;
};

export type ServerOwnedCompositionAssemblyReader = {
	read: (
		actor: WorkspaceActor,
		projectId: string,
	) => Promise<ServerOwnedCompositionAuthorities>;
};

async function readAuthoritativeCompositionAuthorities(
	actor: WorkspaceActor,
	projectId: string,
): Promise<ServerOwnedCompositionAuthorities> {
	const [
		projectSubject,
		script,
		voiceConfig,
		voiceArtifacts,
		mediaRows,
		outputRules,
	] = await Promise.all([
		getProjectWorkflowSubject(actor.workspaceId, projectId),
		findCurrentScriptVersion(actor, projectId),
		findVoiceConfig(actor, projectId),
		listVoiceSegmentArtifacts(actor, projectId),
		db
			.select({ asset: mediaAsset, usageType: mediaAssetLink.usageType })
			.from(mediaAssetLink)
			.innerJoin(mediaAsset, eq(mediaAsset.id, mediaAssetLink.mediaAssetId))
			.where(
				and(
					eq(mediaAssetLink.workspaceId, actor.workspaceId),
					eq(mediaAssetLink.projectId, projectId),
					eq(mediaAsset.workspaceId, actor.workspaceId),
				),
			),
		getOutputRules(actor),
	]);

	const media = mediaRows.map((row) => ({
		dependencyKey: row.asset.id,
		role: row.usageType,
		asset: {
			...row.asset,
			tags: [...row.asset.tags],
		} as MediaAsset,
	}));
	return {
		project: projectSubject,
		script,
		voiceConfig,
		voiceArtifacts,
		media,
		outputRules,
		renderMaterialization: await materializeServerOwnedRenderInputs({
			actor,
			projectId,
			script,
			voiceConfig,
			voiceArtifacts,
			media,
		}),
	};
}

async function materializeServerOwnedRenderInputs(input: {
	actor: WorkspaceActor;
	projectId: string;
	script: ScriptVersionReadModel | undefined;
	voiceConfig: VoiceConfig | null;
	voiceArtifacts: readonly VoiceSegmentArtifact[];
	media: readonly ServerOwnedMediaDependency[];
}): Promise<ServerOwnedRenderMaterialization> {
	const empty: ServerOwnedRenderMaterialization = {
		fonts: null,
		voiceSourceFacts: null,
		timeline: null,
		sceneComposition: null,
	};
	if (!input.script || !input.voiceConfig) return empty;
	const parsedScript = scriptVersionEditableSnapshotSchema.safeParse(
		input.script.editableSnapshot,
	);
	if (!parsedScript.success) return empty;
	const loader = new CompositionTechnicalLoader({
		actor: input.actor,
		projectId: input.projectId,
	});
	const currentArtifacts = input.voiceArtifacts.filter(
		(artifact) =>
			artifact.status === "completed" &&
			artifact.sourceScriptVersionId === input.script?.id &&
			artifact.sourceScriptRevision === input.script?.revision &&
			artifact.voiceConfigRevision === input.voiceConfig?.revision &&
			artifact.provider === input.voiceConfig?.provider &&
			artifact.voiceId === input.voiceConfig?.voiceId &&
			artifact.language === input.voiceConfig?.language &&
			artifact.speed === input.voiceConfig?.speed,
	);
	const artifactsByKey = new Map<string, VoiceSegmentArtifact>();
	for (const artifact of currentArtifacts) {
		if (!artifactsByKey.has(artifact.segmentKey))
			artifactsByKey.set(artifact.segmentKey, artifact);
	}
	if (artifactsByKey.size !== parsedScript.data.voiceoverSegments.length)
		return empty;

	const voiceSourceFacts = new Map<
		string,
		Pick<
			CompositionInputV1["voice"]["segments"][number]["semantic"],
			"sourceSampleRate" | "sourceSampleCount"
		>
	>();
	for (const segment of parsedScript.data.voiceoverSegments) {
		const artifact = artifactsByKey.get(segment.key);
		if (!artifact) return empty;
		const inspected = await loader.inspectVoiceArtifact(artifact);
		if (inspected.status !== "VALID") return empty;
		voiceSourceFacts.set(segment.key, {
			sourceSampleRate: inspected.facts.sourceSampleRate,
			sourceSampleCount: inspected.facts.sourceSampleCount,
		});
	}

	const inspectedMedia = await Promise.all(
		input.media.map((dependency) =>
			loader.inspectMediaAsset(
				dependency.asset,
				dependency.dependencyKey,
				dependency.role,
			),
		),
	);
	if (inspectedMedia.some((result) => result.status !== "VALID")) return empty;
	const imageDependencies = input.media.filter(
		(dependency) => dependency.asset.mediaType === "image",
	);
	if (imageDependencies.length === 0) return empty;

	let totalFrames = BigInt(0);
	const timelineScenes: CompositionInputV1["timeline"]["scenes"] = [];
	const composedScenes: CompositionInputV1["sceneComposition"]["scenes"] = [];
	for (const scene of parsedScript.data.scenes) {
		const durationFrames = BigInt(scene.durationSeconds) * BigInt(30);
		if (durationFrames <= BigInt(0)) return empty;
		const sceneKey = `scene-${scene.order}`;
		const sceneDuration = String(durationFrames);
		const image =
			imageDependencies[(scene.order - 1) % imageDependencies.length];
		if (!image) return empty;
		const layers: CompositionInputV1["sceneComposition"]["scenes"][number]["layers"] =
			[
				{
					kind: "MEDIA",
					layerId: `${sceneKey}-media`,
					zIndex: 0,
					startOffsetFrame: "0",
					durationFrames: sceneDuration,
					box: { xPx: 0, yPx: 0, widthPx: 1080, heightPx: 1920 },
					opacityBasisPoints: 10000,
					sourceMediaKey: image.dependencyKey,
					fit: "COVER",
					objectPositionXBasisPoints: 5000,
					objectPositionYBasisPoints: 5000,
				},
			];
		if (scene.onScreenText?.trim()) {
			layers.push({
				kind: "TEXT",
				layerId: `${sceneKey}-text`,
				zIndex: 1,
				startOffsetFrame: "0",
				durationFrames: sceneDuration,
				box: { xPx: 90, yPx: 120, widthPx: 900, heightPx: 240 },
				opacityBasisPoints: 10000,
				text: scene.onScreenText,
				fontStableId: "noto-sans-700",
				fontWeight: 700,
				fontStyle: "normal",
				fontSizePx: 64,
				lineHeightPx: 80,
				textAlign: "CENTER",
				colorRgba: { r: 255, g: 255, b: 255, a: 255 },
				maxLines: 2,
				textLayoutVersion: "affichannel-text-layout-v1",
			});
		}
		timelineScenes.push({
			sceneKey,
			order: scene.order,
			startFrame: String(totalFrames),
			durationFrames: sceneDuration,
		});
		composedScenes.push({ sceneKey, layers });
		totalFrames += durationFrames;
	}

	const audioTracks: CompositionInputV1["sceneComposition"]["audioTracks"] = [];
	let audioStartFrame = BigInt(0);
	for (const segment of parsedScript.data.voiceoverSegments) {
		const facts = voiceSourceFacts.get(segment.key);
		if (!facts) return empty;
		const sampleCount = BigInt(facts.sourceSampleCount);
		const numerator = sampleCount * BigInt(30);
		const rate = BigInt(facts.sourceSampleRate);
		if (numerator % rate !== BigInt(0)) return empty;
		const durationFrames = numerator / rate;
		const track = {
			trackId: `track-${segment.key}`,
			sourceVoiceKey: segment.key,
			startFrame: String(audioStartFrame),
			durationFrames: String(durationFrames),
			endFrame: String(audioStartFrame + durationFrames),
			trimStartSample: "0",
			trimEndSample: facts.sourceSampleCount,
			gainMilliDb: 0,
			panBasisPoints: 0,
			fadeInSamples: "0",
			fadeOutSamples: "0",
		};
		const timing = checkCompositionAudioTiming(
			track,
			facts,
			{
				numerator: 30,
				denominator: 1,
			},
			String(totalFrames),
		);
		if (!timing.ok) return empty;
		audioTracks.push(track);
		audioStartFrame += durationFrames;
	}

	const fonts = await loader.loadBundledFontBundle(
		parsedScript.data.scenes.flatMap((scene) =>
			scene.onScreenText?.trim() ? [scene.onScreenText] : [],
		),
	);
	if (fonts.status !== "VALID") return empty;
	return {
		fonts: {
			bundleId: "affichannel-fonts-v1",
			faces: fonts.facts.map((font) => ({
				family: font.family,
				weight: font.weight,
				style: font.style,
				fontId: font.fontStableId,
				contentSha256: font.sha256,
			})),
		},
		voiceSourceFacts,
		timeline: {
			fps: VERTICAL_STANDARD_PROFILE.fps,
			totalFrames: String(totalFrames),
			scenes: timelineScenes,
		},
		sceneComposition: {
			version: "scene-composition.v1",
			scenes: composedScenes,
			audioTracks,
		},
	};
}

const defaultReader: ServerOwnedCompositionAssemblyReader = {
	read: readAuthoritativeCompositionAuthorities,
};

function missingResult(issues: readonly string[]): CompositionInputV1Result {
	return {
		ok: false,
		code: "COMPOSITION_INPUT_INCOMPLETE",
		issues: [...issues],
	};
}

function toBuilderSource(
	actor: WorkspaceActor,
	projectId: string,
	authorities: ServerOwnedCompositionAuthorities,
): CompositionInputBuilderSource | CompositionInputV1Result {
	const { project, script, renderMaterialization } = authorities;
	if (!project) return missingResult(["project"]);
	if (!script) return missingResult(["script"]);
	const parsedScript = scriptVersionEditableSnapshotSchema.safeParse(
		script.editableSnapshot,
	);
	if (!parsedScript.success)
		return { ok: false, code: "COMPOSITION_INPUT_INVALID" };
	if (!renderMaterialization.fonts)
		return missingResult(["fonts.renderManifest"]);
	if (!renderMaterialization.voiceSourceFacts)
		return missingResult(["voice.sourceFacts"]);
	if (!renderMaterialization.timeline) return missingResult(["timeline"]);
	if (!renderMaterialization.sceneComposition)
		return missingResult(["sceneComposition"]);
	const voiceConfig = authorities.voiceConfig;
	if (!voiceConfig) return missingResult(["voice.config"]);

	const scriptVoiceKeys = new Set(
		script.editableSnapshot.voiceoverSegments.map((segment) => segment.key),
	);
	const currentArtifacts = authorities.voiceArtifacts.filter(
		(artifact) =>
			artifact.status === "completed" &&
			artifact.sourceScriptVersionId === script.id &&
			artifact.sourceScriptRevision === script.revision &&
			artifact.voiceConfigRevision === voiceConfig.revision &&
			artifact.provider === voiceConfig.provider &&
			artifact.voiceId === voiceConfig.voiceId &&
			artifact.language === voiceConfig.language &&
			artifact.speed === voiceConfig.speed &&
			scriptVoiceKeys.has(artifact.segmentKey),
	);
	const artifactsByKey = new Map<string, VoiceSegmentArtifact>();
	for (const artifact of currentArtifacts) {
		if (!artifactsByKey.has(artifact.segmentKey))
			artifactsByKey.set(artifact.segmentKey, artifact);
	}
	if (artifactsByKey.size !== scriptVoiceKeys.size)
		return missingResult(["voice.completedArtifacts"]);

	const voiceSegments = parsedScript.data.voiceoverSegments.map((segment) => {
		const artifact = artifactsByKey.get(segment.key);
		const sourceFacts = renderMaterialization.voiceSourceFacts?.get(
			segment.key,
		);
		if (!artifact || !sourceFacts) return null;
		if (
			artifact.mimeType === null ||
			artifact.byteSize === null ||
			artifact.checksum === null ||
			artifact.durationMs === null ||
			artifact.storageProvider === null
		)
			return null;
		return {
			segmentKey: segment.key,
			semantic: {
				checksum: artifact.checksum,
				mimeType: "audio/mpeg" as const,
				byteSize: artifact.byteSize,
				sourceSampleRate: sourceFacts.sourceSampleRate,
				sourceSampleCount: sourceFacts.sourceSampleCount,
				durationMs: artifact.durationMs,
			},
			provenance: {
				artifactId: artifact.id,
				sourceScriptVersionId: artifact.sourceScriptVersionId,
				sourceScriptRevision: artifact.sourceScriptRevision,
				textSnapshot: artifact.segmentTextSnapshot,
				textHash: artifact.textHash,
				configId: voiceConfig.id,
				configRevision: artifact.voiceConfigRevision,
				provider: artifact.provider,
				voiceId: artifact.voiceId,
				language: artifact.language,
				speed: artifact.speed,
				storageProvider: artifact.storageProvider,
			},
		};
	});
	const completeVoiceSegments = voiceSegments.filter(
		(segment): segment is NonNullable<(typeof voiceSegments)[number]> =>
			segment !== null,
	);
	if (completeVoiceSegments.length !== voiceSegments.length)
		return missingResult(["voice.sourceFacts"]);

	const media = authorities.media.map((dependency) => {
		const asset = dependency.asset;
		if (
			asset.mimeType === null ||
			asset.byteSize === null ||
			asset.checksumSha256 === null
		)
			return null;
		return {
			dependencyKey: dependency.dependencyKey,
			role: dependency.role,
			semantic: {
				mediaType: asset.mediaType,
				mimeType: asset.mimeType as
					| "image/jpeg"
					| "image/png"
					| "image/webp"
					| "video/mp4"
					| "audio/mpeg",
				checksumSha256: asset.checksumSha256,
				byteSize: asset.byteSize,
				width: asset.width,
				height: asset.height,
				durationMs: asset.durationMs,
			},
			provenance: {
				mediaAssetId: asset.id,
				workspaceId: asset.workspaceId,
				projectId,
			},
		};
	});
	const completeMedia = media.filter(
		(dependency): dependency is NonNullable<(typeof media)[number]> =>
			dependency !== null,
	);
	if (completeMedia.length !== media.length)
		return missingResult(["media.metadata"]);

	return {
		workspaceId: actor.workspaceId,
		projectId,
		profile: VERTICAL_STANDARD_PROFILE,
		script: {
			semantic: parsedScript.data,
			provenance: {
				scriptVersionId: script.id,
				revision: script.revision,
				status: script.status,
				versionNumber: script.versionNumber,
			},
		},
		voice: { segments: completeVoiceSegments },
		media: completeMedia,
		fonts: renderMaterialization.fonts,
		config: {
			semantic: {
				compositionProfileId: VERTICAL_STANDARD_PROFILE.id,
				outputRules: authorities.outputRules ?? defaultOutputRules,
			},
			provenance: { outputRulesRevision: null },
		},
		timeline: renderMaterialization.timeline,
		sceneComposition: renderMaterialization.sceneComposition,
	};
}

/**
 * Server-owned composition snapshot boundary. The only caller inputs are the
 * authenticated actor and project identity; all semantic/provenance values are
 * read from authoritative server records.
 */
export async function assembleCompositionInputV1(
	actor: WorkspaceActor,
	projectId: string,
	reader: ServerOwnedCompositionAssemblyReader = defaultReader,
): Promise<CompositionInputV1Result> {
	const authorities = await reader.read(actor, projectId);
	const source = toBuilderSource(actor, projectId, authorities);
	if ("ok" in source) return source;
	return buildCompositionInputV1(source);
}
