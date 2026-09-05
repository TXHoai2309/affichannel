import { createHash, randomUUID } from "node:crypto";
import {
	assertDisplayName,
	createMediaAssetStorageKey,
	type MediaAsset,
	MediaAssetError,
	type MediaAssetUsageType,
	type MediaType,
	type MediaUsageRights,
	mediaAssetMediaTypes,
	mediaAssetMimeTypes,
	mediaAssetUsageTypes,
	mediaUsageRights,
	normalizeMediaTags,
	sanitizeOriginalFilename,
} from "@affichannel/core";
import { env } from "@affichannel/env/server";
import {
	getMediaAssetDownloadExpiry,
	getMediaAssetSizeLimits,
	getMediaAssetUploadExpiry,
} from "../media/media-asset-config";
import { createLocalMediaAssetGrant } from "../media/media-asset-grants";
import { createMediaAssetStorage } from "../media/media-asset-storage-factory";
import { validateMediaAssetBytes } from "../media/media-asset-validation";
import {
	archiveMediaAsset,
	countActiveMediaAssetLinks,
	createMediaAssetLink,
	createPendingMediaAsset,
	findMediaAssetByIdForWorkspace,
	findMediaAssetByPrepareIdempotencyKey,
	listMediaAssetLinks,
	listMediaAssets as listMediaAssetRecords,
	markMediaAssetFailed,
	markMediaAssetReady,
	markMediaAssetValidating,
	removeMediaAssetLink,
	updateMediaAssetMetadata,
} from "./media-asset-repository";
import type { WorkspaceActor } from "./workspace";

export const mediaPrepareInput = {
	mediaType: mediaAssetMediaTypes,
	mediaAssetMimeTypes,
	mediaUsageRights,
	mediaAssetUsageTypes,
};

function assertMediaType(value: unknown): asserts value is MediaType {
	if (
		typeof value !== "string" ||
		!(mediaAssetMediaTypes as readonly string[]).includes(value)
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"Media type is invalid.",
		);
	}
}

function assertDeclaredMime(
	mediaType: MediaType,
	value: unknown,
): asserts value is string {
	if (
		typeof value !== "string" ||
		!(mediaAssetMimeTypes as readonly string[]).includes(value)
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_MEDIA",
			"Declared MIME type is not supported.",
		);
	}
	const valid =
		mediaType === "image"
			? ["image/jpeg", "image/png", "image/webp"]
			: mediaType === "video"
				? ["video/mp4"]
				: ["audio/mpeg"];
	if (!valid.includes(value)) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_MEDIA",
			"Declared MIME type does not match media type.",
		);
	}
}

function assertDeclaredByteSize(mediaType: MediaType, value: unknown) {
	const maxBytes = getMediaAssetSizeLimits()[mediaType];
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"Declared byte size must be a positive safe integer.",
		);
	}
	if ((value as number) > maxBytes) {
		throw new MediaAssetError(
			"MEDIA_ASSET_SIZE_LIMIT_EXCEEDED",
			"Declared byte size exceeds the media type limit.",
			{ maxBytes },
		);
	}
	return value as number;
}

function assertIdempotencyKey(value: unknown) {
	if (
		typeof value !== "string" ||
		value.trim().length < 1 ||
		value.trim().length > 200
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"Idempotency key is invalid.",
		);
	}
	return value.trim();
}

function extensionForMime(mime: string) {
	if (mime === "image/jpeg") return "jpg";
	if (mime === "image/png") return "png";
	if (mime === "image/webp") return "webp";
	if (mime === "video/mp4") return "mp4";
	return "mp3";
}

function declaredByteSizeFingerprint(value: number) {
	return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function declaredByteSizeFromStorageKey(asset: MediaAsset) {
	const objectName = asset.storageKey.split("/").at(-1) ?? "";
	const prefix = objectName.split("-", 1)[0];
	return prefix && /^[a-f0-9]{16}$/.test(prefix) ? prefix : undefined;
}

export type MediaAssetDto = Readonly<{
	id: string;
	mediaType: MediaType;
	status: MediaAsset["status"];
	origin: MediaAsset["origin"];
	originalFilename: string;
	displayName: string;
	declaredMimeType: string | null;
	mimeType: string | null;
	byteSize: number | null;
	checksumSha256: string | null;
	width: number | null;
	height: number | null;
	durationMs: number | null;
	usageRights: MediaUsageRights;
	tags: string[];
	failureCode: string | null;
	uploadExpiresAt: Date;
	finalizedAt: Date | null;
	archivedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}>;

function toAssetDto(asset: MediaAsset): MediaAssetDto {
	return {
		id: asset.id,
		mediaType: asset.mediaType,
		status: asset.status,
		origin: asset.origin,
		originalFilename: asset.originalFilename,
		displayName: asset.displayName,
		declaredMimeType: asset.declaredMimeType,
		mimeType: asset.mimeType,
		byteSize: asset.byteSize,
		checksumSha256: asset.checksumSha256,
		width: asset.width,
		height: asset.height,
		durationMs: asset.durationMs,
		usageRights: asset.usageRights,
		tags: [...asset.tags],
		failureCode: asset.failureCode,
		uploadExpiresAt: asset.uploadExpiresAt,
		finalizedAt: asset.finalizedAt,
		archivedAt: asset.archivedAt,
		createdAt: asset.createdAt,
		updatedAt: asset.updatedAt,
	};
}

function samePrepareIntent(
	asset: MediaAsset,
	input: {
		mediaType: MediaType;
		declaredMimeType: string;
		declaredByteSize: number;
		originalFilename: string;
		displayName: string;
		usageRights: MediaUsageRights;
		tags: string[];
	},
) {
	const declaredByteSize = declaredByteSizeFromStorageKey(asset);
	return (
		asset.mediaType === input.mediaType &&
		asset.declaredMimeType === input.declaredMimeType &&
		asset.originalFilename === input.originalFilename &&
		asset.displayName === input.displayName &&
		asset.usageRights === input.usageRights &&
		asset.tags.join("\u0000") === input.tags.join("\u0000") &&
		(declaredByteSize === undefined ||
			declaredByteSize ===
				declaredByteSizeFingerprint(input.declaredByteSize)) &&
		(asset.byteSize === null || asset.byteSize === input.declaredByteSize)
	);
}

async function uploadGrant(
	actor: WorkspaceActor,
	asset: MediaAsset,
	declaredByteSize?: number,
) {
	const expiresAt = asset.uploadExpiresAt;
	if (asset.storageProvider === "local") {
		return {
			provider: "local" as const,
			urlOrToken: createLocalMediaAssetGrant({
				purpose: "upload",
				workspaceId: actor.workspaceId,
				assetId: asset.id,
				storageKey: asset.storageKey,
				uploadSessionId: asset.uploadSessionId,
				contentType: asset.declaredMimeType ?? "application/octet-stream",
				byteSize:
					declaredByteSize ??
					asset.byteSize ??
					getMediaAssetSizeLimits()[asset.mediaType],
				strictByteSize: declaredByteSize !== undefined,
				expiresAt: expiresAt.getTime(),
			}),
			expiresAt,
			contentType: asset.declaredMimeType,
			byteSize:
				declaredByteSize ??
				asset.byteSize ??
				getMediaAssetSizeLimits()[asset.mediaType],
		};
	}
	const storage = createMediaAssetStorage(asset.storageProvider);
	const grant = await storage.createUploadGrant({
		storageKey: asset.storageKey,
		contentType: asset.declaredMimeType ?? "application/octet-stream",
		byteSize:
			declaredByteSize ??
			asset.byteSize ??
			getMediaAssetSizeLimits()[asset.mediaType],
		expiresAt,
	});
	return {
		provider: "r2" as const,
		urlOrToken: grant.urlOrToken,
		expiresAt: grant.expiresAt,
		contentType: asset.declaredMimeType,
		byteSize:
			declaredByteSize ??
			asset.byteSize ??
			getMediaAssetSizeLimits()[asset.mediaType],
	};
}

async function cleanupMediaAsset(asset: MediaAsset) {
	try {
		await createMediaAssetStorage(asset.storageProvider).cleanup(
			asset.storageKey,
		);
	} catch {
		// Cleanup is best effort; the typed failed row remains for reconciliation.
	}
}

export async function prepareMediaAssetUpload(
	actor: WorkspaceActor,
	rawInput: {
		mediaType: MediaType;
		originalFilename: string;
		displayName: string;
		declaredMimeType: string;
		declaredByteSize: number;
		usageRights?: MediaUsageRights;
		tags?: readonly string[];
		idempotencyKey: string;
	},
) {
	assertMediaType(rawInput.mediaType);
	assertDeclaredMime(rawInput.mediaType, rawInput.declaredMimeType);
	const declaredByteSize = assertDeclaredByteSize(
		rawInput.mediaType,
		rawInput.declaredByteSize,
	);
	const originalFilename = sanitizeOriginalFilename(rawInput.originalFilename);
	const displayName = assertDisplayName(rawInput.displayName);
	const usageRights = rawInput.usageRights ?? "unknown";
	if (!(mediaUsageRights as readonly string[]).includes(usageRights)) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"Usage rights are invalid.",
		);
	}
	const tags = normalizeMediaTags(rawInput.tags ?? []);
	const idempotencyKey = assertIdempotencyKey(rawInput.idempotencyKey);
	const intent = {
		mediaType: rawInput.mediaType,
		declaredMimeType: rawInput.declaredMimeType,
		declaredByteSize,
		originalFilename,
		displayName,
		usageRights,
		tags,
	};

	let asset = await findMediaAssetByPrepareIdempotencyKey(
		actor,
		idempotencyKey,
	);
	if (asset) {
		if (!samePrepareIntent(asset, intent))
			throw new MediaAssetError(
				"MEDIA_ASSET_IDEMPOTENCY_CONFLICT",
				"Idempotency key was used with a different upload intent.",
			);
		if (
			asset.status === "pending_upload" &&
			asset.uploadExpiresAt.getTime() > Date.now()
		) {
			return {
				asset: toAssetDto(asset),
				assetId: asset.id,
				uploadSessionId: asset.uploadSessionId,
				replayed: true,
				uploadGrant: await uploadGrant(actor, asset, declaredByteSize),
			};
		}
		return {
			asset: toAssetDto(asset),
			assetId: asset.id,
			uploadSessionId: asset.uploadSessionId,
			replayed: true,
			uploadGrant: null,
		};
	}

	const assetId = randomUUID();
	const uploadSessionId = randomUUID();
	const uploadExpiresAt = getMediaAssetUploadExpiry();
	const storageProvider = env.MEDIA_STORAGE_PROVIDER;
	const storageKey = createMediaAssetStorageKey({
		workspaceId: actor.workspaceId,
		assetId,
		objectName: `${declaredByteSizeFingerprint(declaredByteSize)}-${randomUUID()}.${extensionForMime(rawInput.declaredMimeType)}`,
	});
	try {
		asset = await createPendingMediaAsset(actor, {
			id: assetId,
			mediaType: rawInput.mediaType,
			origin: "user_upload",
			storageProvider,
			storageKey,
			uploadSessionId,
			prepareIdempotencyKey: idempotencyKey,
			uploadExpiresAt,
			originalFilename,
			displayName,
			declaredMimeType: rawInput.declaredMimeType,
			usageRights,
			tags,
		});
	} catch (error) {
		const pgCode = (error as { code?: string }).code;
		if (pgCode === "23505") {
			const raced = await findMediaAssetByPrepareIdempotencyKey(
				actor,
				idempotencyKey,
			);
			if (raced && samePrepareIntent(raced, intent)) {
				return {
					asset: toAssetDto(raced),
					assetId: raced.id,
					uploadSessionId: raced.uploadSessionId,
					replayed: true,
					uploadGrant:
						raced.status === "pending_upload" &&
						raced.uploadExpiresAt.getTime() > Date.now()
							? await uploadGrant(actor, raced, declaredByteSize)
							: null,
				};
			}
			throw new MediaAssetError(
				"MEDIA_ASSET_IDEMPOTENCY_CONFLICT",
				"Upload idempotency key is already in use.",
			);
		}
		throw error;
	}
	if (!asset)
		throw new MediaAssetError(
			"MEDIA_ASSET_STORAGE_ERROR",
			"Could not create media asset.",
		);
	let grant: Awaited<ReturnType<typeof uploadGrant>>;
	try {
		grant = await uploadGrant(actor, asset, declaredByteSize);
	} catch (error) {
		await markMediaAssetFailed(actor, {
			assetId: asset.id,
			expectedStatus: "pending_upload",
			failureCode:
				error instanceof MediaAssetError
					? error.code
					: "MEDIA_ASSET_STORAGE_UNAVAILABLE",
		}).catch(() => undefined);
		await cleanupMediaAsset(asset);
		throw error;
	}
	return {
		asset: toAssetDto(asset),
		assetId: asset.id,
		uploadSessionId: asset.uploadSessionId,
		replayed: false,
		uploadGrant: grant,
	};
}

export async function finalizeMediaAssetUpload(
	actor: WorkspaceActor,
	input: { assetId: string; uploadSessionId: string },
) {
	const asset = await findMediaAssetByIdForWorkspace(actor, input.assetId);
	if (!asset || asset.uploadSessionId !== input.uploadSessionId)
		throw new MediaAssetError(
			"MEDIA_ASSET_NOT_FOUND",
			"Media asset was not found.",
		);
	if (asset.status === "ready" || asset.status === "archived")
		return { outcome: "already_finalized" as const, asset: toAssetDto(asset) };
	if (asset.status === "failed")
		return { outcome: "failed" as const, asset: toAssetDto(asset) };
	if (asset.status === "validating")
		return { outcome: "in_progress" as const, asset: toAssetDto(asset) };
	if (asset.uploadExpiresAt.getTime() <= Date.now()) {
		const failed = await markMediaAssetFailed(actor, {
			assetId: asset.id,
			expectedStatus: "pending_upload",
			failureCode: "MEDIA_ASSET_UPLOAD_EXPIRED",
		});
		if (!failed) {
			const current = await findMediaAssetByIdForWorkspace(actor, asset.id);
			if (current?.status === "validating")
				return { outcome: "in_progress" as const, asset: toAssetDto(current) };
			if (current?.status === "ready" || current?.status === "archived")
				return {
					outcome: "already_finalized" as const,
					asset: toAssetDto(current),
				};
			if (current?.status === "failed")
				return { outcome: "failed" as const, asset: toAssetDto(current) };
		}
		await cleanupMediaAsset(failed ?? asset);
		return {
			outcome: "failed" as const,
			asset: toAssetDto(
				failed ??
					({
						...asset,
						status: "failed",
						failureCode: "MEDIA_ASSET_UPLOAD_EXPIRED",
					} as MediaAsset),
			),
		};
	}
	const validating = await markMediaAssetValidating(actor, {
		assetId: asset.id,
	});
	if (!validating) {
		const current = await findMediaAssetByIdForWorkspace(actor, asset.id);
		if (!current)
			throw new MediaAssetError(
				"MEDIA_ASSET_NOT_FOUND",
				"Media asset was not found.",
			);
		if (current.status === "validating")
			return { outcome: "in_progress" as const, asset: toAssetDto(current) };
		if (current.status === "ready" || current.status === "archived")
			return {
				outcome: "already_finalized" as const,
				asset: toAssetDto(current),
			};
		return { outcome: "failed" as const, asset: toAssetDto(current) };
	}
	const storage = createMediaAssetStorage(validating.storageProvider);
	try {
		const head = await storage.head(validating.storageKey);
		const maxBytes = getMediaAssetSizeLimits()[validating.mediaType];
		if (!head || head.byteSize <= 0)
			throw new MediaAssetError(
				"MEDIA_ASSET_STORAGE_NOT_FOUND",
				"Uploaded media bytes were not found.",
			);
		if (
			head.byteSize > maxBytes ||
			(head.byteSize !== validating.byteSize &&
				validating.byteSize !== null &&
				validating.byteSize !== undefined)
		) {
			throw new MediaAssetError(
				head.byteSize > maxBytes
					? "MEDIA_ASSET_SIZE_LIMIT_EXCEEDED"
					: "MEDIA_ASSET_INVALID_MEDIA",
				"Uploaded media byte size is invalid.",
			);
		}
		const declaredFingerprint = declaredByteSizeFromStorageKey(validating);
		if (
			declaredFingerprint &&
			declaredFingerprint !== declaredByteSizeFingerprint(head.byteSize)
		)
			throw new MediaAssetError(
				"MEDIA_ASSET_INVALID_MEDIA",
				"Uploaded media byte size does not match the prepared intent.",
			);
		const storedContentType = head.contentType
			?.split(";", 1)[0]
			?.trim()
			.toLowerCase();
		if (
			storedContentType &&
			storedContentType !== validating.declaredMimeType?.toLowerCase()
		)
			throw new MediaAssetError(
				"MEDIA_ASSET_INVALID_MEDIA",
				"Stored media MIME type does not match the declaration.",
			);
		const bytes = await storage.get(validating.storageKey);
		if (bytes.byteLength !== head.byteSize)
			throw new MediaAssetError(
				"MEDIA_ASSET_STORAGE_ERROR",
				"Media object changed during finalization.",
			);
		const metadata = await validateMediaAssetBytes({
			mediaType: validating.mediaType,
			bytes,
			originalFilename: validating.originalFilename,
			declaredMimeType: validating.declaredMimeType,
			maxBytes,
		});
		const ready = await markMediaAssetReady(actor, {
			assetId: validating.id,
			expectedStatus: "validating",
			metadata,
		});
		if (!ready) {
			const current = await findMediaAssetByIdForWorkspace(
				actor,
				validating.id,
			);
			if (current?.status === "ready" || current?.status === "archived")
				return {
					outcome: "already_finalized" as const,
					asset: toAssetDto(current),
				};
			if (current?.status === "validating")
				return { outcome: "in_progress" as const, asset: toAssetDto(current) };
			throw new MediaAssetError(
				"MEDIA_ASSET_STORAGE_ERROR",
				"Media asset finalization state was uncertain.",
			);
		}
		return { outcome: "ready" as const, asset: toAssetDto(ready) };
	} catch (error) {
		const failureCode =
			error instanceof MediaAssetError
				? error.code
				: "MEDIA_ASSET_STORAGE_UNAVAILABLE";
		const failed = await markMediaAssetFailed(actor, {
			assetId: validating.id,
			expectedStatus: "validating",
			failureCode,
		});
		await cleanupMediaAsset(validating);
		if (!failed) {
			const current = await findMediaAssetByIdForWorkspace(
				actor,
				validating.id,
			);
			if (current)
				return {
					outcome:
						current.status === "ready"
							? ("already_finalized" as const)
							: ("failed" as const),
					asset: toAssetDto(current),
				};
		}
		return {
			outcome: "failed" as const,
			asset: toAssetDto(failed ?? validating),
		};
	}
}

export async function listMediaAssets(
	actor: WorkspaceActor,
	input: Parameters<typeof listMediaAssetRecords>[1] & {
		includeArchived?: boolean;
	},
) {
	const result = await listMediaAssetRecords(actor, {
		...input,
		archiveScope: input.includeArchived ? "all" : input.archiveScope,
	});
	if (result.kind === "invalid_cursor")
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_CURSOR",
			"Cursor is invalid.",
		);
	return { ...result, items: result.items.map(toAssetDto) };
}

export async function getMediaAsset(actor: WorkspaceActor, assetId: string) {
	const asset = await findMediaAssetByIdForWorkspace(actor, assetId);
	if (!asset)
		throw new MediaAssetError(
			"MEDIA_ASSET_NOT_FOUND",
			"Media asset was not found.",
		);
	return {
		asset: toAssetDto(asset),
		links: await listMediaAssetLinks(actor, asset.id),
		linkCount: await countActiveMediaAssetLinks(actor, asset.id),
	};
}

export async function updateMediaAsset(
	actor: WorkspaceActor,
	assetId: string,
	input: { displayName: string; tags: string[]; usageRights: MediaUsageRights },
) {
	if (!(mediaUsageRights as readonly string[]).includes(input.usageRights))
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"Usage rights are invalid.",
		);
	const asset = await updateMediaAssetMetadata(actor, {
		assetId,
		displayName: assertDisplayName(input.displayName),
		tags: normalizeMediaTags(input.tags),
		usageRights: input.usageRights,
	});
	if (!asset)
		throw new MediaAssetError(
			"MEDIA_ASSET_NOT_FOUND",
			"Media asset was not found.",
		);
	return { asset: toAssetDto(asset) };
}

export async function archiveMediaAssetRecord(
	actor: WorkspaceActor,
	assetId: string,
) {
	const asset = await archiveMediaAsset(actor, assetId);
	if (!asset)
		throw new MediaAssetError(
			"MEDIA_ASSET_NOT_FOUND",
			"Media asset was not found.",
		);
	return { asset: toAssetDto(asset) };
}

export async function getMediaAssetDownload(
	actor: WorkspaceActor,
	assetId: string,
) {
	const asset = await findMediaAssetByIdForWorkspace(actor, assetId);
	if (!asset)
		throw new MediaAssetError(
			"MEDIA_ASSET_NOT_FOUND",
			"Media asset was not found.",
		);
	if (asset.status !== "ready" && asset.status !== "archived")
		throw new MediaAssetError(
			"MEDIA_ASSET_DOWNLOAD_NOT_ALLOWED",
			"Media asset is not available for download.",
		);
	const expiresAt = getMediaAssetDownloadExpiry();
	if (asset.storageProvider === "local") {
		return {
			provider: "local" as const,
			urlOrToken: createLocalMediaAssetGrant({
				purpose: "download",
				workspaceId: actor.workspaceId,
				assetId: asset.id,
				storageKey: asset.storageKey,
				contentType: asset.mimeType ?? "application/octet-stream",
				expiresAt: expiresAt.getTime(),
			}),
			expiresAt,
			contentType: asset.mimeType,
			byteSize: asset.byteSize,
		};
	}
	const grant = await createMediaAssetStorage(
		asset.storageProvider,
	).createDownloadGrant({
		storageKey: asset.storageKey,
		contentType: asset.mimeType ?? "application/octet-stream",
		expiresAt,
	});
	return {
		provider: "r2" as const,
		urlOrToken: grant.urlOrToken,
		expiresAt: grant.expiresAt,
		contentType: asset.mimeType,
		byteSize: asset.byteSize,
	};
}

export async function linkMediaAssetToProject(
	actor: WorkspaceActor,
	input: {
		assetId: string;
		projectId: string;
		usageType?: MediaAssetUsageType;
	},
) {
	const link = await createMediaAssetLink(actor, {
		id: randomUUID(),
		mediaAssetId: input.assetId,
		projectId: input.projectId,
		usageType: input.usageType,
	});
	if (!link)
		throw new MediaAssetError(
			"MEDIA_ASSET_STORAGE_ERROR",
			"Could not create media asset link.",
		);
	return { link };
}

export async function unlinkMediaAssetFromProject(
	actor: WorkspaceActor,
	input: {
		assetId: string;
		projectId: string;
		usageType?: MediaAssetUsageType;
	},
) {
	const link = await removeMediaAssetLink(actor, {
		mediaAssetId: input.assetId,
		projectId: input.projectId,
		usageType: input.usageType,
	});
	return { removed: Boolean(link), link: link ?? null };
}

export function isSupportedMediaUsageType(
	value: unknown,
): value is MediaAssetUsageType {
	return (
		typeof value === "string" &&
		(mediaAssetUsageTypes as readonly string[]).includes(value)
	);
}

export { toAssetDto };
