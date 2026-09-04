import {
	MediaAssetError,
	type MediaAssetReadyMetadata,
	type MediaType,
} from "@affichannel/core";
import { parseBuffer } from "music-metadata";

import { sha256Bytes } from "./media-asset-checksum";

export type MediaAssetSizeLimits = Readonly<{
	image: number;
	video: number;
	audio: number;
}>;

export const DEFAULT_MEDIA_ASSET_SIZE_LIMITS: MediaAssetSizeLimits = {
	image: 10 * 1024 * 1024,
	video: 100 * 1024 * 1024,
	audio: 10 * 1024 * 1024,
};

const MIME_BY_TYPE: Record<MediaType, readonly string[]> = {
	image: ["image/jpeg", "image/png", "image/webp"],
	video: ["video/mp4"],
	audio: ["audio/mpeg"],
};

const IMAGE_EXTENSIONS: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
};

function ascii(bytes: Uint8Array, start: number, length: number) {
	return String.fromCharCode(...bytes.subarray(start, start + length));
}

function readUInt24LE(bytes: Uint8Array, offset: number) {
	return (
		(bytes[offset] ?? 0) |
		((bytes[offset + 1] ?? 0) << 8) |
		((bytes[offset + 2] ?? 0) << 16)
	);
}

function readUInt32LE(bytes: Uint8Array, offset: number) {
	return (
		((bytes[offset] ?? 0) |
			((bytes[offset + 1] ?? 0) << 8) |
			((bytes[offset + 2] ?? 0) << 16) |
			((bytes[offset + 3] ?? 0) << 24)) >>>
		0
	);
}

function readUInt16BE(bytes: Uint8Array, offset: number) {
	return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUInt16LE(bytes: Uint8Array, offset: number) {
	return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUInt32BE(bytes: Uint8Array, offset: number) {
	return (
		((((bytes[offset] ?? 0) << 24) >>> 0) |
			((bytes[offset + 1] ?? 0) << 16) |
			((bytes[offset + 2] ?? 0) << 8) |
			(bytes[offset + 3] ?? 0)) >>>
		0
	);
}

type DetectedMediaMetadata = Readonly<{
	mimeType: string;
	width: number | null;
	height: number | null;
	durationMs: number | null;
}>;

function invalidMedia(message: string, metadata?: Record<string, unknown>) {
	return new MediaAssetError("MEDIA_ASSET_INVALID_MEDIA", message, metadata);
}

function parseJpegDimensions(bytes: Uint8Array) {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
		throw invalidMedia("JPEG magic bytes are invalid.");
	}
	let offset = 2;
	while (offset < bytes.length) {
		while (bytes[offset] === 0xff) offset += 1;
		const marker = bytes[offset++];
		if (marker === undefined) break;
		if (marker === 0xd9 || marker === 0xda) break;
		if (marker >= 0xd0 && marker <= 0xd7) continue;
		if (offset + 2 > bytes.length)
			throw invalidMedia("JPEG segment is truncated.");
		const segmentLength = readUInt16BE(bytes, offset);
		if (segmentLength < 2 || offset + segmentLength > bytes.length) {
			throw invalidMedia("JPEG segment length is invalid.");
		}
		const isStartOfFrame =
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf);
		if (isStartOfFrame) {
			if (segmentLength < 7)
				throw invalidMedia("JPEG frame header is invalid.");
			const height = readUInt16BE(bytes, offset + 3);
			const width = readUInt16BE(bytes, offset + 5);
			if (width <= 0 || height <= 0)
				throw invalidMedia("JPEG dimensions are invalid.");
			return { width, height };
		}
		offset += segmentLength;
	}
	throw invalidMedia("JPEG dimensions could not be decoded.");
}

function parsePngDimensions(bytes: Uint8Array) {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (
		bytes.length < 33 ||
		!signature.every((value, index) => bytes[index] === value)
	) {
		throw invalidMedia("PNG magic bytes are invalid.");
	}
	if (readUInt32BE(bytes, 8) < 13 || ascii(bytes, 12, 4) !== "IHDR") {
		throw invalidMedia("PNG IHDR is invalid.");
	}
	const width = readUInt32BE(bytes, 16);
	const height = readUInt32BE(bytes, 20);
	if (
		width === 0 ||
		height === 0 ||
		width > 0x7fffffff ||
		height > 0x7fffffff
	) {
		throw invalidMedia("PNG dimensions are invalid.");
	}
	return { width, height };
}

function parseWebpDimensions(bytes: Uint8Array) {
	if (
		bytes.length < 16 ||
		ascii(bytes, 0, 4) !== "RIFF" ||
		ascii(bytes, 8, 4) !== "WEBP"
	) {
		throw invalidMedia("WebP magic bytes are invalid.");
	}
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const chunkType = ascii(bytes, offset, 4);
		const chunkSize = readUInt32LE(bytes, offset + 4);
		const payload = offset + 8;
		if (payload + chunkSize > bytes.length)
			throw invalidMedia("WebP chunk is truncated.");
		if (chunkType === "VP8X" && chunkSize >= 10) {
			const width = readUInt24LE(bytes, payload + 4) + 1;
			const height = readUInt24LE(bytes, payload + 7) + 1;
			return { width, height };
		}
		if (chunkType === "VP8L" && chunkSize >= 5 && bytes[payload] === 0x2f) {
			const width =
				1 +
				(((bytes[payload + 1] ?? 0) | ((bytes[payload + 2] ?? 0) << 8)) &
					0x3fff);
			const height =
				1 +
				((((bytes[payload + 2] ?? 0) >> 6) |
					((bytes[payload + 3] ?? 0) << 2) |
					((bytes[payload + 4] ?? 0) << 10)) &
					0x3fff);
			return { width, height };
		}
		if (chunkType === "VP8 ") {
			for (let index = payload; index + 8 < payload + chunkSize; index += 1) {
				if (
					bytes[index + 3] === 0x9d &&
					bytes[index + 4] === 0x01 &&
					bytes[index + 5] === 0x2a
				) {
					const width = readUInt16LE(bytes, index + 6) & 0x3fff;
					const height = readUInt16LE(bytes, index + 8) & 0x3fff;
					if (width > 0 && height > 0) return { width, height };
				}
			}
		}
		offset += 8 + chunkSize + (chunkSize % 2);
	}
	throw invalidMedia("WebP dimensions could not be decoded.");
}

function detectImage(bytes: Uint8Array): DetectedMediaMetadata {
	if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") {
		return {
			mimeType: "image/png",
			...parsePngDimensions(bytes),
			durationMs: null,
		};
	}
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		return {
			mimeType: "image/jpeg",
			...parseJpegDimensions(bytes),
			durationMs: null,
		};
	}
	if (
		bytes.length >= 12 &&
		ascii(bytes, 0, 4) === "RIFF" &&
		ascii(bytes, 8, 4) === "WEBP"
	) {
		return {
			mimeType: "image/webp",
			...parseWebpDimensions(bytes),
			durationMs: null,
		};
	}
	throw invalidMedia("Bytes are not a supported image format.");
}

function assertMp4(bytes: Uint8Array): DetectedMediaMetadata {
	if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") {
		throw invalidMedia("Bytes are not a supported MP4 container.");
	}
	return { mimeType: "video/mp4", width: null, height: null, durationMs: null };
}

async function parseMp3(bytes: Uint8Array): Promise<DetectedMediaMetadata> {
	try {
		const metadata = await parseBuffer(
			Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
			{ mimeType: "audio/mpeg", size: bytes.byteLength },
		);
		const durationSeconds = metadata.format.duration;
		if (
			!durationSeconds ||
			!Number.isFinite(durationSeconds) ||
			durationSeconds <= 0
		) {
			throw new Error("MP3 duration is missing.");
		}
		const durationMs = Math.round(durationSeconds * 1_000);
		if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
			throw new Error("MP3 duration is invalid.");
		return { mimeType: "audio/mpeg", width: null, height: null, durationMs };
	} catch {
		throw invalidMedia("Bytes are not a valid MP3 with a positive duration.");
	}
}

function assertFilenameExtension(filename: string, detectedMimeType: string) {
	const extension = filename.trim().toLowerCase().split(".").at(-1);
	if (!extension || extension === filename.trim().toLowerCase()) return;
	const declaredExtensionMime = IMAGE_EXTENSIONS[extension];
	if (declaredExtensionMime && declaredExtensionMime !== detectedMimeType) {
		throw invalidMedia(
			"Filename extension does not match detected media bytes.",
		);
	}
	if (extension === "svg" || extension === "wav") {
		throw invalidMedia("This media filename extension is not supported in v1.");
	}
}

export async function validateMediaAssetBytes(input: {
	mediaType: MediaType;
	bytes: Uint8Array;
	originalFilename: string;
	declaredMimeType: string | null;
	storedMimeType?: string | null;
	maxBytes?: number;
}): Promise<MediaAssetReadyMetadata & { detectedMediaType: MediaType }> {
	const maxBytes =
		input.maxBytes ?? DEFAULT_MEDIA_ASSET_SIZE_LIMITS[input.mediaType];
	if (input.bytes.byteLength <= 0 || input.bytes.byteLength > maxBytes) {
		throw new MediaAssetError(
			"MEDIA_ASSET_SIZE_LIMIT_EXCEEDED",
			"Media asset bytes exceed the configured limit.",
			{ byteSize: input.bytes.byteLength, maxBytes },
		);
	}

	const detected =
		input.mediaType === "image"
			? detectImage(input.bytes)
			: input.mediaType === "video"
				? assertMp4(input.bytes)
				: await parseMp3(input.bytes);
	if (!MIME_BY_TYPE[input.mediaType].includes(detected.mimeType)) {
		throw invalidMedia(
			"Detected MIME is not allowed for the requested media type.",
		);
	}
	if (input.declaredMimeType && input.declaredMimeType !== detected.mimeType) {
		throw invalidMedia("Declared MIME does not match detected media bytes.");
	}
	if (input.storedMimeType && input.storedMimeType !== detected.mimeType) {
		throw invalidMedia("Stored MIME does not match detected media bytes.");
	}
	assertFilenameExtension(input.originalFilename, detected.mimeType);

	return {
		detectedMediaType: input.mediaType,
		mimeType: detected.mimeType,
		byteSize: input.bytes.byteLength,
		checksumSha256: sha256Bytes(input.bytes),
		width: detected.width,
		height: detected.height,
		durationMs: detected.durationMs,
	};
}
