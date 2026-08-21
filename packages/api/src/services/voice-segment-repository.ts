import type {
	VoiceSegmentArtifact,
	VoiceSegmentArtifactReadModel,
	VoiceSegmentFingerprint,
} from "@affichannel/core";
import {
	deriveVoiceSegmentReadModel,
	isVoiceSegmentPendingExpired,
	VoiceSegmentError,
} from "@affichannel/core";
import {
	db,
	project,
	scriptVersion,
	voiceConfig,
	voiceSegmentArtifact,
} from "@affichannel/db";
import { env } from "@affichannel/env/server";
import { and, desc, eq, isNull, lte } from "drizzle-orm";

import type { WorkspaceActor } from "./workspace";

export type VoiceSegmentArtifactRow = typeof voiceSegmentArtifact.$inferSelect;

export type InsertPendingVoiceSegmentArtifactInput = {
	id: string;
	actor: WorkspaceActor;
	projectId: string;
	sourceScriptVersionId: string;
	sourceScriptRevision: number;
	segmentKey: string;
	segmentTextSnapshot: string;
	textHash: string;
	voiceConfigRevision: number;
	provider: string;
	voiceId: string;
	language: string;
	speed: number;
	idempotencyKey: string;
	requestHash: string;
};

function toArtifact(row: VoiceSegmentArtifactRow): VoiceSegmentArtifact {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		projectId: row.projectId,
		createdByUserId: row.createdByUserId,
		sourceScriptVersionId: row.sourceScriptVersionId,
		sourceScriptRevision: row.sourceScriptRevision,
		segmentKey: row.segmentKey,
		segmentTextSnapshot: row.segmentTextSnapshot,
		textHash: row.textHash,
		voiceConfigRevision: row.voiceConfigRevision,
		provider: row.provider,
		voiceId: row.voiceId,
		language: row.language,
		speed: row.speed,
		idempotencyKey: row.idempotencyKey,
		requestHash: row.requestHash,
		status: row.status as VoiceSegmentArtifact["status"],
		providerRequestId: row.providerRequestId,
		errorCode: row.errorCode,
		storageProvider:
			(row.storageProvider as VoiceSegmentArtifact["storageProvider"]) ?? null,
		storageKey: row.storageKey,
		mimeType: row.mimeType as VoiceSegmentArtifact["mimeType"],
		byteSize: row.byteSize,
		checksum: row.checksum,
		durationMs: row.durationMs,
		createdAt: row.createdAt,
		finishedAt: row.finishedAt,
	};
}

function pendingInsertValues(input: InsertPendingVoiceSegmentArtifactInput) {
	return {
		id: input.id,
		workspaceId: input.actor.workspaceId,
		projectId: input.projectId,
		createdByUserId: input.actor.userId,
		sourceScriptVersionId: input.sourceScriptVersionId,
		sourceScriptRevision: input.sourceScriptRevision,
		segmentKey: input.segmentKey,
		segmentTextSnapshot: input.segmentTextSnapshot,
		textHash: input.textHash,
		voiceConfigRevision: input.voiceConfigRevision,
		provider: input.provider,
		voiceId: input.voiceId,
		language: input.language,
		speed: input.speed,
		idempotencyKey: input.idempotencyKey,
		requestHash: input.requestHash,
		status: "pending" as const,
	};
}

function propertyFromError(error: unknown, property: string): unknown {
	if (typeof error !== "object" || error === null) return undefined;
	const value = (error as Record<string, unknown>)[property];
	if (value !== undefined) return value;
	if ("cause" in error) {
		return propertyFromError((error as { cause?: unknown }).cause, property);
	}
	return undefined;
}

export type VoiceSegmentArtifactUniqueConstraint =
	| "voice_segment_artifact_idempotency_unique"
	| "voice_segment_artifact_pending_request_unique";

export function voiceSegmentArtifactUniqueConstraint(
	error: unknown,
): VoiceSegmentArtifactUniqueConstraint | undefined {
	if (propertyFromError(error, "code") !== "23505") return undefined;
	const constraint = String(propertyFromError(error, "constraint"));
	if (
		constraint !== "voice_segment_artifact_idempotency_unique" &&
		constraint !== "voice_segment_artifact_pending_request_unique"
	) {
		return undefined;
	}
	return constraint;
}

export async function findVoiceSegmentArtifactByIdempotencyKey(
	actor: WorkspaceActor,
	idempotencyKey: string,
) {
	const [row] = await db
		.select()
		.from(voiceSegmentArtifact)
		.where(
			and(
				eq(voiceSegmentArtifact.workspaceId, actor.workspaceId),
				eq(voiceSegmentArtifact.idempotencyKey, idempotencyKey),
			),
		)
		.limit(1);
	return row ? toArtifact(row) : undefined;
}

export async function findVoiceSegmentArtifactById(
	actor: WorkspaceActor,
	artifactId: string,
) {
	const [row] = await db
		.select()
		.from(voiceSegmentArtifact)
		.where(
			and(
				eq(voiceSegmentArtifact.id, artifactId),
				eq(voiceSegmentArtifact.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return row ? toArtifact(row) : undefined;
}

export async function findPendingVoiceSegmentArtifactByRequestHash(
	actor: WorkspaceActor,
	projectId: string,
	requestHash: string,
) {
	const [row] = await db
		.select()
		.from(voiceSegmentArtifact)
		.where(
			and(
				eq(voiceSegmentArtifact.workspaceId, actor.workspaceId),
				eq(voiceSegmentArtifact.projectId, projectId),
				eq(voiceSegmentArtifact.requestHash, requestHash),
				eq(voiceSegmentArtifact.status, "pending"),
			),
		)
		.limit(1);
	return row ? toArtifact(row) : undefined;
}

export async function insertPendingVoiceSegmentArtifact(
	input: InsertPendingVoiceSegmentArtifactInput,
) {
	const [row] = await db
		.insert(voiceSegmentArtifact)
		.values(pendingInsertValues(input))
		.returning();
	if (!row) throw new Error("Voice segment artifact insert returned no row.");
	return toArtifact(row);
}

export async function insertPendingVoiceSegmentArtifactAtomic(input: {
	insert: InsertPendingVoiceSegmentArtifactInput;
	expected: VoiceSegmentFingerprint;
}) {
	return db.transaction(async (transaction) => {
		const [accessibleProject] = await transaction
			.select({ id: project.id })
			.from(project)
			.where(
				and(
					eq(project.id, input.insert.projectId),
					eq(project.workspaceId, input.insert.actor.workspaceId),
					isNull(project.archivedAt),
				),
			)
			.limit(1)
			.for("update", { of: project });
		if (!accessibleProject) {
			throw new VoiceSegmentError("VOICE_SEGMENT_NOT_FOUND");
		}

		const [currentScript] = await transaction
			.select({ id: scriptVersion.id, revision: scriptVersion.revision })
			.from(scriptVersion)
			.where(
				and(
					eq(scriptVersion.workspaceId, input.insert.actor.workspaceId),
					eq(scriptVersion.projectId, input.insert.projectId),
					eq(scriptVersion.status, "draft"),
				),
			)
			.orderBy(desc(scriptVersion.updatedAt), desc(scriptVersion.id))
			.limit(1)
			.for("update", { of: scriptVersion });
		if (
			!currentScript ||
			currentScript.id !== input.expected.sourceScriptVersionId ||
			currentScript.revision !== input.expected.sourceScriptRevision
		) {
			throw new VoiceSegmentError(
				"VOICE_SEGMENT_CONTEXT_STALE",
				"ScriptVersion đã thay đổi trước khi bắt đầu TTS.",
			);
		}

		const [currentConfig] = await transaction
			.select({
				revision: voiceConfig.revision,
				provider: voiceConfig.provider,
				voiceId: voiceConfig.voiceId,
				language: voiceConfig.language,
				speed: voiceConfig.speed,
			})
			.from(voiceConfig)
			.where(
				and(
					eq(voiceConfig.workspaceId, input.insert.actor.workspaceId),
					eq(voiceConfig.projectId, input.insert.projectId),
				),
			)
			.limit(1)
			.for("update", { of: voiceConfig });
		if (
			!currentConfig ||
			currentConfig.revision !== input.expected.voiceConfigRevision ||
			currentConfig.provider !== input.expected.provider ||
			currentConfig.voiceId !== input.expected.voiceId ||
			currentConfig.language !== input.expected.language ||
			currentConfig.speed !== input.expected.speed
		) {
			throw new VoiceSegmentError(
				"VOICE_SEGMENT_CONTEXT_STALE",
				"VoiceConfig đã thay đổi trước khi bắt đầu TTS.",
			);
		}

		const [row] = await transaction
			.insert(voiceSegmentArtifact)
			.values(pendingInsertValues(input.insert))
			.returning();
		if (!row) throw new Error("Voice segment artifact insert returned no row.");
		return toArtifact(row);
	});
}

export async function completeVoiceSegmentArtifact(input: {
	actor: WorkspaceActor;
	artifactId: string;
	providerRequestId: string | null;
	storageProvider: "local" | "r2";
	storageKey: string;
	mimeType: "audio/mpeg";
	byteSize: number;
	checksum: string;
	durationMs: number;
}) {
	const [row] = await db
		.update(voiceSegmentArtifact)
		.set({
			status: "completed",
			providerRequestId: input.providerRequestId,
			storageProvider: input.storageProvider,
			storageKey: input.storageKey,
			mimeType: input.mimeType,
			byteSize: input.byteSize,
			checksum: input.checksum,
			durationMs: input.durationMs,
			finishedAt: new Date(),
		})
		.where(
			and(
				eq(voiceSegmentArtifact.id, input.artifactId),
				eq(voiceSegmentArtifact.workspaceId, input.actor.workspaceId),
				eq(voiceSegmentArtifact.status, "pending"),
			),
		)
		.returning();
	return row ? toArtifact(row) : undefined;
}

export async function failVoiceSegmentArtifact(input: {
	actor: WorkspaceActor;
	artifactId: string;
	status: "failed" | "indeterminate";
	errorCode: string;
	providerRequestId?: string | null;
}) {
	const [row] = await db
		.update(voiceSegmentArtifact)
		.set({
			status: input.status,
			errorCode: input.errorCode,
			providerRequestId: input.providerRequestId,
			finishedAt: new Date(),
		})
		.where(
			and(
				eq(voiceSegmentArtifact.id, input.artifactId),
				eq(voiceSegmentArtifact.workspaceId, input.actor.workspaceId),
				eq(voiceSegmentArtifact.status, "pending"),
			),
		)
		.returning();
	return row ? toArtifact(row) : undefined;
}

export async function listVoiceSegmentArtifacts(
	actor: WorkspaceActor,
	projectId: string,
	segmentKey?: string,
) {
	const conditions = [
		eq(voiceSegmentArtifact.workspaceId, actor.workspaceId),
		eq(voiceSegmentArtifact.projectId, projectId),
	];
	if (segmentKey !== undefined) {
		conditions.push(eq(voiceSegmentArtifact.segmentKey, segmentKey));
	}
	const rows = await db
		.select()
		.from(voiceSegmentArtifact)
		.where(and(...conditions))
		.orderBy(
			desc(voiceSegmentArtifact.createdAt),
			desc(voiceSegmentArtifact.id),
		);
	return rows.map(toArtifact);
}

export async function getVoiceSegmentReadModel(
	actor: WorkspaceActor,
	projectId: string,
	segmentKey: string,
	currentFingerprint: VoiceSegmentFingerprint,
): Promise<VoiceSegmentArtifactReadModel> {
	const artifacts = await listVoiceSegmentArtifacts(
		actor,
		projectId,
		segmentKey,
	);
	return deriveVoiceSegmentReadModel(artifacts, currentFingerprint);
}

export async function listExpiredPendingVoiceSegmentArtifacts(
	actor: WorkspaceActor,
	now = new Date(),
) {
	const rows = await db
		.select()
		.from(voiceSegmentArtifact)
		.where(
			and(
				eq(voiceSegmentArtifact.workspaceId, actor.workspaceId),
				eq(voiceSegmentArtifact.status, "pending"),
			),
		)
		.orderBy(voiceSegmentArtifact.createdAt);
	return rows
		.map(toArtifact)
		.filter((artifact) =>
			isVoiceSegmentPendingExpired(
				artifact,
				now,
				env.VOICE_SEGMENT_PENDING_LEASE_MS,
			),
		);
}

export async function reconcileExpiredPendingVoiceSegmentArtifacts(
	actor: WorkspaceActor,
	now = new Date(),
) {
	const cutoff = new Date(now.getTime() - env.VOICE_SEGMENT_PENDING_LEASE_MS);
	const rows = await db
		.update(voiceSegmentArtifact)
		.set({
			status: "indeterminate",
			errorCode: "TTS_REQUEST_STATE_UNCERTAIN",
			finishedAt: now,
		})
		.where(
			and(
				eq(voiceSegmentArtifact.workspaceId, actor.workspaceId),
				eq(voiceSegmentArtifact.status, "pending"),
				lte(voiceSegmentArtifact.createdAt, cutoff),
			),
		)
		.returning();
	return rows.map(toArtifact);
}

export function toVoiceSegmentArtifact(row: VoiceSegmentArtifactRow) {
	return toArtifact(row);
}
