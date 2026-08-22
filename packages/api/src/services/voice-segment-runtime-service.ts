import { randomUUID } from "node:crypto";
import {
	deriveVoiceSegmentReadModel,
	TTS_PROVIDER,
	VoiceConfigError,
	type VoiceSegmentArtifact,
	type VoiceSegmentArtifactReadModel,
	VoiceSegmentError,
	type VoiceSegmentFingerprint,
	validateVoiceConfigFields,
	validateVoiceSegmentText,
} from "@affichannel/core";
import { env } from "@affichannel/env/server";

import { parseMp3DurationMs } from "../audio/mp3-duration";
import type {
	TtsGenerateSegmentResult,
	TtsProvider,
	TtsProviderError,
} from "../providers/tts/tts-provider";
import { resolveTtsProvider } from "../providers/tts/tts-provider-registry";
import type { VoiceAudioStorage } from "../storage/voice-audio-storage";
import { createDefaultVoiceAudioStorageKey } from "../storage/voice-audio-storage";
import { createVoiceAudioStorage } from "../storage/voice-audio-storage-factory";
import { FactLockGate } from "./fact-lock-gate-service";
import { findCurrentScriptVersion } from "./script-version-repository";
import { findVoiceConfig } from "./voice-config-service";
import {
	hashVoiceSegmentRequest,
	hashVoiceSegmentText,
	sha256Bytes,
} from "./voice-segment-hashing";
import {
	completeVoiceSegmentArtifact,
	failVoiceSegmentArtifact,
	findPendingVoiceSegmentArtifactByRequestHash,
	findVoiceSegmentArtifactById,
	findVoiceSegmentArtifactByIdempotencyKey,
	getVoiceSegmentReadModel,
	type InsertPendingVoiceSegmentArtifactInput,
	insertPendingVoiceSegmentArtifactAtomic,
	listVoiceSegmentArtifacts,
	reconcileExpiredPendingVoiceSegmentArtifacts,
	voiceSegmentArtifactUniqueConstraint,
} from "./voice-segment-repository";
import { reconcileVoiceStepBestEffort } from "./voice-step-workflow-service";
import type { WorkspaceActor } from "./workspace";

export type PreparedVoiceSegmentRequest = {
	projectId: string;
	segmentKey: string;
	text: string;
	fingerprint: VoiceSegmentFingerprint;
};

export type VoiceSegmentState = {
	segmentKey: string;
	text: string;
	readModel: VoiceSegmentArtifactReadModel;
};

export type VoiceSegmentGenerateResult = {
	artifact: VoiceSegmentArtifact;
	readModel: VoiceSegmentArtifactReadModel;
};

export type VoiceSegmentRepositoryDependencies = {
	findByIdempotencyKey: typeof findVoiceSegmentArtifactByIdempotencyKey;
	findById: typeof findVoiceSegmentArtifactById;
	findPendingByRequestHash: typeof findPendingVoiceSegmentArtifactByRequestHash;
	insertPendingAtomic: typeof insertPendingVoiceSegmentArtifactAtomic;
	complete: typeof completeVoiceSegmentArtifact;
	fail: typeof failVoiceSegmentArtifact;
	getReadModel: typeof getVoiceSegmentReadModel;
	list: typeof listVoiceSegmentArtifacts;
	reconcileExpired: typeof reconcileExpiredPendingVoiceSegmentArtifacts;
};

export type VoiceSegmentRuntimeDependencies = {
	provider?: TtsProvider;
	storage?: VoiceAudioStorage;
	prepare?: (
		actor: WorkspaceActor,
		projectId: string,
		segmentKey: string,
	) => Promise<PreparedVoiceSegmentRequest>;
	readCurrent?: (
		actor: WorkspaceActor,
		projectId: string,
		segmentKey: string,
	) => Promise<PreparedVoiceSegmentRequest>;
	beforeInsert?: () => Promise<void>;
	afterPending?: (artifact: VoiceSegmentArtifact) => Promise<void>;
	assertFactLockPassed?: (
		actor: WorkspaceActor,
		projectId: string,
	) => Promise<unknown>;
	now?: () => Date;
	reconcileWorkflow?: (
		actor: WorkspaceActor,
		projectId: string,
	) => Promise<unknown>;
	repository?: Partial<VoiceSegmentRepositoryDependencies>;
};

async function reconcileWorkflowAfterMutation(
	actor: WorkspaceActor,
	projectId: string,
	dependencies: VoiceSegmentRuntimeDependencies,
) {
	if (dependencies.reconcileWorkflow) {
		await dependencies.reconcileWorkflow(actor, projectId);
		return;
	}
	if (!dependencies.repository)
		await reconcileVoiceStepBestEffort(actor, projectId);
}

function segmentNotFound(
	message = "Voice segment không tồn tại trong ScriptVersion hiện tại.",
) {
	return new VoiceSegmentError("VOICE_SEGMENT_NOT_FOUND", message);
}

function validateIdempotencyKey(idempotencyKey: string) {
	const value = idempotencyKey.trim();
	if (value.length < 8 || value.length > 200) {
		throw new VoiceSegmentError(
			"VOICE_SEGMENT_INPUT_INVALID",
			"Idempotency key phải dài từ 8 đến 200 ký tự.",
		);
	}
	return value;
}

async function readCurrentVoiceSegmentContext(
	actor: WorkspaceActor,
	projectId: string,
	segmentKey: string,
): Promise<PreparedVoiceSegmentRequest> {
	const script = await findCurrentScriptVersion(actor, projectId);
	if (!script) throw segmentNotFound("Project chưa có ScriptVersion hiện tại.");
	const config = await findVoiceConfig(actor, projectId);
	if (!config) throw new VoiceConfigError("VOICE_CONFIG_NOT_FOUND");

	const fields = validateVoiceConfigFields({
		voiceId: config.voiceId,
		language: config.language,
		speed: config.speed,
	});
	if (config.provider !== TTS_PROVIDER) {
		throw new VoiceSegmentError(
			"TTS_PROVIDER_UNAVAILABLE",
			"VoiceConfig sử dụng provider không được hỗ trợ.",
		);
	}

	const segment = script.editableSnapshot.voiceoverSegments.find(
		(candidate) => candidate.key === segmentKey,
	);
	if (!segment) throw segmentNotFound();
	const text = validateVoiceSegmentText(
		segment.text,
		env.VOICE_SEGMENT_MAX_CHARS,
	);
	const fingerprint: VoiceSegmentFingerprint = {
		workspaceId: actor.workspaceId,
		projectId,
		sourceScriptVersionId: script.id,
		sourceScriptRevision: script.revision,
		segmentKey,
		textHash: hashVoiceSegmentText(text),
		voiceConfigRevision: config.revision,
		provider: config.provider,
		voiceId: fields.voiceId,
		language: fields.language,
		speed: fields.speed,
	};
	return { projectId, segmentKey, text, fingerprint };
}

export async function prepareVoiceSegmentRequest(
	actor: WorkspaceActor,
	projectId: string,
	segmentKey: string,
) {
	await FactLockGate.assertPassed(actor, projectId);
	return readCurrentVoiceSegmentContext(actor, projectId, segmentKey);
}

async function markArtifactFailure(
	actor: WorkspaceActor,
	artifactId: string,
	status: "failed" | "indeterminate",
	errorCode: string,
	providerRequestId: string | null,
	repository?: Partial<VoiceSegmentRepositoryDependencies>,
) {
	try {
		const fail = repository?.fail ?? failVoiceSegmentArtifact;
		const failed = await fail({
			actor,
			artifactId,
			status,
			errorCode,
			providerRequestId,
		});
		if (!failed) {
			throw new Error("Voice segment artifact was no longer pending.");
		}
		return failed;
	} catch {
		throw new VoiceSegmentError(
			"TTS_PERSISTENCE_FAILED",
			"Không thể ghi trạng thái thất bại của voice segment.",
			{ originalErrorCode: errorCode },
		);
	}
}

async function readState(
	actor: WorkspaceActor,
	prepared: PreparedVoiceSegmentRequest,
	dependencies: VoiceSegmentRuntimeDependencies,
) {
	const getReadModel =
		dependencies.repository?.getReadModel ?? getVoiceSegmentReadModel;
	return getReadModel(
		actor,
		prepared.projectId,
		prepared.segmentKey,
		prepared.fingerprint,
	);
}

async function currentState(
	actor: WorkspaceActor,
	projectId: string,
	segmentKey: string,
	dependencies: VoiceSegmentRuntimeDependencies,
) {
	const current = dependencies.readCurrent
		? await dependencies.readCurrent(actor, projectId, segmentKey)
		: await readCurrentVoiceSegmentContext(actor, projectId, segmentKey);
	return { current, readModel: await readState(actor, current, dependencies) };
}

function validateGeneratedAudio(result: TtsGenerateSegmentResult) {
	if (
		result.contentType !== "audio/mpeg" ||
		result.audio.byteLength === 0 ||
		result.audio.byteLength > env.VOICE_SEGMENT_MAX_AUDIO_BYTES
	) {
		throw new VoiceSegmentError(
			"TTS_INVALID_AUDIO",
			"TTS provider trả về audio segment không hợp lệ.",
		);
	}
}

function asProviderError(error: unknown): {
	status: "failed" | "indeterminate";
	code: string;
	providerRequestId: string | null;
	error: unknown;
} {
	if (error && typeof error === "object" && "uncertain" in error) {
		const providerError = error as TtsProviderError;
		return {
			status: providerError.uncertain ? "indeterminate" : "failed",
			code: providerError.code,
			providerRequestId: providerError.providerRequestId,
			error,
		};
	}
	if (error instanceof VoiceSegmentError) {
		return {
			status: "failed",
			code: error.code,
			providerRequestId: null,
			error,
		};
	}
	return {
		status: "indeterminate",
		code: "TTS_REQUEST_STATE_UNCERTAIN",
		providerRequestId: null,
		error: new VoiceSegmentError(
			"TTS_REQUEST_STATE_UNCERTAIN",
			"TTS provider request có trạng thái không xác định.",
		),
	};
}

async function coalescedArtifact(
	actor: WorkspaceActor,
	prepared: PreparedVoiceSegmentRequest,
	idempotencyKey: string,
	requestHash: string,
	dependencies: VoiceSegmentRuntimeDependencies,
) {
	const findByIdempotencyKey =
		dependencies.repository?.findByIdempotencyKey ??
		findVoiceSegmentArtifactByIdempotencyKey;
	const findPendingByRequestHash =
		dependencies.repository?.findPendingByRequestHash ??
		findPendingVoiceSegmentArtifactByRequestHash;
	const existing = await findByIdempotencyKey(actor, idempotencyKey);
	if (existing) {
		if (existing.requestHash !== requestHash) {
			throw new VoiceSegmentError(
				"VOICE_SEGMENT_IDEMPOTENCY_CONFLICT",
				"Idempotency key đã được dùng cho request khác.",
			);
		}
		return existing;
	}
	const pending = await findPendingByRequestHash(
		actor,
		prepared.projectId,
		requestHash,
	);
	if (pending) {
		throw new VoiceSegmentError(
			"VOICE_SEGMENT_ALREADY_PENDING",
			"Voice segment cùng request đang được xử lý; hãy dùng lại idempotency key của attempt đó hoặc chờ hoàn tất.",
		);
	}
	return undefined;
}

export async function generateVoiceSegment(
	actor: WorkspaceActor,
	input: { projectId: string; segmentKey: string; idempotencyKey: string },
	dependencies: VoiceSegmentRuntimeDependencies = {},
): Promise<VoiceSegmentGenerateResult> {
	const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
	const prepared = dependencies.prepare
		? await dependencies.prepare(actor, input.projectId, input.segmentKey)
		: await prepareVoiceSegmentRequest(
				actor,
				input.projectId,
				input.segmentKey,
			);
	const requestHash = hashVoiceSegmentRequest(prepared.fingerprint);
	const now = dependencies.now?.() ?? new Date();
	const reconcileExpired =
		dependencies.repository?.reconcileExpired ??
		reconcileExpiredPendingVoiceSegmentArtifacts;
	await reconcileExpired(actor, now);

	const reusable = await coalescedArtifact(
		actor,
		prepared,
		idempotencyKey,
		requestHash,
		dependencies,
	);
	if (reusable) {
		await reconcileWorkflowAfterMutation(actor, input.projectId, dependencies);
		const state = await currentState(
			actor,
			input.projectId,
			input.segmentKey,
			dependencies,
		);
		return { artifact: reusable, readModel: state.readModel };
	}

	const provider =
		dependencies.provider ?? resolveTtsProvider(prepared.fingerprint.provider);
	if (!provider) {
		throw new VoiceSegmentError(
			"TTS_PROVIDER_UNAVAILABLE",
			"TTS provider không khả dụng trên server.",
		);
	}
	const storage = dependencies.storage ?? createVoiceAudioStorage();
	const insertInput: InsertPendingVoiceSegmentArtifactInput = {
		id: randomUUID(),
		actor,
		projectId: prepared.projectId,
		sourceScriptVersionId: prepared.fingerprint.sourceScriptVersionId,
		sourceScriptRevision: prepared.fingerprint.sourceScriptRevision,
		segmentKey: prepared.segmentKey,
		segmentTextSnapshot: prepared.text,
		textHash: prepared.fingerprint.textHash,
		voiceConfigRevision: prepared.fingerprint.voiceConfigRevision,
		provider: prepared.fingerprint.provider,
		voiceId: prepared.fingerprint.voiceId,
		language: prepared.fingerprint.language,
		speed: prepared.fingerprint.speed,
		idempotencyKey,
		requestHash,
	};
	await dependencies.beforeInsert?.();

	let pending: VoiceSegmentArtifact;
	try {
		const insertPendingAtomic =
			dependencies.repository?.insertPendingAtomic ??
			insertPendingVoiceSegmentArtifactAtomic;
		pending = await insertPendingAtomic({
			insert: insertInput,
			expected: prepared.fingerprint,
		});
	} catch (error) {
		const uniqueConstraint = voiceSegmentArtifactUniqueConstraint(error);
		if (!uniqueConstraint) throw error;
		const raced = await coalescedArtifact(
			actor,
			prepared,
			idempotencyKey,
			requestHash,
			dependencies,
		);
		if (raced) {
			const state = await currentState(
				actor,
				input.projectId,
				input.segmentKey,
				dependencies,
			);
			return { artifact: raced, readModel: state.readModel };
		}
		if (uniqueConstraint === "voice_segment_artifact_pending_request_unique") {
			throw new VoiceSegmentError(
				"VOICE_SEGMENT_ALREADY_PENDING",
				"Voice segment cùng request vừa được một request khác bắt đầu xử lý.",
			);
		}
		throw new VoiceSegmentError(
			"VOICE_SEGMENT_ALREADY_PENDING",
			"Idempotency request đang có một ghi nhận cạnh tranh; hãy dùng lại key sau khi đọc state.",
		);
	}

	try {
		await dependencies.afterPending?.(pending);
		const assertFactLockPassed =
			dependencies.assertFactLockPassed ??
			((gateActor: WorkspaceActor, gateProjectId: string) =>
				FactLockGate.assertPassed(gateActor, gateProjectId));
		await assertFactLockPassed(actor, input.projectId);
	} catch (error) {
		await markArtifactFailure(
			actor,
			pending.id,
			"failed",
			"VOICE_SEGMENT_CONTEXT_STALE",
			null,
			dependencies.repository,
		);
		await reconcileWorkflowAfterMutation(actor, input.projectId, dependencies);
		throw error;
	}

	let providerResult: TtsGenerateSegmentResult;
	try {
		providerResult = await provider.generateSegment({
			text: prepared.text,
			voiceId: prepared.fingerprint.voiceId,
			language: prepared.fingerprint.language,
			speed: prepared.fingerprint.speed,
		});
	} catch (error) {
		const classified = asProviderError(error);
		await markArtifactFailure(
			actor,
			pending.id,
			classified.status,
			classified.code,
			classified.providerRequestId,
			dependencies.repository,
		);
		await reconcileWorkflowAfterMutation(actor, input.projectId, dependencies);
		throw classified.error;
	}

	let durationMs: number;
	let checksum: string;
	try {
		validateGeneratedAudio(providerResult);
		durationMs = await parseMp3DurationMs(providerResult.audio);
		checksum = sha256Bytes(providerResult.audio);
	} catch (error) {
		const classified = asProviderError(error);
		await markArtifactFailure(
			actor,
			pending.id,
			"failed",
			classified.code,
			providerResult.providerRequestId,
			dependencies.repository,
		);
		await reconcileWorkflowAfterMutation(actor, input.projectId, dependencies);
		throw classified.error;
	}

	const storageKey = createDefaultVoiceAudioStorageKey({
		workspaceId: actor.workspaceId,
		projectId: input.projectId,
		artifactId: pending.id,
	});
	try {
		await storage.put({
			storageKey,
			body: providerResult.audio,
			contentType: "audio/mpeg",
			checksum,
		});
	} catch (error) {
		const storageError =
			error instanceof VoiceSegmentError
				? error
				: new VoiceSegmentError(
						"TTS_STORAGE_FAILED",
						"Không thể lưu audio voice segment.",
					);
		await markArtifactFailure(
			actor,
			pending.id,
			"failed",
			storageError.code,
			providerResult.providerRequestId,
			dependencies.repository,
		);
		await reconcileWorkflowAfterMutation(actor, input.projectId, dependencies);
		throw storageError;
	}

	let finalized: VoiceSegmentArtifact | undefined;
	const finalizeInput = {
		actor,
		artifactId: pending.id,
		providerRequestId: providerResult.providerRequestId,
		storageProvider: storage.provider,
		storageKey,
		mimeType: "audio/mpeg" as const,
		byteSize: providerResult.audio.byteLength,
		checksum,
		durationMs,
	};
	try {
		const complete =
			dependencies.repository?.complete ?? completeVoiceSegmentArtifact;
		finalized = await complete(finalizeInput);
		if (!finalized)
			throw new Error("Voice segment artifact finalize returned no row.");
	} catch {
		const findById =
			dependencies.repository?.findById ?? findVoiceSegmentArtifactById;
		let persisted: VoiceSegmentArtifact | undefined;
		let persistenceStateKnown = false;
		try {
			persisted = await findById(actor, pending.id);
			persistenceStateKnown = true;
		} catch {
			persistenceStateKnown = false;
		}

		if (persisted?.status === "completed") {
			const matchesFinalize =
				persisted.providerRequestId === finalizeInput.providerRequestId &&
				persisted.storageProvider === finalizeInput.storageProvider &&
				persisted.storageKey === finalizeInput.storageKey &&
				persisted.mimeType === finalizeInput.mimeType &&
				persisted.byteSize === finalizeInput.byteSize &&
				persisted.checksum === finalizeInput.checksum &&
				persisted.durationMs === finalizeInput.durationMs;
			if (matchesFinalize) {
				finalized = persisted;
			} else {
				console.warn("voice_segment_finalize_state_mismatch", {
					artifactId: pending.id,
					storageProvider: storage.provider,
					storageRetained: true,
				});
				throw new VoiceSegmentError(
					"TTS_PERSISTENCE_FAILED",
					"Metadata voice segment đã hoàn tất nhưng không khớp audio hiện tại.",
					{ storageRetained: true, persistenceState: "completed_mismatch" },
				);
			}
		} else if (!persistenceStateKnown || !persisted) {
			console.warn("voice_segment_finalize_state_unknown", {
				artifactId: pending.id,
				storageProvider: storage.provider,
				storageRetained: true,
			});
			throw new VoiceSegmentError(
				"TTS_PERSISTENCE_FAILED",
				"Không xác định được trạng thái lưu metadata voice segment; audio được giữ lại để reconciliation.",
				{ storageRetained: true, persistenceState: "unknown" },
			);
		}

		if (finalized) {
			await reconcileWorkflowAfterMutation(
				actor,
				input.projectId,
				dependencies,
			);
			const state = await currentState(
				actor,
				input.projectId,
				input.segmentKey,
				dependencies,
			);
			return { artifact: finalized, readModel: state.readModel };
		}

		let cleanupFailed = false;
		try {
			await storage.delete(storageKey);
		} catch {
			cleanupFailed = true;
		}
		console.warn("voice_segment_finalize_cleanup", {
			artifactId: pending.id,
			storageProvider: storage.provider,
			cleanupFailed,
		});
		throw new VoiceSegmentError(
			"TTS_PERSISTENCE_FAILED",
			"Không thể hoàn tất lưu metadata voice segment; provider không được gọi lại.",
			{
				cleanupFailed,
				storageProvider: storage.provider,
				storageRetained: cleanupFailed,
				persistenceState: persisted?.status ?? "non_completed",
			},
		);
	}

	await reconcileWorkflowAfterMutation(actor, input.projectId, dependencies);
	const state = await currentState(
		actor,
		input.projectId,
		input.segmentKey,
		dependencies,
	);
	return { artifact: finalized, readModel: state.readModel };
}

export async function getVoiceSegmentState(
	actor: WorkspaceActor,
	projectId: string,
	segmentKey: string,
	dependencies: VoiceSegmentRuntimeDependencies = {},
) {
	const reconcileExpired =
		dependencies.repository?.reconcileExpired ??
		reconcileExpiredPendingVoiceSegmentArtifacts;
	await reconcileExpired(actor);
	await reconcileWorkflowAfterMutation(actor, projectId, dependencies);
	return currentState(actor, projectId, segmentKey, dependencies);
}

export async function listVoiceSegmentStates(
	actor: WorkspaceActor,
	projectId: string,
	dependencies: VoiceSegmentRuntimeDependencies = {},
): Promise<VoiceSegmentState[]> {
	const reconcileExpired =
		dependencies.repository?.reconcileExpired ??
		reconcileExpiredPendingVoiceSegmentArtifacts;
	await reconcileExpired(actor);
	await reconcileWorkflowAfterMutation(actor, projectId, dependencies);
	const script = await findCurrentScriptVersion(actor, projectId);
	if (!script) throw segmentNotFound("Project chưa có ScriptVersion hiện tại.");
	const config = await findVoiceConfig(actor, projectId);
	if (!config) throw new VoiceConfigError("VOICE_CONFIG_NOT_FOUND");
	const list = dependencies.repository?.list ?? listVoiceSegmentArtifacts;
	const artifacts = await list(actor, projectId);
	return Promise.all(
		script.editableSnapshot.voiceoverSegments.map(async (segment) => {
			const current = await (dependencies.readCurrent
				? dependencies.readCurrent(actor, projectId, segment.key)
				: readCurrentVoiceSegmentContext(actor, projectId, segment.key));
			return {
				segmentKey: segment.key,
				text: segment.text,
				readModel: deriveVoiceSegmentReadModel(
					artifacts.filter((artifact) => artifact.segmentKey === segment.key),
					current.fingerprint,
				),
			};
		}),
	);
}
