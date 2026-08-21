import { VoiceSegmentError } from "@affichannel/core";
import { env } from "@affichannel/env/server";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

import {
	LocalVoiceAudioStorage,
	type R2VoiceAudioObjectClient,
	R2VoiceAudioStorage,
	type VoiceAudioStorage,
} from "./voice-audio-storage";

export type R2VoiceAudioStorageConfig = {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
};

function requireR2Config(): R2VoiceAudioStorageConfig {
	const config = {
		endpoint: env.R2_ENDPOINT,
		bucket: env.R2_BUCKET,
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
	};
	if (Object.values(config).some((value) => !value)) {
		throw new VoiceSegmentError(
			"TTS_STORAGE_CONFIGURATION_INVALID",
			"R2 storage chưa được cấu hình đầy đủ trên server.",
		);
	}
	return config as R2VoiceAudioStorageConfig;
}

export function createR2VoiceAudioStorage(config: R2VoiceAudioStorageConfig) {
	const client = new S3Client({
		region: "auto",
		endpoint: config.endpoint,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
	});
	const objectClient: R2VoiceAudioObjectClient = {
		async putObject(input) {
			await client.send(
				new PutObjectCommand({
					Bucket: config.bucket,
					Key: input.key,
					Body: Buffer.from(input.body),
					ContentType: input.contentType,
					Metadata: { sha256: input.checksum },
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
		async deleteObject(key) {
			await client.send(
				new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
			);
		},
	};
	return new R2VoiceAudioStorage(objectClient);
}

export function createVoiceAudioStorage(): VoiceAudioStorage {
	if (env.VOICE_AUDIO_STORAGE_PROVIDER === "local") {
		return new LocalVoiceAudioStorage({ rootDir: env.VOICE_AUDIO_LOCAL_ROOT });
	}
	return createR2VoiceAudioStorage(requireR2Config());
}
