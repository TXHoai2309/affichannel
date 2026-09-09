import type {
	MediaAsset,
	TechnicalPreflightResult,
	VoiceSegmentArtifact,
} from "@affichannel/core";
import {
	type CompositionInputV1,
	canonicalizeCompositionJson,
	MediaAssetError,
	sha256Hex,
	VoiceSegmentError,
} from "@affichannel/core";
import type { MediaAssetStorage } from "../media/media-asset-storage";
import { createMediaAssetStorage } from "../media/media-asset-storage-factory";
import {
	createProtectedGrant,
	verifyProtectedGrant,
} from "../media/protected-grants";
import type {
	VoiceAudioStorage,
	VoiceAudioStorageProvider,
} from "../storage/voice-audio-storage";
import { createVoiceAudioStorage } from "../storage/voice-audio-storage-factory";
import { technicalPreflightCompositionVersion } from "./composition-technical-preflight-service";
import type { CompositionVersionReadModel } from "./composition-version-repository";
import { findCompositionVersionRecord } from "./composition-version-repository";
import type { MediaAssetRecord } from "./media-asset-repository";
import { findMediaAssetByIdForWorkspace } from "./media-asset-repository";
import { sha256Bytes } from "./voice-segment-hashing";
import { findVoiceSegmentArtifactById } from "./voice-segment-repository";
import type { WorkspaceActor } from "./workspace";

const DEFAULT_PREVIEW_GRANT_TTL_MS = 60_000;

type PreviewDependencyKind = "media" | "voice";

type PreviewGrantPayload = Readonly<{
	purpose: "composition-preview";
	workspaceId: string;
	projectId: string;
	compositionVersionId: string;
	compositionFingerprint: string;
	technicalManifestFingerprint: string;
	dependencyKind: PreviewDependencyKind;
	dependencyKey: string;
	dependencyId: string;
	checksum: string;
	contentType: string;
	byteSize: number;
	storageProvider: MediaAsset["storageProvider"] | VoiceAudioStorageProvider;
	storageKey: string;
	expiresAt: number;
	nonce: string;
}>;

export type CompositionPreviewDependencyGrant = Readonly<{
	schemaVersion: "composition-preview-grant.v1";
	access: "protected";
	dependencyKey: string;
	token: string;
	contentType: string;
	byteSize: number;
	checksum: string;
	expiresAt: string;
}>;

export type CompositionPreviewDependencyBytes = Readonly<{
	bytes: Uint8Array;
	contentType: string;
	byteSize: number;
	checksum: string;
}>;

export class CompositionPreviewAccessError extends Error {
	readonly code:
		| "PREVIEW_GRANT_INVALID"
		| "PREVIEW_GRANT_EXPIRED"
		| "PREVIEW_ACCESS_DENIED"
		| "PREVIEW_DEPENDENCY_MISSING"
		| "PREVIEW_DEPENDENCY_UNAVAILABLE";

	constructor(
		code: CompositionPreviewAccessError["code"],
		message: string = code,
	) {
		super(message);
		this.name = "CompositionPreviewAccessError";
		this.code = code;
	}
}

type PreviewGrantDependencies = {
	findVersion?: typeof findCompositionVersionRecord;
	preflight?: (
		actor: WorkspaceActor,
		compositionVersionId: string,
	) => Promise<TechnicalPreflightResult>;
	findMediaAsset?: typeof findMediaAssetByIdForWorkspace;
	findVoiceArtifact?: typeof findVoiceSegmentArtifactById;
	mediaStorage?: (provider: MediaAsset["storageProvider"]) => MediaAssetStorage;
	voiceStorage?: (provider: VoiceAudioStorageProvider) => VoiceAudioStorage;
	now?: () => Date;
};

function dependencyPin(
	input: CompositionInputV1,
	dependencyKind: PreviewDependencyKind,
	dependencyKey: string,
) {
	if (dependencyKind === "media")
		return input.media.find((pin) => pin.dependencyKey === dependencyKey);
	return input.voice.segments.find((pin) => pin.segmentKey === dependencyKey);
}

function failDenied(
	message = "Preview dependency binding is not authorized.",
): never {
	throw new CompositionPreviewAccessError("PREVIEW_ACCESS_DENIED", message);
}

function validExpiry(now: Date, ttlMs: number) {
	if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)
		throw new CompositionPreviewAccessError("PREVIEW_GRANT_INVALID");
	const expiresAt = now.getTime() + ttlMs;
	if (!Number.isSafeInteger(expiresAt) || expiresAt <= now.getTime())
		throw new CompositionPreviewAccessError("PREVIEW_GRANT_INVALID");
	return expiresAt;
}

function manifestFactMatches(
	result: TechnicalPreflightResult,
	compositionVersionId: string,
	dependencyKind: PreviewDependencyKind,
	dependencyKey: string,
	checksum: string,
	byteSize: number,
	contentType: string,
) {
	if (
		result.status !== "VALID" ||
		!result.technicalManifest ||
		result.compositionVersionId !== compositionVersionId
	)
		return false;
	const fact =
		dependencyKind === "media"
			? result.technicalManifest.media.find(
					(candidate) => candidate.dependencyKey === dependencyKey,
				)
			: result.technicalManifest.voice.find(
					(candidate) => candidate.segmentKey === dependencyKey,
				);
	if (!fact) return false;
	if (dependencyKind === "media") {
		return (
			"checksumSha256" in fact &&
			fact.checksumSha256 === checksum &&
			fact.byteSize === byteSize &&
			fact.mimeType === contentType
		);
	}
	return (
		"checksum" in fact &&
		fact.checksum === checksum &&
		fact.byteSize === byteSize &&
		fact.mimeType === contentType
	);
}

function recordBindingMatches(
	version: CompositionVersionReadModel,
	payload: PreviewGrantPayload,
	pin: ReturnType<typeof dependencyPin>,
	record: MediaAssetRecord | VoiceSegmentArtifact | undefined,
) {
	if (
		!record ||
		version.workspaceId !== payload.workspaceId ||
		version.projectId !== payload.projectId ||
		version.id !== payload.compositionVersionId ||
		version.compositionFingerprint !== payload.compositionFingerprint ||
		!pin
	)
		return false;
	if (payload.dependencyKind === "media") {
		if (!("dependencyKey" in pin) || !("checksumSha256" in record))
			return false;
		if (
			pin.dependencyKey !== payload.dependencyKey ||
			pin.provenance.workspaceId !== payload.workspaceId ||
			pin.provenance.projectId !== payload.projectId ||
			pin.semantic.checksumSha256 !== payload.checksum ||
			pin.semantic.byteSize !== payload.byteSize ||
			pin.semantic.mimeType !== payload.contentType
		)
			return false;
		if (record.id !== payload.dependencyId) return false;
		return (
			record.workspaceId === payload.workspaceId &&
			record.id === pin.provenance.mediaAssetId &&
			record.storageProvider === payload.storageProvider &&
			record.storageKey === payload.storageKey &&
			record.checksumSha256 === payload.checksum &&
			record.byteSize === payload.byteSize &&
			record.mimeType === payload.contentType
		);
	}
	if (!("segmentKey" in pin) || !("checksum" in record)) return false;
	if (
		pin.segmentKey !== payload.dependencyKey ||
		pin.provenance.artifactId !== payload.dependencyId ||
		pin.semantic.checksum !== payload.checksum ||
		pin.semantic.byteSize !== payload.byteSize ||
		pin.semantic.mimeType !== payload.contentType
	)
		return false;
	if (record.id !== payload.dependencyId) return false;
	return (
		record.workspaceId === payload.workspaceId &&
		record.projectId === payload.projectId &&
		record.id === pin.provenance.artifactId &&
		record.status === "completed" &&
		record.storageProvider === payload.storageProvider &&
		record.storageKey === payload.storageKey &&
		record.checksum === payload.checksum &&
		record.byteSize === payload.byteSize &&
		record.mimeType === payload.contentType
	);
}

function parsePreviewGrant(
	token: string,
	nowMs = Date.now(),
): PreviewGrantPayload {
	let parsed: Record<string, unknown>;
	try {
		parsed = verifyProtectedGrant(token, nowMs);
	} catch (error) {
		if (
			error instanceof MediaAssetError &&
			error.code === "MEDIA_ASSET_GRANT_EXPIRED"
		)
			throw new CompositionPreviewAccessError("PREVIEW_GRANT_EXPIRED");
		throw new CompositionPreviewAccessError("PREVIEW_GRANT_INVALID");
	}
	if (
		parsed.purpose !== "composition-preview" ||
		typeof parsed.workspaceId !== "string" ||
		typeof parsed.projectId !== "string" ||
		typeof parsed.compositionVersionId !== "string" ||
		typeof parsed.compositionFingerprint !== "string" ||
		typeof parsed.technicalManifestFingerprint !== "string" ||
		(parsed.dependencyKind !== "media" && parsed.dependencyKind !== "voice") ||
		typeof parsed.dependencyKey !== "string" ||
		typeof parsed.dependencyId !== "string" ||
		typeof parsed.checksum !== "string" ||
		typeof parsed.contentType !== "string" ||
		typeof parsed.byteSize !== "number" ||
		!Number.isSafeInteger(parsed.byteSize) ||
		typeof parsed.storageProvider !== "string" ||
		typeof parsed.storageKey !== "string" ||
		typeof parsed.nonce !== "string"
	)
		throw new CompositionPreviewAccessError("PREVIEW_GRANT_INVALID");
	return parsed as unknown as PreviewGrantPayload;
}

export async function createCompositionPreviewDependencyGrant(
	actor: WorkspaceActor,
	compositionVersionId: string,
	dependencyKind: PreviewDependencyKind,
	dependencyKey: string,
	options: PreviewGrantDependencies & { ttlMs?: number } = {},
): Promise<CompositionPreviewDependencyGrant> {
	const findVersion = options.findVersion ?? findCompositionVersionRecord;
	const version = await findVersion(actor, compositionVersionId);
	if (!version)
		return failDenied("CompositionVersion is not in the actor workspace.");
	const preflight = await (
		options.preflight ?? technicalPreflightCompositionVersion
	)(actor, compositionVersionId);
	if (
		preflight.status !== "VALID" ||
		!preflight.technicalManifest ||
		!preflight.compositionFingerprint ||
		preflight.compositionFingerprint !== version.compositionFingerprint
	)
		return failDenied(
			"CompositionVersion is not technically valid for preview.",
		);
	const pin = dependencyPin(
		version.compositionInput,
		dependencyKind,
		dependencyKey,
	);
	if (!pin)
		return failDenied("Preview dependency is not in the exact composition.");
	const now = options.now?.() ?? new Date();
	const expiresAt = validExpiry(
		now,
		options.ttlMs ?? DEFAULT_PREVIEW_GRANT_TTL_MS,
	);
	const manifestFingerprint = await sha256Hex(
		canonicalizeCompositionJson(preflight.technicalManifest),
	);
	let dependencyId: string;
	let checksum: string;
	let contentType: string;
	let byteSize: number;
	let storageProvider:
		| MediaAsset["storageProvider"]
		| VoiceAudioStorageProvider;
	let storageKey: string;
	if (dependencyKind === "media") {
		if (!("dependencyKey" in pin)) return failDenied();
		const asset = await (
			options.findMediaAsset ?? findMediaAssetByIdForWorkspace
		)(actor, pin.provenance.mediaAssetId);
		if (
			!asset ||
			asset.storageProvider === null ||
			!asset.storageKey ||
			asset.checksumSha256 === null ||
			asset.byteSize === null ||
			asset.mimeType === null ||
			asset.id !== pin.provenance.mediaAssetId ||
			asset.checksumSha256 !== pin.semantic.checksumSha256 ||
			asset.byteSize !== pin.semantic.byteSize ||
			asset.mimeType !== pin.semantic.mimeType ||
			!manifestFactMatches(
				preflight,
				compositionVersionId,
				dependencyKind,
				dependencyKey,
				asset.checksumSha256,
				asset.byteSize,
				asset.mimeType,
			)
		)
			return failDenied("Media dependency is not exactly preflighted.");
		dependencyId = asset.id;
		checksum = asset.checksumSha256;
		contentType = asset.mimeType;
		byteSize = asset.byteSize;
		storageProvider = asset.storageProvider;
		storageKey = asset.storageKey;
	} else {
		if (!("segmentKey" in pin)) return failDenied();
		const artifact = await (
			options.findVoiceArtifact ?? findVoiceSegmentArtifactById
		)(actor, pin.provenance.artifactId);
		if (
			!artifact ||
			artifact.storageProvider === null ||
			!artifact.storageKey ||
			artifact.checksum === null ||
			artifact.byteSize === null ||
			artifact.mimeType !== "audio/mpeg" ||
			artifact.id !== pin.provenance.artifactId ||
			artifact.checksum !== pin.semantic.checksum ||
			artifact.byteSize !== pin.semantic.byteSize ||
			artifact.mimeType !== pin.semantic.mimeType ||
			!manifestFactMatches(
				preflight,
				compositionVersionId,
				dependencyKind,
				dependencyKey,
				artifact.checksum,
				artifact.byteSize,
				artifact.mimeType,
			)
		)
			return failDenied("Voice dependency is not exactly preflighted.");
		dependencyId = artifact.id;
		checksum = artifact.checksum;
		contentType = artifact.mimeType;
		byteSize = artifact.byteSize;
		storageProvider = artifact.storageProvider;
		storageKey = artifact.storageKey;
	}
	const token = createProtectedGrant({
		purpose: "composition-preview",
		workspaceId: actor.workspaceId,
		projectId: version.projectId,
		compositionVersionId,
		compositionFingerprint: version.compositionFingerprint,
		technicalManifestFingerprint: manifestFingerprint,
		dependencyKind,
		dependencyKey,
		dependencyId,
		checksum,
		contentType,
		byteSize,
		storageProvider,
		storageKey,
		expiresAt,
	});
	return {
		schemaVersion: "composition-preview-grant.v1",
		access: "protected",
		dependencyKey,
		token,
		contentType,
		byteSize,
		checksum,
		expiresAt: new Date(expiresAt).toISOString(),
	};
}

export async function readCompositionPreviewDependency(
	actor: WorkspaceActor,
	token: string,
	options: PreviewGrantDependencies = {},
): Promise<CompositionPreviewDependencyBytes> {
	const payload = parsePreviewGrant(token, options.now?.().getTime());
	if (payload.workspaceId !== actor.workspaceId)
		return failDenied("Preview grant workspace does not match the actor.");
	const version = await (options.findVersion ?? findCompositionVersionRecord)(
		actor,
		payload.compositionVersionId,
	);
	if (!version) return failDenied();
	const pin = dependencyPin(
		version.compositionInput,
		payload.dependencyKind,
		payload.dependencyKey,
	);
	let record: MediaAssetRecord | VoiceSegmentArtifact | undefined;
	if (payload.dependencyKind === "media") {
		record = await (options.findMediaAsset ?? findMediaAssetByIdForWorkspace)(
			actor,
			payload.dependencyId,
		);
	} else {
		record = await (options.findVoiceArtifact ?? findVoiceSegmentArtifactById)(
			actor,
			payload.dependencyId,
		);
	}
	if (!recordBindingMatches(version, payload, pin, record)) return failDenied();
	if (!record) return failDenied();
	let bytes: Uint8Array;
	try {
		const storage =
			payload.dependencyKind === "media"
				? (options.mediaStorage ?? createMediaAssetStorage)(
						record.storageProvider as MediaAsset["storageProvider"],
					)
				: (options.voiceStorage ?? createVoiceAudioStorage)(
						record.storageProvider as VoiceAudioStorageProvider,
					);
		bytes = await storage.get(payload.storageKey);
	} catch (error) {
		if (
			error instanceof MediaAssetError &&
			error.code === "MEDIA_ASSET_STORAGE_NOT_FOUND"
		)
			throw new CompositionPreviewAccessError("PREVIEW_DEPENDENCY_MISSING");
		if (error instanceof VoiceSegmentError && error.metadata?.notFound === true)
			throw new CompositionPreviewAccessError("PREVIEW_DEPENDENCY_MISSING");
		throw new CompositionPreviewAccessError("PREVIEW_DEPENDENCY_UNAVAILABLE");
	}
	if (
		bytes.byteLength !== payload.byteSize ||
		sha256Bytes(bytes) !== payload.checksum
	)
		return failDenied("Preview dependency bytes no longer match the grant.");
	return {
		bytes,
		contentType: payload.contentType,
		byteSize: bytes.byteLength,
		checksum: payload.checksum,
	};
}
