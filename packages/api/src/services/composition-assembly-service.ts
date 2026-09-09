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
	defaultOutputRules,
	scriptVersionEditableSnapshotSchema,
	VERTICAL_STANDARD_PROFILE,
} from "@affichannel/core";
import { db, mediaAsset, mediaAssetLink } from "@affichannel/db";
import { and, eq } from "drizzle-orm";

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

/** Technical pins deliberately remain optional until the later technical phase. */
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

	return {
		project: projectSubject,
		script,
		voiceConfig,
		voiceArtifacts,
		media: mediaRows.map((row) => ({
			dependencyKey: row.asset.id,
			role: row.usageType,
			asset: {
				...row.asset,
				tags: [...row.asset.tags],
			} as MediaAsset,
		})),
		outputRules,
		// No render/font/sample authority exists in 21A. Returning null is
		// intentional: the assembler must not invent technical pins.
		renderMaterialization: {
			fonts: null,
			voiceSourceFacts: null,
			timeline: null,
			sceneComposition: null,
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
