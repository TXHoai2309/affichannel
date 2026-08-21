import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
	assertSafeVoiceAudioStorageKey,
	createVoiceAudioStorageKey,
	VoiceSegmentError,
} from "@affichannel/core";

import { sha256Bytes } from "../services/voice-segment-hashing";

export type VoiceAudioStorageProvider = "local" | "r2";

export type VoiceAudioPutInput = {
	storageKey: string;
	body: Uint8Array;
	contentType: "audio/mpeg";
	checksum: string;
};

export type VoiceAudioPutResult = {
	byteSize: number;
	checksum: string;
};

export interface VoiceAudioStorage {
	readonly provider: VoiceAudioStorageProvider;
	put(input: VoiceAudioPutInput): Promise<VoiceAudioPutResult>;
	get(storageKey: string): Promise<Uint8Array>;
	open(storageKey: string): Promise<ReadableStream<Uint8Array>>;
	delete(storageKey: string): Promise<void>;
}

function assertAudioPut(input: VoiceAudioPutInput) {
	assertSafeVoiceAudioStorageKey(input.storageKey);
	if (input.contentType !== "audio/mpeg" || input.body.byteLength === 0) {
		throw new VoiceSegmentError(
			"TTS_STORAGE_FAILED",
			"Only non-empty audio/mpeg bytes can be stored.",
		);
	}
	const actualChecksum = sha256Bytes(input.body);
	if (actualChecksum !== input.checksum) {
		throw new VoiceSegmentError(
			"TTS_STORAGE_FAILED",
			"Audio checksum does not match the bytes being stored.",
		);
	}
	return actualChecksum;
}

function bytesToStream(bytes: Uint8Array) {
	return Readable.toWeb(
		Readable.from([Buffer.from(bytes)]),
	) as unknown as ReadableStream<Uint8Array>;
}

function storageFailure(message: string, cause?: unknown): VoiceSegmentError {
	return new VoiceSegmentError("TTS_STORAGE_FAILED", message, {
		cause: cause instanceof Error ? cause.name : undefined,
	});
}

export function createDefaultVoiceAudioStorageKey(input: {
	workspaceId: string;
	projectId: string;
	artifactId: string;
}) {
	return createVoiceAudioStorageKey(input);
}

export class LocalVoiceAudioStorage implements VoiceAudioStorage {
	readonly provider = "local" as const;
	private readonly rootDir: string;

	constructor(options: { rootDir: string }) {
		this.rootDir = resolve(options.rootDir);
	}

	private pathFor(storageKey: string) {
		assertSafeVoiceAudioStorageKey(storageKey);
		const candidate = resolve(this.rootDir, ...storageKey.split("/"));
		if (
			candidate !== this.rootDir &&
			!candidate.startsWith(`${this.rootDir}${sep}`)
		) {
			throw new VoiceSegmentError(
				"VOICE_SEGMENT_STORAGE_KEY_INVALID",
				"Voice audio path escapes the configured local storage root.",
			);
		}
		return candidate;
	}

	async put(input: VoiceAudioPutInput) {
		const checksum = assertAudioPut(input);
		const targetPath = this.pathFor(input.storageKey);
		const tempPath = `${targetPath}.${randomUUID()}.tmp`;
		try {
			await mkdir(resolve(targetPath, ".."), { recursive: true });
			await writeFile(tempPath, input.body, { flag: "wx" });
			await rename(tempPath, targetPath);
			return { byteSize: input.body.byteLength, checksum };
		} catch (error) {
			await rm(tempPath, { force: true }).catch(() => undefined);
			if (error instanceof VoiceSegmentError) throw error;
			throw storageFailure("Could not persist local voice audio.", error);
		}
	}

	async get(storageKey: string) {
		try {
			return new Uint8Array(await readFile(this.pathFor(storageKey)));
		} catch (error) {
			throw storageFailure("Could not read local voice audio.", error);
		}
	}

	async open(storageKey: string) {
		try {
			return Readable.toWeb(
				createReadStream(this.pathFor(storageKey)),
			) as unknown as ReadableStream<Uint8Array>;
		} catch (error) {
			throw storageFailure("Could not open local voice audio.", error);
		}
	}

	async delete(storageKey: string) {
		try {
			await rm(this.pathFor(storageKey), { force: true });
		} catch (error) {
			throw storageFailure("Could not delete local voice audio.", error);
		}
	}
}

export type R2VoiceAudioObjectClient = {
	putObject(input: {
		key: string;
		body: Uint8Array;
		contentType: "audio/mpeg";
		checksum: string;
	}): Promise<void>;
	getObject(key: string): Promise<Uint8Array | null>;
	deleteObject(key: string): Promise<void>;
};

/**
 * R2 foundation adapter. The S3-compatible client is injected so Phase 1 tests
 * cannot reach the network and Phase 2 can choose/configure the official client.
 */
export class R2VoiceAudioStorage implements VoiceAudioStorage {
	readonly provider = "r2" as const;

	constructor(private readonly client: R2VoiceAudioObjectClient) {}

	async put(input: VoiceAudioPutInput) {
		const checksum = assertAudioPut(input);
		try {
			await this.client.putObject({
				key: input.storageKey,
				body: input.body,
				contentType: input.contentType,
				checksum,
			});
			return { byteSize: input.body.byteLength, checksum };
		} catch (error) {
			throw storageFailure("Could not persist voice audio to R2.", error);
		}
	}

	async get(storageKey: string) {
		assertSafeVoiceAudioStorageKey(storageKey);
		try {
			const body = await this.client.getObject(storageKey);
			if (!body) throw new Error("R2 object was not found.");
			return body;
		} catch (error) {
			throw storageFailure("Could not read voice audio from R2.", error);
		}
	}

	async open(storageKey: string) {
		return bytesToStream(await this.get(storageKey));
	}

	async delete(storageKey: string) {
		assertSafeVoiceAudioStorageKey(storageKey);
		try {
			await this.client.deleteObject(storageKey);
		} catch (error) {
			throw storageFailure("Could not delete voice audio from R2.", error);
		}
	}
}
