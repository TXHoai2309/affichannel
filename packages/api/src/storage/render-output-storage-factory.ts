import { Readable } from "node:stream";
import { env } from "@affichannel/env/server";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { isObjectNotFoundError } from "./object-storage-errors";
import {
	LocalRenderOutputStorage,
	type R2RenderOutputObjectClient,
	R2RenderOutputStorage,
	type RenderOutputStorage,
	RenderOutputStorageError,
} from "./render-output-storage";

export type RenderOutputR2StorageConfig = {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
};

function requireR2Config(): RenderOutputR2StorageConfig {
	const config = {
		endpoint: env.RENDER_OUTPUT_R2_ENDPOINT,
		bucket: env.RENDER_OUTPUT_R2_BUCKET,
		accessKeyId: env.RENDER_OUTPUT_R2_ACCESS_KEY_ID,
		secretAccessKey: env.RENDER_OUTPUT_R2_SECRET_ACCESS_KEY,
	};
	if (Object.values(config).some((value) => !value)) {
		throw new RenderOutputStorageError(
			"RENDER_OUTPUT_STORAGE_CONDITIONAL_CREATE_UNSUPPORTED",
			"Render output R2 storage is not fully configured.",
		);
	}
	return config as RenderOutputR2StorageConfig;
}

function responseStream(body: unknown) {
	if (!body) throw new Error("R2_RENDER_OUTPUT_BODY_MISSING");
	return Readable.toWeb(
		body as Parameters<typeof Readable.toWeb>[0],
	) as unknown as ReadableStream<Uint8Array>;
}

export function createR2RenderOutputStorage(
	config: RenderOutputR2StorageConfig,
) {
	const client = new S3Client({
		region: "auto",
		endpoint: config.endpoint,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
	});
	const objectClient: R2RenderOutputObjectClient = {
		async putObject(input) {
			await client.send(
				new PutObjectCommand({
					Bucket: config.bucket,
					Key: input.key,
					Body: Readable.from(input.body),
					ContentLength: input.byteSize,
					ContentType: input.contentType,
					Metadata: { sha256: input.checksumSha256 },
					IfNoneMatch: "*",
				}),
			);
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
					checksumSha256: response.Metadata?.sha256 ?? null,
				};
			} catch (error) {
				if (isObjectNotFoundError(error)) return null;
				throw error;
			}
		},
		async getObject(key, range) {
			try {
				const response = await client.send(
					new GetObjectCommand({
						Bucket: config.bucket,
						Key: key,
						...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
					}),
				);
				if (!response.Body) return null;
				return {
					stream: responseStream(response.Body),
					byteSize: response.ContentLength ?? 0,
					contentType: "video/mp4" as const,
				};
			} catch (error) {
				if (isObjectNotFoundError(error)) return null;
				throw error;
			}
		},
		async deleteObject(key) {
			await client.send(
				new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
			);
		},
	};
	return new R2RenderOutputStorage(objectClient, {
		tempRoot: env.RENDER_OUTPUT_LOCAL_ROOT,
	});
}

export function createRenderOutputStorage(
	provider: "local" | "r2" = env.RENDER_OUTPUT_STORAGE_PROVIDER,
): RenderOutputStorage {
	if (provider === "local")
		return new LocalRenderOutputStorage({
			rootDir: env.RENDER_OUTPUT_LOCAL_ROOT,
		});
	if (provider === "r2") return createR2RenderOutputStorage(requireR2Config());
	throw new RenderOutputStorageError(
		"RENDER_OUTPUT_STORAGE_CONDITIONAL_CREATE_UNSUPPORTED",
		"Render output storage provider is not supported.",
	);
}
