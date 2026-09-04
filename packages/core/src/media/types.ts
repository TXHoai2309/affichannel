import { MediaAssetError } from "./errors";

export const mediaAssetMediaTypes = ["image", "video", "audio"] as const;
export type MediaType = (typeof mediaAssetMediaTypes)[number];

export const mediaAssetMimeTypes = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"video/mp4",
	"audio/mpeg",
] as const;
export type MediaAssetMimeType = (typeof mediaAssetMimeTypes)[number];

export const mediaAssetStatuses = [
	"pending_upload",
	"validating",
	"ready",
	"failed",
	"archived",
] as const;
export type MediaAssetStatus = (typeof mediaAssetStatuses)[number];

export const mediaAssetStorageProviders = ["local", "r2"] as const;
export type MediaAssetStorageProvider =
	(typeof mediaAssetStorageProviders)[number];

export const mediaAssetOrigins = [
	"user_upload",
	"ai_generated",
	"voice_generated",
	"imported",
] as const;
export type MediaAssetOrigin = (typeof mediaAssetOrigins)[number];

export const mediaUsageRights = [
	"owned",
	"licensed",
	"unknown",
	"restricted",
] as const;
export type MediaUsageRights = (typeof mediaUsageRights)[number];

export const mediaAssetUsageTypes = ["project_resource"] as const;
export type MediaAssetUsageType = (typeof mediaAssetUsageTypes)[number];

export type MediaAsset = Readonly<{
	id: string;
	workspaceId: string;
	createdByUserId: string;
	origin: MediaAssetOrigin;
	mediaType: MediaType;
	status: MediaAssetStatus;
	storageProvider: MediaAssetStorageProvider;
	storageKey: string;
	uploadSessionId: string;
	prepareIdempotencyKey: string;
	uploadExpiresAt: Date;
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
	finalizedAt: Date | null;
	archivedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}>;

export type MediaAssetLink = Readonly<{
	id: string;
	workspaceId: string;
	projectId: string;
	mediaAssetId: string;
	usageType: MediaAssetUsageType;
	createdByUserId: string;
	createdAt: Date;
}>;

export type MediaAssetReadyMetadata = Readonly<{
	mimeType: string;
	byteSize: number;
	checksumSha256: string;
	width: number | null;
	height: number | null;
	durationMs: number | null;
}>;

export function isMediaAssetType(value: unknown): value is MediaType {
	return (
		typeof value === "string" &&
		(mediaAssetMediaTypes as readonly string[]).includes(value)
	);
}

export function isMediaAssetStatus(value: unknown): value is MediaAssetStatus {
	return (
		typeof value === "string" &&
		(mediaAssetStatuses as readonly string[]).includes(value)
	);
}

export function isMediaAssetStorageProvider(
	value: unknown,
): value is MediaAssetStorageProvider {
	return (
		typeof value === "string" &&
		(mediaAssetStorageProviders as readonly string[]).includes(value)
	);
}

export function isMediaUsageRights(value: unknown): value is MediaUsageRights {
	return (
		typeof value === "string" &&
		(mediaUsageRights as readonly string[]).includes(value)
	);
}

export function canTransitionMediaAssetStatus(
	from: MediaAssetStatus,
	to: MediaAssetStatus,
) {
	if (from === "pending_upload") return to === "validating" || to === "failed";
	if (from === "validating") return to === "ready" || to === "failed";
	if (from === "ready" || from === "failed") return to === "archived";
	return false;
}

export function assertMediaAssetStatusTransition(
	from: MediaAssetStatus,
	to: MediaAssetStatus,
) {
	if (from === to) return;
	if (!canTransitionMediaAssetStatus(from, to)) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_STATUS",
			`MediaAsset cannot transition from ${from} to ${to}.`,
			{ from, to },
		);
	}
}
