import { MediaAssetError } from "@affichannel/core";
import { env } from "@affichannel/env/server";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
	LocalMediaAssetStorage,
	type MediaAssetStorage,
	type R2MediaAssetObjectClient,
	R2MediaAssetStorage,
} from "./media-asset-storage";

export type MediaR2StorageConfig = {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
};

function requireR2Config(): MediaR2StorageConfig {
	const config = {
		endpoint: env.MEDIA_R2_ENDPOINT,
		bucket: env.MEDIA_R2_BUCKET,
		accessKeyId: env.MEDIA_R2_ACCESS_KEY_ID,
		secretAccessKey: env.MEDIA_R2_SECRET_ACCESS_KEY,
	};
	if (Object.values(config).some((value) => !value)) {
		throw new MediaAssetError(
			"MEDIA_ASSET_CONFIGURATION_INVALID",
			"Media R2 storage is not configured on the server.",
		);
	}
	return config as MediaR2StorageConfig;
}

export function createR2MediaAssetStorage(config: MediaR2StorageConfig) {
	const client = new S3Client({
		region: "auto",
		endpoint: config.endpoint,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
	});
	// The AWS client and presigner currently resolve slightly different private
	// smithy type copies in the workspace lockfile. Runtime compatibility is the
	// documented SDK contract; keep the cast at this adapter boundary only.
	const presignClient = client as unknown as Parameters<typeof getSignedUrl>[0];
	const objectClient: R2MediaAssetObjectClient = {
		async putObject(input) {
			await client.send(
				new PutObjectCommand({
					Bucket: config.bucket,
					Key: input.key,
					Body: Buffer.from(input.body),
					ContentType: input.contentType,
					Metadata: { sha256: input.checksumSha256 },
				}),
			);
		},
		async getObject(key) {
			const response = await client.send(
				new GetObjectCommand({ Bucket: config.bucket, Key: key }),
			);
			if (!response.Body) return null;
			return new Uint8Array(await response.Body.transformToByteArray());
		},
		async headObject(key) {
			try {
				const response = await client.send(
					new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
				);
				return {
					byteSize: response.ContentLength ?? 0,
					contentType: response.ContentType ?? null,
					etag: response.ETag ?? null,
				};
			} catch (error) {
				if ((error as { name?: string }).name === "NotFound") return null;
				throw error;
			}
		},
		async deleteObject(key) {
			await client.send(
				new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
			);
		},
		async createPresignedUploadUrl(input) {
			return getSignedUrl(
				presignClient,
				new PutObjectCommand({
					Bucket: config.bucket,
					Key: input.key,
					ContentType: input.contentType,
				}),
				{
					expiresIn: Math.max(
						1,
						Math.ceil((input.expiresAt.getTime() - Date.now()) / 1_000),
					),
				},
			);
		},
		async createPresignedDownloadUrl(input) {
			return getSignedUrl(
				presignClient,
				new GetObjectCommand({
					Bucket: config.bucket,
					Key: input.key,
					ResponseContentType: input.contentType,
				}),
				{
					expiresIn: Math.max(
						1,
						Math.ceil((input.expiresAt.getTime() - Date.now()) / 1_000),
					),
				},
			);
		},
	};
	return new R2MediaAssetStorage(objectClient);
}

export function createMediaAssetStorage(
	provider: "local" | "r2" = env.MEDIA_STORAGE_PROVIDER,
): MediaAssetStorage {
	if (provider === "local") {
		return new LocalMediaAssetStorage({ rootDir: env.MEDIA_LOCAL_ROOT });
	}
	if (provider === "r2") return createR2MediaAssetStorage(requireR2Config());
	throw new MediaAssetError(
		"MEDIA_ASSET_CONFIGURATION_INVALID",
		"Media asset storage provider is not supported.",
	);
}
