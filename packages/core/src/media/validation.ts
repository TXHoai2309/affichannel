import { z } from "zod";
import { MediaAssetError } from "./errors";
import {
	mediaAssetMediaTypes,
	mediaAssetMimeTypes,
	mediaAssetOrigins,
	mediaAssetStatuses,
	mediaAssetStorageProviders,
	mediaAssetUsageTypes,
	mediaUsageRights,
} from "./types";

export const mediaTypeSchema = z.enum(mediaAssetMediaTypes);
export const mediaAssetMimeTypeSchema = z.enum(mediaAssetMimeTypes);
export const mediaAssetStatusSchema = z.enum(mediaAssetStatuses);
export const mediaAssetStorageProviderSchema = z.enum(
	mediaAssetStorageProviders,
);
export const mediaAssetOriginSchema = z.enum(mediaAssetOrigins);
export const mediaUsageRightsSchema = z.enum(mediaUsageRights);
export const mediaAssetUsageTypeSchema = z.enum(mediaAssetUsageTypes);

export const mediaAssetMutableMetadataSchema = z.object({
	displayName: z.string().trim().min(1).max(240),
	tags: z.array(z.string().trim().min(1).max(80)).max(50),
	usageRights: mediaUsageRightsSchema,
});

export const MEDIA_ASSET_MAX_DISPLAY_NAME_LENGTH = 240;
export const MEDIA_ASSET_MAX_ORIGINAL_FILENAME_LENGTH = 255;
export const MEDIA_ASSET_MAX_TAGS = 50;
export const MEDIA_ASSET_MAX_TAG_LENGTH = 80;

const sha256Pattern = /^[a-f0-9]{64}$/;

export function assertSha256Checksum(value: unknown) {
	if (typeof value !== "string" || !sha256Pattern.test(value)) {
		throw new MediaAssetError(
			"MEDIA_ASSET_CHECKSUM_INVALID",
			"MediaAsset checksum must be lowercase SHA-256 hex.",
		);
	}
	return value;
}

export function isSha256Checksum(value: unknown): value is string {
	return typeof value === "string" && sha256Pattern.test(value);
}

export function normalizeMediaTags(values: readonly string[]) {
	if (values.length > MEDIA_ASSET_MAX_TAGS) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"MediaAsset tags exceed the configured maximum.",
		);
	}

	const normalized = values.map((value) => value.trim());
	if (
		normalized.some(
			(value) =>
				value.length === 0 || value.length > MEDIA_ASSET_MAX_TAG_LENGTH,
		)
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"MediaAsset tags must be non-empty and within the length limit.",
		);
	}

	const seen = new Set<string>();
	for (const tag of normalized) {
		const key = tag.toLocaleLowerCase("vi-VN");
		if (seen.has(key)) {
			throw new MediaAssetError(
				"MEDIA_ASSET_INVALID_METADATA",
				"MediaAsset tags must be unique.",
			);
		}
		seen.add(key);
	}

	return normalized;
}

export function assertDisplayName(value: unknown) {
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		value.trim().length > MEDIA_ASSET_MAX_DISPLAY_NAME_LENGTH
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"MediaAsset display name is invalid.",
		);
	}
	return value.trim();
}

export function sanitizeOriginalFilename(value: unknown) {
	if (typeof value !== "string") {
		throw new MediaAssetError(
			"MEDIA_ASSET_FILENAME_INVALID",
			"Original filename is invalid.",
		);
	}

	const sanitized = [...value]
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint > 0x1f && codePoint !== 0x7f;
		})
		.join("")
		.replace(/[\\/]/g, "_")
		.trim();
	if (
		sanitized.length === 0 ||
		sanitized.length > MEDIA_ASSET_MAX_ORIGINAL_FILENAME_LENGTH
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_FILENAME_INVALID",
			"Original filename is empty or too long.",
		);
	}
	return sanitized;
}

export function assertReadyMetadata(input: {
	mediaType: string;
	mimeType: string | null;
	byteSize: number | null;
	checksumSha256: string | null;
	width: number | null;
	height: number | null;
	durationMs: number | null;
}) {
	if (!mediaAssetMediaTypes.includes(input.mediaType as never)) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_MEDIA",
			"MediaAsset media type is invalid.",
		);
	}
	if (
		!input.mimeType ||
		!Number.isSafeInteger(input.byteSize) ||
		(input.byteSize ?? 0) <= 0
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"READY MediaAsset requires a positive byte size and detected MIME.",
		);
	}
	if (!mediaAssetMimeTypes.includes(input.mimeType as never)) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_MEDIA",
			"READY MediaAsset MIME is not allow-listed.",
		);
	}
	const expectedMimeTypes =
		input.mediaType === "image"
			? mediaAssetMimeTypes.slice(0, 3)
			: input.mediaType === "video"
				? ["video/mp4"]
				: ["audio/mpeg"];
	if (!(expectedMimeTypes as readonly string[]).includes(input.mimeType)) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_MEDIA",
			"READY MediaAsset MIME does not match its media type.",
		);
	}
	assertSha256Checksum(input.checksumSha256);
	if (input.mediaType === "image") {
		if (
			input.width === null ||
			input.height === null ||
			!Number.isInteger(input.width) ||
			!Number.isInteger(input.height) ||
			input.width <= 0 ||
			input.height <= 0
		) {
			throw new MediaAssetError(
				"MEDIA_ASSET_INVALID_METADATA",
				"READY images require positive decoded dimensions.",
			);
		}
	}
	if (input.mediaType === "audio") {
		if (
			input.durationMs === null ||
			!Number.isInteger(input.durationMs) ||
			input.durationMs <= 0
		) {
			throw new MediaAssetError(
				"MEDIA_ASSET_INVALID_METADATA",
				"READY audio requires a positive decoded duration.",
			);
		}
	}
}

export function assertMediaAssetOrigin(value: string) {
	if (!mediaAssetOrigins.includes(value as never)) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"Invalid media origin.",
		);
	}
}

export function assertMediaAssetStorageProvider(value: string) {
	if (!mediaAssetStorageProviders.includes(value as never)) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"Invalid media storage provider.",
		);
	}
}
