import { randomUUID } from "node:crypto";
import {
	compositionInputV1Schema,
	type RenderRequestSpecV1,
	renderRequestSpecV1Schema,
} from "@affichannel/core";
import {
	compositionVersion,
	db,
	project,
	renderArtifact,
	renderAttempt,
	renderJob,
} from "@affichannel/db";
import { and, eq, gt } from "drizzle-orm";
import { createRenderOutputStorageKey } from "../storage/render-output-storage";
import type { DbTransaction } from "./fact-dependency-repository";
import type {
	StoredRenderOutputProofV1,
	ValidatedRenderOutputMetadataV1,
} from "./render-output-validator";
import {
	RENDER_OUTPUT_PROOF_VERSION,
	RENDER_OUTPUT_VALIDATION_VERSION,
} from "./render-output-validator";
import type { WorkspaceActor } from "./workspace";

export class RenderArtifactError extends Error {
	readonly code: string;

	constructor(code: string, message = code) {
		super(message);
		this.name = "RenderArtifactError";
		this.code = code;
	}
}

export type RenderArtifactReadModel = Readonly<{
	id: string;
	workspaceId: string;
	projectId: string;
	renderJobId: string;
	renderAttemptId: string;
	attemptNumber: number;
	compositionVersionId: string;
	compositionFingerprint: string;
	canonicalRequestHash: string;
	outputEncodingProfileFingerprint: string;
	outputContractVersion: string;
	outputReservationId: string;
	storageProvider: "local" | "r2";
	storageKey: string;
	mimeType: "video/mp4";
	byteSize: number;
	checksumSha256: string;
	validationVersion: string;
	validatedMetadata: ValidatedRenderOutputMetadataV1;
	createdAt: Date;
}>;

type FinalizeInput = Readonly<{
	jobId: string;
	attemptId: string;
	attemptNumber: number;
	leaseOwner?: string;
	proof: StoredRenderOutputProofV1;
}>;

function mapArtifact(
	row: typeof renderArtifact.$inferSelect,
): RenderArtifactReadModel {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		projectId: row.projectId,
		renderJobId: row.renderJobId,
		renderAttemptId: row.renderAttemptId,
		attemptNumber: row.attemptNumber,
		compositionVersionId: row.compositionVersionId,
		compositionFingerprint: row.compositionFingerprint,
		canonicalRequestHash: row.canonicalRequestHash,
		outputEncodingProfileFingerprint: row.outputEncodingProfileFingerprint,
		outputContractVersion: row.outputContractVersion,
		outputReservationId: row.outputReservationId,
		storageProvider: row.storageProvider as "local" | "r2",
		storageKey: row.storageKey,
		mimeType: row.mimeType as "video/mp4",
		byteSize: row.byteSize,
		checksumSha256: row.checksumSha256,
		validationVersion: row.validationVersion,
		validatedMetadata:
			row.validatedMetadataJson as ValidatedRenderOutputMetadataV1,
		createdAt: row.createdAt,
	};
}

function proofMetadataMatchesRequest(
	metadata: ValidatedRenderOutputMetadataV1,
	requestSpec: RenderRequestSpecV1,
	compositionInput: ReturnType<typeof compositionInputV1Schema.parse>,
) {
	const profile = requestSpec.outputEncodingProfile;
	if (
		metadata.schemaVersion !== "render-output-metadata.v1" ||
		metadata.container !== "MP4" ||
		metadata.mimeType !== "video/mp4" ||
		metadata.videoCodec !== "H.264/AVC" ||
		metadata.width !== compositionInput.profile.logicalWidth ||
		metadata.height !== compositionInput.profile.logicalHeight ||
		metadata.frameRate.numerator !== compositionInput.timeline.fps.numerator ||
		metadata.frameRate.denominator !==
			compositionInput.timeline.fps.denominator ||
		metadata.totalFrames !== compositionInput.timeline.totalFrames ||
		metadata.audio?.codec !== profile.audioCodec ||
		(metadata.audio &&
			(metadata.audio.sampleRate !== profile.audioSampleRate ||
				metadata.audio.channels !== profile.audioChannels))
	)
		return false;
	return true;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value))
		return `[${value.map((item) => stableJson(item)).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value as Record<string, unknown>)
			.sort()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
			)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function proofMatchesArtifact(
	row: typeof renderArtifact.$inferSelect,
	proof: StoredRenderOutputProofV1,
) {
	return (
		row.outputReservationId === proof.outputReservationId &&
		row.storageProvider === proof.storageProvider &&
		row.storageKey === proof.storageKey &&
		row.mimeType === proof.mimeType &&
		row.byteSize === proof.byteSize &&
		row.checksumSha256 === proof.checksumSha256 &&
		row.validationVersion === proof.validationVersion &&
		stableJson(row.validatedMetadataJson) ===
			stableJson(proof.validatedMetadata)
	);
}

function isUniqueViolation(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}

function assertProofShape(proof: StoredRenderOutputProofV1) {
	if (
		proof.schemaVersion !== RENDER_OUTPUT_PROOF_VERSION ||
		proof.validationVersion !== RENDER_OUTPUT_VALIDATION_VERSION ||
		(proof.storageProvider !== "local" && proof.storageProvider !== "r2") ||
		proof.storageKey.length === 0 ||
		proof.mimeType !== "video/mp4" ||
		!Number.isSafeInteger(proof.byteSize) ||
		proof.byteSize <= 0 ||
		!/^[a-f0-9]{64}$/u.test(proof.checksumSha256)
	)
		throw new RenderArtifactError("RENDER_ARTIFACT_PROOF_INVALID");
}

async function loadLockedAttemptContext(
	transaction: DbTransaction,
	input: FinalizeInput,
) {
	const [job] = await transaction
		.select()
		.from(renderJob)
		.where(eq(renderJob.id, input.jobId))
		.limit(1)
		.for("update", { of: renderJob });
	if (!job) throw new RenderArtifactError("RENDER_JOB_NOT_FOUND");
	const [attempt] = await transaction
		.select()
		.from(renderAttempt)
		.where(
			and(
				eq(renderAttempt.id, input.attemptId),
				eq(renderAttempt.renderJobId, job.id),
				eq(renderAttempt.attemptNumber, input.attemptNumber),
			),
		)
		.limit(1)
		.for("update", { of: renderAttempt });
	if (!attempt) throw new RenderArtifactError("RENDER_ATTEMPT_NOT_FOUND");
	return { job, attempt };
}

async function loadExpectedComposition(
	transaction: DbTransaction,
	job: typeof renderJob.$inferSelect,
) {
	const [version] = await transaction
		.select()
		.from(compositionVersion)
		.where(eq(compositionVersion.id, job.compositionVersionId))
		.limit(1);
	if (!version) throw new RenderArtifactError("COMPOSITION_VERSION_NOT_FOUND");
	const requestSpec = renderRequestSpecV1Schema.safeParse(job.requestSpecJson);
	const compositionInput = compositionInputV1Schema.safeParse(
		version.compositionInputJson,
	);
	if (!requestSpec.success || !compositionInput.success)
		throw new RenderArtifactError("RENDER_ARTIFACT_PROVENANCE_INVALID");
	if (
		version.workspaceId !== job.workspaceId ||
		version.projectId !== job.projectId ||
		version.compositionFingerprint !== job.compositionFingerprint ||
		requestSpec.data.compositionVersionId !== job.compositionVersionId ||
		requestSpec.data.compositionFingerprint !== job.compositionFingerprint ||
		requestSpec.data.outputEncodingProfileFingerprint !==
			job.outputEncodingProfileFingerprint
	)
		throw new RenderArtifactError("RENDER_ARTIFACT_PROVENANCE_INVALID");
	return {
		requestSpec: requestSpec.data,
		compositionInput: compositionInput.data,
	};
}

async function assertNoNewerAttempt(
	transaction: DbTransaction,
	jobId: string,
	attemptNumber: number,
) {
	const [newer] = await transaction
		.select({ id: renderAttempt.id })
		.from(renderAttempt)
		.where(
			and(
				eq(renderAttempt.renderJobId, jobId),
				gt(renderAttempt.attemptNumber, attemptNumber),
			),
		)
		.limit(1);
	if (newer)
		throw new RenderArtifactError("RENDER_ARTIFACT_NEWER_ATTEMPT_EXISTS");
}

async function finalizeInTransaction(
	transaction: DbTransaction,
	input: FinalizeInput,
	mode: "NORMAL" | "RECONCILIATION",
) {
	const { job, attempt } = await loadLockedAttemptContext(transaction, input);
	if (
		attempt.attemptNumber !== input.attemptNumber ||
		job.attemptCount !== input.attemptNumber
	)
		throw new RenderArtifactError("RENDER_ARTIFACT_ATTEMPT_IDENTITY_MISMATCH");
	if (attempt.authorizedAt === null || attempt.executionStartedAt === null)
		throw new RenderArtifactError("RENDER_ARTIFACT_EXECUTION_MARKER_MISSING");
	const expectedKey = createRenderOutputStorageKey({
		workspaceId: job.workspaceId,
		projectId: job.projectId,
		renderJobId: job.id,
		renderAttemptId: attempt.id,
		outputReservationId: attempt.outputReservationId,
	});
	if (
		input.proof.outputReservationId !== attempt.outputReservationId ||
		input.proof.storageKey !== expectedKey
	)
		throw new RenderArtifactError("RENDER_ARTIFACT_OUTPUT_IDENTITY_MISMATCH");
	const expected = await loadExpectedComposition(transaction, job);
	if (
		!proofMetadataMatchesRequest(
			input.proof.validatedMetadata,
			expected.requestSpec,
			expected.compositionInput,
		)
	)
		throw new RenderArtifactError("RENDER_ARTIFACT_OUTPUT_CONTRACT_MISMATCH");
	const [existing] = await transaction
		.select()
		.from(renderArtifact)
		.where(eq(renderArtifact.renderAttemptId, attempt.id))
		.limit(1);
	if (existing && !proofMatchesArtifact(existing, input.proof))
		throw new RenderArtifactError("RENDER_ARTIFACT_CONFLICT");
	if (existing && job.status === "COMPLETED" && attempt.status === "COMPLETED")
		return mapArtifact(existing);
	if (mode === "NORMAL") {
		if (
			job.status !== "RUNNING" ||
			attempt.status !== "RUNNING" ||
			!input.leaseOwner ||
			attempt.leaseOwner !== input.leaseOwner ||
			attempt.leaseExpiresAt <= new Date()
		)
			throw new RenderArtifactError("RENDER_ARTIFACT_FENCED");
	} else {
		if (job.status !== "INDETERMINATE" || attempt.status !== "INDETERMINATE")
			throw new RenderArtifactError(
				"RENDER_ARTIFACT_RECONCILIATION_INELIGIBLE",
			);
		await assertNoNewerAttempt(transaction, job.id, attempt.attemptNumber);
	}

	if (existing) {
		const now = new Date();
		const [updatedAttempt] = await transaction
			.update(renderAttempt)
			.set({
				status: "COMPLETED",
				errorCode: null,
				errorMessage: null,
				finishedAt: now,
			})
			.where(
				and(
					eq(renderAttempt.id, attempt.id),
					eq(renderAttempt.status, attempt.status),
				),
			)
			.returning({ id: renderAttempt.id });
		if (!updatedAttempt)
			throw new RenderArtifactError("RENDER_ARTIFACT_STATE_TRANSITION_LOST");
		const [updatedJob] = await transaction
			.update(renderJob)
			.set({
				status: "COMPLETED",
				reasonCode: null,
				errorCode: null,
				errorMessage: null,
				finishedAt: now,
			})
			.where(and(eq(renderJob.id, job.id), eq(renderJob.status, job.status)))
			.returning({ id: renderJob.id });
		if (!updatedJob)
			throw new RenderArtifactError("RENDER_ARTIFACT_STATE_TRANSITION_LOST");
		return mapArtifact(existing);
	}

	const [inserted] = await transaction
		.insert(renderArtifact)
		.values({
			id: randomUUID(),
			workspaceId: job.workspaceId,
			projectId: job.projectId,
			renderJobId: job.id,
			renderAttemptId: attempt.id,
			attemptNumber: attempt.attemptNumber,
			compositionVersionId: job.compositionVersionId,
			compositionFingerprint: job.compositionFingerprint,
			canonicalRequestHash: job.canonicalRequestHash,
			outputEncodingProfileFingerprint: job.outputEncodingProfileFingerprint,
			outputContractVersion: job.outputContractVersion,
			outputReservationId: attempt.outputReservationId,
			storageProvider: input.proof.storageProvider,
			storageKey: input.proof.storageKey,
			mimeType: input.proof.mimeType,
			byteSize: input.proof.byteSize,
			checksumSha256: input.proof.checksumSha256,
			validationVersion: input.proof.validationVersion,
			validatedMetadataJson: input.proof.validatedMetadata,
		})
		.returning();
	if (!inserted) throw new RenderArtifactError("RENDER_ARTIFACT_INSERT_FAILED");
	const now = new Date();
	const [updatedAttempt] = await transaction
		.update(renderAttempt)
		.set({
			status: "COMPLETED",
			errorCode: null,
			errorMessage: null,
			finishedAt: now,
		})
		.where(
			and(
				eq(renderAttempt.id, attempt.id),
				eq(renderAttempt.status, attempt.status),
			),
		)
		.returning({ id: renderAttempt.id });
	if (!updatedAttempt)
		throw new RenderArtifactError("RENDER_ARTIFACT_STATE_TRANSITION_LOST");
	const [updatedJob] = await transaction
		.update(renderJob)
		.set({
			status: "COMPLETED",
			reasonCode: null,
			errorCode: null,
			errorMessage: null,
			finishedAt: now,
		})
		.where(and(eq(renderJob.id, job.id), eq(renderJob.status, job.status)))
		.returning({ id: renderJob.id });
	if (!updatedJob)
		throw new RenderArtifactError("RENDER_ARTIFACT_STATE_TRANSITION_LOST");
	return mapArtifact(inserted);
}

export async function finalizeRenderArtifact(input: FinalizeInput) {
	assertProofShape(input.proof);
	try {
		return await db.transaction((transaction) =>
			finalizeInTransaction(transaction, input, "NORMAL"),
		);
	} catch (error) {
		if (error instanceof RenderArtifactError || !isUniqueViolation(error))
			throw error;
		throw new RenderArtifactError("RENDER_ARTIFACT_CONFLICT");
	}
}

export async function reconcileRenderArtifact(input: FinalizeInput) {
	assertProofShape(input.proof);
	try {
		return await db.transaction((transaction) =>
			finalizeInTransaction(transaction, input, "RECONCILIATION"),
		);
	} catch (error) {
		if (error instanceof RenderArtifactError || !isUniqueViolation(error))
			throw error;
		throw new RenderArtifactError("RENDER_ARTIFACT_CONFLICT");
	}
}

export async function findRenderArtifactById(
	actor: WorkspaceActor,
	artifactId: string,
) {
	const [row] = await db
		.select({ artifact: renderArtifact })
		.from(renderArtifact)
		.innerJoin(
			project,
			and(
				eq(project.id, renderArtifact.projectId),
				eq(project.workspaceId, actor.workspaceId),
			),
		)
		.where(
			and(
				eq(renderArtifact.id, artifactId),
				eq(renderArtifact.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return row ? mapArtifact(row.artifact) : undefined;
}
