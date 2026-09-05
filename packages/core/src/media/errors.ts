export const mediaAssetErrorCodes = [
	"MEDIA_ASSET_NOT_FOUND",
	"MEDIA_ASSET_INVALID_STATUS",
	"MEDIA_ASSET_NOT_READY",
	"MEDIA_ASSET_WORKSPACE_MISMATCH",
	"MEDIA_ASSET_INVALID_MEDIA",
	"MEDIA_ASSET_INVALID_METADATA",
	"MEDIA_ASSET_CHECKSUM_INVALID",
	"MEDIA_ASSET_STORAGE_KEY_INVALID",
	"MEDIA_ASSET_STORAGE_ERROR",
	"MEDIA_ASSET_STORAGE_NOT_FOUND",
	"MEDIA_ASSET_STILL_REFERENCED",
	"MEDIA_ASSET_IDEMPOTENCY_CONFLICT",
	"MEDIA_ASSET_UPLOAD_SESSION_INVALID",
	"MEDIA_ASSET_UPLOAD_EXPIRED",
	"MEDIA_ASSET_FILENAME_INVALID",
	"MEDIA_ASSET_SIZE_LIMIT_EXCEEDED",
	"MEDIA_ASSET_CONFIGURATION_INVALID",
	"MEDIA_ASSET_RIGHTS_NOT_ELIGIBLE",
	"MEDIA_ASSET_GRANT_INVALID",
	"MEDIA_ASSET_GRANT_EXPIRED",
	"MEDIA_ASSET_UPLOAD_NOT_ALLOWED",
	"MEDIA_ASSET_DOWNLOAD_NOT_ALLOWED",
	"MEDIA_ASSET_VALIDATION_IN_PROGRESS",
	"MEDIA_ASSET_STORAGE_UNAVAILABLE",
	"MEDIA_ASSET_INVALID_CURSOR",
] as const;

export type MediaAssetErrorCode = (typeof mediaAssetErrorCodes)[number];

export class MediaAssetError extends Error {
	readonly code: MediaAssetErrorCode;
	readonly metadata: Record<string, unknown> | undefined;

	constructor(
		code: MediaAssetErrorCode,
		message: string = code,
		metadata?: Record<string, unknown>,
	) {
		super(message);
		this.name = "MediaAssetError";
		this.code = code;
		this.metadata = metadata;
	}
}
