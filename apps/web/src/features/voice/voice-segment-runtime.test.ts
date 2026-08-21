import { TtsProviderError } from "@affichannel/api/providers/tts/tts-provider";
import { hashVoiceSegmentRequest } from "@affichannel/api/services/voice-segment-hashing";

import {
	generateVoiceSegment,
	type PreparedVoiceSegmentRequest,
	type VoiceSegmentRepositoryDependencies,
} from "@affichannel/api/services/voice-segment-runtime-service";
import {
	deriveVoiceSegmentReadModel,
	type VoiceSegmentArtifact,
	VoiceSegmentError,
	type VoiceSegmentFingerprint,
} from "@affichannel/core";
import { describe, expect, it, vi } from "vitest";

const actor = { workspaceId: "workspace-1", userId: "user-1" };

function mp3Fixture() {
	const frame = Uint8Array.from({ length: 417 }, (_, index) =>
		index === 0
			? 0xff
			: index === 1
				? 0xfb
				: index === 2
					? 0x90
					: index === 3
						? 0x64
						: 0,
	);
	const audio = new Uint8Array(frame.byteLength * 40);
	for (let index = 0; index < 40; index += 1) {
		audio.set(frame, index * frame.byteLength);
	}
	return audio;
}

const baseFingerprint: VoiceSegmentFingerprint = {
	workspaceId: actor.workspaceId,
	projectId: "project-1",
	sourceScriptVersionId: "script-1",
	sourceScriptRevision: 5,
	segmentKey: "intro",
	textHash: "a".repeat(64),
	voiceConfigRevision: 1,
	provider: "apikeyfun",
	voiceId: "eve",
	language: "vi",
	speed: 1,
};

const prepared: PreparedVoiceSegmentRequest = {
	projectId: "project-1",
	segmentKey: "intro",
	text: "Xin chào AffiChannel, giá 150.000 ₫ — 🎙️",
	fingerprint: baseFingerprint,
};

function pendingArtifact(input: {
	id: string;
	idempotencyKey: string;
	requestHash: string;
	createdAt?: Date;
}): VoiceSegmentArtifact {
	return {
		...baseFingerprint,
		id: input.id,
		createdByUserId: actor.userId,
		segmentTextSnapshot: prepared.text,
		idempotencyKey: input.idempotencyKey,
		requestHash: input.requestHash,
		status: "pending",
		providerRequestId: null,
		errorCode: null,
		storageProvider: null,
		storageKey: null,
		mimeType: null,
		byteSize: null,
		checksum: null,
		durationMs: null,
		createdAt: input.createdAt ?? new Date("2026-08-21T00:00:00.000Z"),
		finishedAt: null,
	};
}

function harness(
	options: {
		providerResult?: {
			audio: Uint8Array;
			contentType: "audio/mpeg";
			providerRequestId: string | null;
			providerDurationMs?: number | null;
		};
		providerError?: unknown;
		storagePutError?: unknown;
		completeError?: unknown;
		deleteError?: unknown;
	} = {},
) {
	const rows: VoiceSegmentArtifact[] = [];
	const audio = options.providerResult?.audio ?? mp3Fixture();
	const generate = vi.fn(
		async (_input: {
			text: string;
			voiceId: string;
			language: string;
			speed: number;
		}) => {
			if (options.providerError) throw options.providerError;
			return (
				options.providerResult ?? {
					audio,
					contentType: "audio/mpeg" as const,
					providerRequestId: "provider-1",
					providerDurationMs: 999,
				}
			);
		},
	);
	const put = vi.fn(async () => {
		if (options.storagePutError) throw options.storagePutError;
		return { byteSize: audio.byteLength, checksum: "b".repeat(64) };
	});
	const remove = vi.fn(async () => {
		if (options.deleteError) throw options.deleteError;
	});
	const provider = {
		providerId: "apikeyfun",
		listVoices: () => [],
		preview: async () => ({
			audio,
			contentType: "audio/mpeg" as const,
			providerRequestId: null,
			latencyMs: 1,
		}),
		generateSegment: generate,
	};
	const storage = {
		provider: "local" as const,
		put,
		get: async () => audio,
		open: async () => new ReadableStream<Uint8Array>(),
		delete: remove,
	};

	const repository: VoiceSegmentRepositoryDependencies = {
		findByIdempotencyKey: async (_actor, idempotencyKey) =>
			rows.find((row) => row.idempotencyKey === idempotencyKey),
		findPendingByRequestHash: async (_actor, projectId, requestHash) =>
			rows.find(
				(row) =>
					row.projectId === projectId &&
					row.requestHash === requestHash &&
					row.status === "pending",
			),
		findByRequestHash: async (_actor, projectId, requestHash) =>
			rows.find(
				(row) => row.projectId === projectId && row.requestHash === requestHash,
			),
		insertPendingAtomic: async ({ insert }) => {
			const row = pendingArtifact({
				id: insert.id,
				idempotencyKey: insert.idempotencyKey,
				requestHash: insert.requestHash,
			});
			rows.push(row);
			return row;
		},
		complete: async (input) => {
			if (options.completeError) throw options.completeError;
			const row = rows.find((candidate) => candidate.id === input.artifactId);
			if (row?.status !== "pending") return undefined;
			Object.assign(row, {
				status: "completed",
				providerRequestId: input.providerRequestId,
				storageProvider: input.storageProvider,
				storageKey: input.storageKey,
				mimeType: input.mimeType,
				byteSize: input.byteSize,
				checksum: input.checksum,
				durationMs: input.durationMs,
				finishedAt: new Date(),
			});
			return row;
		},
		fail: async (input) => {
			const row = rows.find((candidate) => candidate.id === input.artifactId);
			if (row?.status !== "pending") return undefined;
			Object.assign(row, {
				status: input.status,
				errorCode: input.errorCode,
				providerRequestId: input.providerRequestId ?? null,
				finishedAt: new Date(),
			});
			return row;
		},
		getReadModel: async (_actor, projectId, segmentKey, fingerprint) =>
			deriveVoiceSegmentReadModel(
				rows.filter(
					(row) => row.projectId === projectId && row.segmentKey === segmentKey,
				),
				fingerprint,
			),
		list: async (_actor, projectId) =>
			rows.filter((row) => row.projectId === projectId),
		reconcileExpired: async (_actor, now = new Date()) => {
			for (const row of rows) {
				if (
					row.status === "pending" &&
					now.getTime() - row.createdAt.getTime() >= 5 * 60_000
				) {
					row.status = "indeterminate";
					row.errorCode = "TTS_REQUEST_STATE_UNCERTAIN";
					row.finishedAt = now;
				}
			}
			return [];
		},
	};

	return {
		rows,
		generate,
		put,
		remove,
		provider,
		storage,
		repository,
		dependencies: {
			provider,
			storage,
			prepare: async () => prepared,
			readCurrent: async () => prepared,
			repository,
			now: () => new Date("2026-08-21T00:10:00.000Z"),
		},
	};
}

describe("voice segment runtime", () => {
	it("uses server-owned exact text/config, stores parsed duration, and ignores advisory provider duration", async () => {
		const h = harness();
		const result = await generateVoiceSegment(
			actor,
			{
				projectId: prepared.projectId,
				segmentKey: prepared.segmentKey,
				idempotencyKey: "idem-valid-1",
				text: "client override",
				voiceId: "ara",
				speed: 1.5,
			} as never,
			h.dependencies,
		);

		expect(h.generate).toHaveBeenCalledTimes(1);
		expect(h.generate.mock.calls[0]?.[0]).toEqual({
			text: prepared.text,
			voiceId: "eve",
			language: "vi",
			speed: 1,
		});
		expect(result.artifact.status).toBe("completed");
		expect(result.artifact.durationMs).toBe(1_045);
		expect(result.artifact.providerRequestId).toBe("provider-1");
		expect(result.readModel.effectiveStatus).toBe("completed");
	});

	it("coalesces same idempotency and rejects the same key with a different hash", async () => {
		const h = harness();
		await generateVoiceSegment(
			actor,
			{
				projectId: prepared.projectId,
				segmentKey: prepared.segmentKey,
				idempotencyKey: "idem-same-1",
			},
			h.dependencies,
		);
		await generateVoiceSegment(
			actor,
			{
				projectId: prepared.projectId,
				segmentKey: prepared.segmentKey,
				idempotencyKey: "idem-same-1",
			},
			h.dependencies,
		);
		expect(h.generate).toHaveBeenCalledTimes(1);

		const changed: PreparedVoiceSegmentRequest = {
			...prepared,
			text: "Nội dung mới",
			fingerprint: { ...prepared.fingerprint, textHash: "c".repeat(64) },
		};
		await expect(
			generateVoiceSegment(
				actor,
				{
					projectId: prepared.projectId,
					segmentKey: prepared.segmentKey,
					idempotencyKey: "idem-same-1",
				},
				{
					...h.dependencies,
					prepare: async () => changed,
					readCurrent: async () => changed,
				},
			),
		).rejects.toMatchObject({ code: "VOICE_SEGMENT_IDEMPOTENCY_CONFLICT" });
		expect(h.generate).toHaveBeenCalledTimes(1);
	});

	it("handles the partial unique insert race with one provider call", async () => {
		const h = harness();
		let insertCalls = 0;
		let release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered!: () => void;
		const bothEntered = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const insert = async ({
			insert,
		}: Parameters<typeof h.repository.insertPendingAtomic>[0]) => {
			insertCalls += 1;
			if (insertCalls === 2) entered();
			await barrier;
			if (insertCalls > 1 && h.rows.length > 0) {
				throw {
					code: "23505",
					constraint: "voice_segment_artifact_pending_request_unique",
				};
			}
			const row = pendingArtifact({
				id: insert.id,
				idempotencyKey: insert.idempotencyKey,
				requestHash: insert.requestHash,
			});
			h.rows.push(row);
			return row;
		};
		const dependencies = {
			...h.dependencies,
			repository: { ...h.repository, insertPendingAtomic: insert },
		};
		const first = generateVoiceSegment(
			actor,
			{
				projectId: "project-1",
				segmentKey: "intro",
				idempotencyKey: "idem-race-1",
			},
			dependencies,
		);
		const second = generateVoiceSegment(
			actor,
			{
				projectId: "project-1",
				segmentKey: "intro",
				idempotencyKey: "idem-race-2",
			},
			dependencies,
		);
		await bothEntered;
		release();
		await Promise.all([first, second]);
		expect(h.generate).toHaveBeenCalledTimes(1);
	});

	it("marks timeout uncertainty and invalid MP3 as non-retryable artifact states", async () => {
		const timeout = harness({
			providerError: new TtsProviderError("TTS_TIMEOUT_UNCERTAIN", "timeout", {
				uncertain: true,
				providerRequestId: "req-timeout",
			}),
		});
		await expect(
			generateVoiceSegment(
				actor,
				{
					projectId: "project-1",
					segmentKey: "intro",
					idempotencyKey: "idem-timeout-1",
				},
				timeout.dependencies,
			),
		).rejects.toMatchObject({ code: "TTS_TIMEOUT_UNCERTAIN" });
		expect(timeout.rows[0]?.status).toBe("indeterminate");

		const invalid = harness({
			providerResult: {
				audio: new Uint8Array([1, 2, 3]),
				contentType: "audio/mpeg",
				providerRequestId: "req-invalid",
			},
		});
		await expect(
			generateVoiceSegment(
				actor,
				{
					projectId: "project-1",
					segmentKey: "intro",
					idempotencyKey: "idem-invalid-1",
				},
				invalid.dependencies,
			),
		).rejects.toMatchObject({ code: "TTS_AUDIO_METADATA_INVALID" });
		expect(invalid.rows[0]?.status).toBe("failed");
		expect(invalid.put).not.toHaveBeenCalled();
	});

	it("does not retry provider after storage or finalize failure and cleans up finalized orphan", async () => {
		const storageFailure = harness({
			storagePutError: new VoiceSegmentError("TTS_STORAGE_FAILED"),
		});
		await expect(
			generateVoiceSegment(
				actor,
				{
					projectId: "project-1",
					segmentKey: "intro",
					idempotencyKey: "idem-storage-1",
				},
				storageFailure.dependencies,
			),
		).rejects.toMatchObject({ code: "TTS_STORAGE_FAILED" });
		expect(storageFailure.generate).toHaveBeenCalledTimes(1);
		expect(storageFailure.rows[0]?.status).toBe("failed");

		const finalizeFailure = harness({
			completeError: new Error("db unavailable"),
		});
		await expect(
			generateVoiceSegment(
				actor,
				{
					projectId: "project-1",
					segmentKey: "intro",
					idempotencyKey: "idem-finalize-1",
				},
				finalizeFailure.dependencies,
			),
		).rejects.toMatchObject({ code: "TTS_PERSISTENCE_FAILED" });
		expect(finalizeFailure.generate).toHaveBeenCalledTimes(1);
		expect(finalizeFailure.remove).toHaveBeenCalledTimes(1);
	});

	it("reconciles expired pending without automatic provider retry", async () => {
		const h = harness();
		const stale = pendingArtifact({
			id: "expired-1",
			idempotencyKey: "idem-expired-1",
			requestHash: hashVoiceSegmentRequest(prepared.fingerprint),
			createdAt: new Date("2026-08-20T23:00:00.000Z"),
		});
		h.rows.push(stale);
		await generateVoiceSegment(
			actor,
			{
				projectId: "project-1",
				segmentKey: "intro",
				idempotencyKey: "idem-expired-1",
			},
			h.dependencies,
		);
		expect(stale.status).toBe("indeterminate");
		expect(h.generate).not.toHaveBeenCalled();
	});

	it("keeps completed history stale when script or VoiceConfig changes while provider runs", async () => {
		for (const change of [
			{ sourceScriptRevision: 6 },
			{ voiceConfigRevision: 2 },
		] as const) {
			const h = harness();
			let current = prepared;
			h.generate.mockImplementationOnce(async () => {
				current = {
					...prepared,
					fingerprint: { ...prepared.fingerprint, ...change },
				};
				return {
					audio: mp3Fixture(),
					contentType: "audio/mpeg",
					providerRequestId: "race",
				};
			});
			const result = await generateVoiceSegment(
				actor,
				{
					projectId: "project-1",
					segmentKey: "intro",
					idempotencyKey: `idem-race-${change.sourceScriptRevision ?? change.voiceConfigRevision}`,
				},
				{ ...h.dependencies, readCurrent: async () => current },
			);
			expect(result.artifact.status).toBe("completed");
			expect(result.readModel.effectiveStatus).toBe("stale");
		}
	});
});
