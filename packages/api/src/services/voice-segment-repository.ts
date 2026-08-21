import type {
	VoiceSegmentArtifact,
	VoiceSegmentArtifactReadModel,
	VoiceSegmentFingerprint,
} from "@affichannel/core";
import {
	deriveVoiceSegmentReadModel,
	isVoiceSegmentPendingExpired,
} from "@affichannel/core";
import { db, voiceSegmentArtifact } from "@affichannel/db";
import { env } from "@affichannel/env/server";
import { and, desc, eq } from "drizzle-orm";

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
		.values({
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
			status: "pending",
		})
		.returning();
	if (!row) throw new Error("Voice segment artifact insert returned no row.");
	return toArtifact(row);
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

export function toVoiceSegmentArtifact(row: VoiceSegmentArtifactRow) {
	return toArtifact(row);
}
