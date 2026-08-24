import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMp3DurationMs } from "@affichannel/api/audio/mp3-duration";
import {
	hashVoiceSegmentRequest,
	hashVoiceSegmentText,
	sha256Bytes,
} from "@affichannel/api/services/voice-segment-hashing";
import {
	LocalVoiceAudioStorage,
	R2VoiceAudioStorage,
} from "@affichannel/api/storage/voice-audio-storage";
import {
	createVoiceAudioStorageKey,
	DEFAULT_VOICE_SEGMENT_PENDING_LEASE_MS,
	deriveVoiceSegmentReadModel,
	isVoiceSegmentPendingExpired,
	VoiceSegmentError,
	validateVoiceSegmentText,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const fingerprint = {
	workspaceId: "workspace-a",
	projectId: "project-a",
	sourceScriptVersionId: "script-a",
	sourceScriptRevision: 2,
	segmentKey: "intro",
	textHash: hashVoiceSegmentText("Xin chào, 150.000 ₫! 🎙️"),
	voiceConfigRevision: 3,
	provider: "apikeyfun",
	voiceId: "eve",
	language: "vi",
	speed: 1,
} as const;

function artifact(
	overrides: Partial<{
		id: string;
		status: "pending" | "completed" | "failed" | "indeterminate";
		createdAt: Date;
		textHash: string;
		sourceScriptRevision: number;
		voiceConfigRevision: number;
		voiceId: string;
	}> = {},
) {
	const body = new Uint8Array([1, 2, 3]);
	return {
		...fingerprint,
		id: overrides.id ?? "artifact-1",
		textHash: overrides.textHash ?? fingerprint.textHash,
		sourceScriptRevision:
			overrides.sourceScriptRevision ?? fingerprint.sourceScriptRevision,
		voiceConfigRevision:
			overrides.voiceConfigRevision ?? fingerprint.voiceConfigRevision,
		voiceId: overrides.voiceId ?? fingerprint.voiceId,
		createdByUserId: "user-a",
		segmentTextSnapshot: "Xin chào, 150.000 ₫! 🎙️",
		idempotencyKey: `idem-${overrides.id ?? "one"}`,
		requestHash: hashVoiceSegmentRequest({
			...fingerprint,
			textHash: overrides.textHash ?? fingerprint.textHash,
			sourceScriptRevision:
				overrides.sourceScriptRevision ?? fingerprint.sourceScriptRevision,
			voiceConfigRevision:
				overrides.voiceConfigRevision ?? fingerprint.voiceConfigRevision,
			voiceId: overrides.voiceId ?? fingerprint.voiceId,
		}),
		status: overrides.status ?? "completed",
		providerRequestId: null,
		errorCode: null,
		storageProvider: "local" as const,
		storageKey: "voice/v1/workspace-a/project-a/artifact-1.mp3",
		mimeType: "audio/mpeg" as const,
		byteSize: body.byteLength,
		checksum: sha256Bytes(body),
		durationMs: 1_045,
		createdAt: overrides.createdAt ?? new Date("2026-08-21T00:00:00.000Z"),
		finishedAt: new Date("2026-08-21T00:00:01.000Z"),
	};
}

function mp3Fixture(frameCount = 40) {
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
	const fixture = new Uint8Array(frame.length * frameCount);
	for (let index = 0; index < frameCount; index += 1) {
		fixture.set(frame, index * frame.length);
	}
	return fixture;
}

describe("AFF-US-012 VoiceSegment foundation", () => {
	it("keeps text bytes unchanged and hashes Unicode content deterministically", () => {
		const text = "  Tiếng Việt 🎙️ — 150.000 ₫!  ";
		expect(validateVoiceSegmentText(text)).toBe(text);
		expect(hashVoiceSegmentText(text)).toBe(hashVoiceSegmentText(text));
		expect(hashVoiceSegmentText(text)).not.toBe(
			hashVoiceSegmentText(text.trim()),
		);
		expect(hashVoiceSegmentRequest(fingerprint)).toHaveLength(64);
	});

	it("uses Unicode code points for the max boundary", () => {
		expect(validateVoiceSegmentText("😀😀", 2)).toBe("😀😀");
		expect(() => validateVoiceSegmentText("😀😀😀", 2)).toThrowError(
			expect.objectContaining({ code: "VOICE_SEGMENT_INPUT_TOO_LONG" }),
		);
		expect(() => validateVoiceSegmentText("   ")).toThrowError(
			expect.objectContaining({ code: "VOICE_SEGMENT_INPUT_INVALID" }),
		);
	});

	it("preserves long, symbolic, currency and brand text exactly", () => {
		const samples = [
			"Thời lượng pin lên đến 20 giờ.",
			"150.000 ₫ · 1.299.000đ · $29.99",
			"50% USB-C 2.4 GHz A/B + & / -",
			"Logitech MX Master 3S · Apple · Sony WH-1000XM5",
			"😀 🎙️ — exact casing and punctuation",
		];
		for (const text of samples) {
			expect(validateVoiceSegmentText(text)).toBe(text);
			expect(hashVoiceSegmentText(text)).toBe(hashVoiceSegmentText(text));
		}

		const exactMax = "x".repeat(4_000);
		expect(validateVoiceSegmentText(exactMax, 4_000)).toBe(exactMax);
		expect(() => validateVoiceSegmentText(`${exactMax}x`, 4_000)).toThrowError(
			expect.objectContaining({
				code: "VOICE_SEGMENT_INPUT_TOO_LONG",
				metadata: { maxChars: 4_000, codePointLength: 4_001 },
			}),
		);
	});

	it("derives latest request, usable artifact and stale/current status", () => {
		const historical = artifact({ id: "historical", sourceScriptRevision: 1 });
		const current = artifact({
			id: "current",
			createdAt: new Date("2026-08-21T00:01:00.000Z"),
		});
		const model = deriveVoiceSegmentReadModel(
			[historical, current],
			fingerprint,
		);

		expect(model.latestRequest?.id).toBe("current");
		expect(model.latestUsableArtifact?.id).toBe("current");
		expect(model.effectiveStatus).toBe("completed");

		const stale = deriveVoiceSegmentReadModel([historical], fingerprint);
		expect(stale.latestRequest?.id).toBe("historical");
		expect(stale.latestUsableArtifact).toBeNull();
		expect(stale.effectiveStatus).toBe("stale");

		const failedRegenerate = deriveVoiceSegmentReadModel(
			[
				current,
				artifact({
					id: "failed",
					status: "failed",
					createdAt: new Date("2026-08-21T00:02:00.000Z"),
				}),
			],
			fingerprint,
		);
		expect(failedRegenerate.latestRequest?.id).toBe("failed");
		expect(failedRegenerate.latestUsableArtifact?.id).toBe("current");
		expect(failedRegenerate.effectiveStatus).toBe("failed");
	});

	it("detects the pending lease boundary without retrying", () => {
		const now = new Date("2026-08-21T00:05:00.000Z");
		const pending = artifact({
			status: "pending",
			createdAt: new Date(
				now.getTime() - DEFAULT_VOICE_SEGMENT_PENDING_LEASE_MS,
			),
		});
		expect(
			isVoiceSegmentPendingExpired(
				pending,
				now,
				DEFAULT_VOICE_SEGMENT_PENDING_LEASE_MS,
			),
		).toBe(true);
	});

	it("keeps an active pending request pending in the read-only projection", () => {
		const now = new Date("2026-08-21T00:05:00.000Z");
		const pending = artifact({
			status: "pending",
			createdAt: new Date(
				now.getTime() - DEFAULT_VOICE_SEGMENT_PENDING_LEASE_MS + 1,
			),
		});
		const model = deriveVoiceSegmentReadModel([pending], fingerprint, {
			now,
			pendingLeaseMs: DEFAULT_VOICE_SEGMENT_PENDING_LEASE_MS,
		});

		expect(model.effectiveStatus).toBe("pending");
		expect(model.latestRequest).toBe(pending);
		expect(pending.status).toBe("pending");
	});

	it("projects an expired pending request as indeterminate without mutation", () => {
		const now = new Date("2026-08-21T00:05:00.000Z");
		const pending = artifact({
			status: "pending",
			createdAt: new Date(
				now.getTime() - DEFAULT_VOICE_SEGMENT_PENDING_LEASE_MS,
			),
		});
		const model = deriveVoiceSegmentReadModel([pending], fingerprint, {
			now,
			pendingLeaseMs: DEFAULT_VOICE_SEGMENT_PENDING_LEASE_MS,
		});

		expect(model.effectiveStatus).toBe("indeterminate");
		expect(model.latestRequest).toBe(pending);
		expect(pending).toMatchObject({ status: "pending", errorCode: null });
	});

	it("does not fall back to older completed audio after latest pending expires", () => {
		const now = new Date("2026-08-21T00:10:00.000Z");
		const completed = artifact({
			id: "completed",
			createdAt: new Date("2026-08-21T00:00:00.000Z"),
		});
		const pending = artifact({
			id: "pending",
			status: "pending",
			createdAt: new Date("2026-08-21T00:01:00.000Z"),
		});
		const model = deriveVoiceSegmentReadModel(
			[completed, pending],
			fingerprint,
			{ now, pendingLeaseMs: DEFAULT_VOICE_SEGMENT_PENDING_LEASE_MS },
		);

		expect(model.latestRequest?.id).toBe("pending");
		expect(model.latestUsableArtifact?.id).toBe("completed");
		expect(model.effectiveStatus).toBe("indeterminate");
	});

	it("keeps an expired pending artifact stale when its fingerprint is stale", () => {
		const now = new Date("2026-08-21T00:10:00.000Z");
		const stalePending = artifact({
			status: "pending",
			sourceScriptRevision: 1,
			createdAt: new Date("2026-08-21T00:00:00.000Z"),
		});
		const model = deriveVoiceSegmentReadModel([stalePending], fingerprint, {
			now,
			pendingLeaseMs: DEFAULT_VOICE_SEGMENT_PENDING_LEASE_MS,
		});

		expect(model.effectiveStatus).toBe("stale");
		expect(model.latestRequest).toBe(stalePending);
		expect(stalePending.status).toBe("pending");
	});

	it("creates versioned safe storage keys and rejects traversal", () => {
		expect(
			createVoiceAudioStorageKey({
				workspaceId: "workspace-a",
				projectId: "project-a",
				artifactId: "artifact-a",
			}),
		).toBe("voice/v1/workspace-a/project-a/artifact-a.mp3");
		expect(() =>
			createVoiceAudioStorageKey({
				workspaceId: "../workspace",
				projectId: "project-a",
				artifactId: "artifact-a",
			}),
		).toThrowError(VoiceSegmentError);
	});

	it("stores local audio outside public paths and supports get/open/delete", async () => {
		const root = await mkdtemp(join(tmpdir(), "affichannel-voice-segment-"));
		const storage = new LocalVoiceAudioStorage({ rootDir: root });
		const body = mp3Fixture(2);
		const storageKey = "voice/v1/workspace-a/project-a/artifact-a.mp3";
		const checksum = sha256Bytes(body);

		try {
			expect(
				await storage.put({
					storageKey,
					body,
					contentType: "audio/mpeg",
					checksum,
				}),
			).toEqual({ byteSize: body.byteLength, checksum });
			expect(await storage.get(storageKey)).toEqual(body);
			expect(
				new Uint8Array(
					await new Response(await storage.open(storageKey)).arrayBuffer(),
				),
			).toEqual(body);
			expect(await readFile(join(root, storageKey))).toEqual(Buffer.from(body));
			await storage.delete(storageKey);
			await expect(storage.get(storageKey)).rejects.toMatchObject({
				code: "TTS_STORAGE_FAILED",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("uses an injected R2 client without real network", async () => {
		const objects = new Map<string, Uint8Array>();
		const calls: string[] = [];
		const storage = new R2VoiceAudioStorage({
			async putObject({ key, body }) {
				calls.push(`put:${key}`);
				objects.set(key, new Uint8Array(body));
			},
			async getObject(key) {
				calls.push(`get:${key}`);
				return objects.get(key) ?? null;
			},
			async deleteObject(key) {
				calls.push(`delete:${key}`);
				objects.delete(key);
			},
		});
		const body = mp3Fixture(2);
		const storageKey = "voice/v1/workspace-a/project-a/artifact-r2.mp3";
		const checksum = sha256Bytes(body);

		await storage.put({
			storageKey,
			body,
			contentType: "audio/mpeg",
			checksum,
		});
		expect(await storage.get(storageKey)).toEqual(body);
		await storage.delete(storageKey);
		expect(calls).toEqual([
			`put:${storageKey}`,
			`get:${storageKey}`,
			`delete:${storageKey}`,
		]);
	});

	it("parses positive server-side MP3 duration and fails closed", async () => {
		expect(await parseMp3DurationMs(mp3Fixture())).toBe(1_045);
		await expect(
			parseMp3DurationMs(new Uint8Array([1, 2, 3])),
		).rejects.toMatchObject({
			code: "TTS_AUDIO_METADATA_INVALID",
		});
		await expect(parseMp3DurationMs(new Uint8Array())).rejects.toMatchObject({
			code: "TTS_AUDIO_METADATA_INVALID",
		});
	});
});
