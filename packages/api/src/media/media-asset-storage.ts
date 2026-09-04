import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
	assertSafeMediaAssetStorageKey,
	MediaAssetError,
	type MediaAssetStorageProvider,
} from "@affichannel/core";

import { sha256Bytes } from "./media-asset-checksum";

export type MediaAssetStorageGrant = Readonly<{
	urlOrToken: string;
	expiresAt: Date;
}>;

export type MediaAssetStorageObjectStat = Readonly<{
	byteSize: number;
	contentType: string | null;
	etag: string | null;
}>;

export type MediaAssetPutInput = Readonly<{
	storageKey: string;
	body: Uint8Array;
	contentType: string;
	checksumSha256: string;
}>;

export interface MediaAssetStorage {
	readonly provider: MediaAssetStorageProvider;
	createUploadGrant(input: {
		storageKey: string;
		contentType: string;
		byteSize: number;
		expiresAt: Date;
	}): Promise<MediaAssetStorageGrant>;
	put(input: MediaAssetPutInput): Promise<{
		byteSize: number;
		checksumSha256: string;
	}>;
	head(storageKey: string): Promise<MediaAssetStorageObjectStat | null>;
	get(storageKey: string): Promise<Uint8Array>;
	open(storageKey: string): Promise<ReadableStream<Uint8Array>>;
	createDownloadGrant(input: {
		storageKey: string;
		contentType: string;
		expiresAt: Date;
	}): Promise<MediaAssetStorageGrant>;
	delete(storageKey: string): Promise<void>;
	cleanup(storageKey: string): Promise<void>;
}

const supportedMimeTypes = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"video/mp4",
	"audio/mpeg",
] as const;

function assertPutInput(input: MediaAssetPutInput) {
	assertSafeMediaAssetStorageKey(input.storageKey);
	if (
		!supportedMimeTypes.includes(
			input.contentType as (typeof supportedMimeTypes)[number],
		) ||
		input.body.byteLength <= 0
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_MEDIA",
			"Only non-empty allow-listed media bytes can be stored.",
		);
	}
	const checksumSha256 = sha256Bytes(input.body);
	if (checksumSha256 !== input.checksumSha256) {
		throw new MediaAssetError(
			"MEDIA_ASSET_CHECKSUM_INVALID",
			"MediaAsset checksum does not match the bytes being stored.",
		);
	}
	return checksumSha256;
}

function assertGrantInput(input: {
	storageKey: string;
	contentType: string;
	byteSize?: number;
	expiresAt: Date;
}) {
	assertSafeMediaAssetStorageKey(input.storageKey);
	if (
		!supportedMimeTypes.includes(
			input.contentType as (typeof supportedMimeTypes)[number],
		) ||
		(input.byteSize !== undefined && input.byteSize <= 0) ||
		!Number.isFinite(input.expiresAt.getTime()) ||
		input.expiresAt.getTime() <= Date.now()
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"Media asset storage grant parameters are invalid.",
		);
	}
}

function storageFailure(message: string, cause?: unknown): MediaAssetError {
	return new MediaAssetError("MEDIA_ASSET_STORAGE_ERROR", message, {
		cause: cause instanceof Error ? cause.name : undefined,
	});
}

function storageNotFound(message: string): MediaAssetError {
	return new MediaAssetError("MEDIA_ASSET_STORAGE_NOT_FOUND", message);
}

function bytesToStream(bytes: Uint8Array) {
	return Readable.toWeb(
		Readable.from([Buffer.from(bytes)]),
	) as unknown as ReadableStream<Uint8Array>;
}

export class LocalMediaAssetStorage implements MediaAssetStorage {
	readonly provider = "local" as const;
	private readonly rootDir: string;

	constructor(options: { rootDir: string }) {
		this.rootDir = resolve(options.rootDir);
	}

	private pathFor(storageKey: string) {
		assertSafeMediaAssetStorageKey(storageKey);
		const candidate = resolve(this.rootDir, ...storageKey.split("/"));
		if (
			candidate !== this.rootDir &&
			!candidate.startsWith(`${this.rootDir}${sep}`)
		) {
			throw new MediaAssetError(
				"MEDIA_ASSET_STORAGE_KEY_INVALID",
				"Media storage path escapes the configured local root.",
			);
		}
		return candidate;
	}

	async createUploadGrant(input: {
		storageKey: string;
		contentType: string;
		byteSize: number;
		expiresAt: Date;
	}) {
		assertGrantInput(input);
		return {
			urlOrToken: `local-upload-${randomUUID()}`,
			expiresAt: input.expiresAt,
		};
	}

	async put(input: MediaAssetPutInput) {
		const checksumSha256 = assertPutInput(input);
		const targetPath = this.pathFor(input.storageKey);
		const tempPath = `${targetPath}.${randomUUID()}.tmp`;
		try {
			await mkdir(dirname(targetPath), { recursive: true });
			await writeFile(tempPath, input.body, { flag: "wx" });
			try {
				await writeFile(targetPath, input.body, { flag: "wx" });
				await rm(tempPath, { force: true });
			} catch (error) {
				await rm(tempPath, { force: true }).catch(() => undefined);
				throw error;
			}
			return { byteSize: input.body.byteLength, checksumSha256 };
		} catch (error) {
			await rm(tempPath, { force: true }).catch(() => undefined);
			if (error instanceof MediaAssetError) throw error;
			throw storageFailure("Could not persist local media asset.", error);
		}
	}

	async head(storageKey: string) {
		try {
			const result = await stat(this.pathFor(storageKey));
			return {
				byteSize: result.size,
				contentType: null,
				etag: null,
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			if (error instanceof MediaAssetError) throw error;
			throw storageFailure("Could not stat local media asset.", error);
		}
	}

	async get(storageKey: string) {
		try {
			return new Uint8Array(await readFile(this.pathFor(storageKey)));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw storageNotFound("Local media asset was not found.");
			}
			if (error instanceof MediaAssetError) throw error;
			throw storageFailure("Could not read local media asset.", error);
		}
	}

	async open(storageKey: string) {
		try {
			const path = this.pathFor(storageKey);
			await stat(path);
			return Readable.toWeb(
				createReadStream(path),
			) as unknown as ReadableStream<Uint8Array>;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw storageNotFound("Local media asset was not found.");
			}
			if (error instanceof MediaAssetError) throw error;
			throw storageFailure("Could not open local media asset.", error);
		}
	}

	async createDownloadGrant(input: {
		storageKey: string;
		contentType: string;
		expiresAt: Date;
	}) {
		assertGrantInput(input);
		return {
			urlOrToken: `local-download-${randomUUID()}`,
			expiresAt: input.expiresAt,
		};
	}

	async delete(storageKey: string) {
		try {
			await rm(this.pathFor(storageKey));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw storageNotFound("Local media asset was not found.");
			}
			if (error instanceof MediaAssetError) throw error;
			throw storageFailure("Could not delete local media asset.", error);
		}
	}

	async cleanup(storageKey: string) {
		try {
			await this.delete(storageKey);
		} catch (error) {
			if (
				error instanceof MediaAssetError &&
				error.code === "MEDIA_ASSET_STORAGE_NOT_FOUND"
			) {
				return;
			}
			throw error;
		}
	}
}

export type R2MediaAssetObjectClient = {
	putObject(input: {
		key: string;
		body: Uint8Array;
		contentType: string;
		checksumSha256: string;
	}): Promise<void>;
	getObject(key: string): Promise<Uint8Array | null>;
	headObject(key: string): Promise<MediaAssetStorageObjectStat | null>;
	deleteObject(key: string): Promise<void>;
	createPresignedUploadUrl?(input: {
		key: string;
		contentType: string;
		expiresAt: Date;
	}): Promise<string>;
	createPresignedDownloadUrl?(input: {
		key: string;
		contentType: string;
		expiresAt: Date;
	}): Promise<string>;
};

export class R2MediaAssetStorage implements MediaAssetStorage {
	readonly provider = "r2" as const;

	constructor(private readonly client: R2MediaAssetObjectClient) {}

	async createUploadGrant(input: {
		storageKey: string;
		contentType: string;
		byteSize: number;
		expiresAt: Date;
	}) {
		assertGrantInput(input);
		if (!this.client.createPresignedUploadUrl) {
			throw storageFailure("R2 upload grants are not configured.");
		}
		return {
			urlOrToken: await this.client.createPresignedUploadUrl({
				key: input.storageKey,
				contentType: input.contentType,
				expiresAt: input.expiresAt,
			}),
			expiresAt: input.expiresAt,
		};
	}

	async put(input: MediaAssetPutInput) {
		const checksumSha256 = assertPutInput(input);
		try {
			await this.client.putObject({
				key: input.storageKey,
				body: input.body,
				contentType: input.contentType,
				checksumSha256,
			});
			return { byteSize: input.body.byteLength, checksumSha256 };
		} catch (error) {
			throw storageFailure("Could not persist media asset to R2.", error);
		}
	}

	async head(storageKey: string) {
		assertSafeMediaAssetStorageKey(storageKey);
		try {
			return await this.client.headObject(storageKey);
		} catch (error) {
			throw storageFailure("Could not stat media asset in R2.", error);
		}
	}

	async get(storageKey: string) {
		assertSafeMediaAssetStorageKey(storageKey);
		try {
			const body = await this.client.getObject(storageKey);
			if (!body) throw storageNotFound("R2 media asset was not found.");
			return body;
		} catch (error) {
			if (error instanceof MediaAssetError) throw error;
			throw storageFailure("Could not read media asset from R2.", error);
		}
	}

	async open(storageKey: string) {
		return bytesToStream(await this.get(storageKey));
	}

	async createDownloadGrant(input: {
		storageKey: string;
		contentType: string;
		expiresAt: Date;
	}) {
		assertGrantInput(input);
		if (!this.client.createPresignedDownloadUrl) {
			throw storageFailure("R2 download grants are not configured.");
		}
		return {
			urlOrToken: await this.client.createPresignedDownloadUrl({
				key: input.storageKey,
				contentType: input.contentType,
				expiresAt: input.expiresAt,
			}),
			expiresAt: input.expiresAt,
		};
	}

	async delete(storageKey: string) {
		assertSafeMediaAssetStorageKey(storageKey);
		try {
			await this.client.deleteObject(storageKey);
		} catch (error) {
			throw storageFailure("Could not delete media asset from R2.", error);
		}
	}

	async cleanup(storageKey: string) {
		await this.delete(storageKey);
	}
}
