import { randomUUID } from "node:crypto";
import type {
	RenderAttemptExecutionSnapshot,
	RenderJobOperation,
	RenderRequestSpecV1,
} from "@affichannel/core";
import {
	canonicalizeCompositionJson,
	canonicalRequestHash,
	compositionInputV1Schema,
	fingerprintOutputEncodingProfile,
	isOutputEncodingProfileComplete,
	renderRequestSpecV1Schema,
	sha256Hex,
} from "@affichannel/core";
import {
	compositionVersion,
	db,
	project,
	renderAttempt,
	renderJob,
} from "@affichannel/db";
import { env } from "@affichannel/env/server";
import {
	and,
	asc,
	desc,
	eq,
	gt,
	isNotNull,
	isNull,
	lte,
	sql,
} from "drizzle-orm";
import type { CompositionBusinessPreflight } from "./composition-preflight-service";
import { preflightCompositionVersion } from "./composition-preflight-service";
import { technicalPreflightCompositionVersion } from "./composition-technical-preflight-service";
import { findCompositionVersionRecordInQuery } from "./composition-version-repository";
import type { DbTransaction } from "./fact-dependency-repository";
import type { WorkspaceActor } from "./workspace";

export class RenderJobError extends Error {
	readonly code: string;

	constructor(code: string, message = code) {
		super(message);
		this.name = "RenderJobError";
		this.code = code;
	}
}

export type RenderJobReadModel = {
	id: string;
	workspaceId: string;
	projectId: string;
	compositionVersionId: string;
	compositionFingerprint: string;
	canonicalRequestHash: string;
	requestSpec: RenderRequestSpecV1;
	outputEncodingProfileFingerprint: string;
	outputContractVersion: string;
	operation: RenderJobOperation;
	sourceRenderJobId: string | null;
	idempotencyKey: string;
	status: string;
	attemptCount: number;
	reasonCode: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	createdAt: Date;
	finishedAt: Date | null;
};

export type RenderAttemptReadModel = {
	id: string;
	workspaceId: string;
	renderJobId: string;
	attemptNumber: number;
	status: string;
	leaseOwner: string;
	leaseExpiresAt: Date;
	claimedAt: Date;
	lastHeartbeatAt: Date;
	authorizedAt: Date | null;
	authorizationEvidenceFingerprint: string | null;
	technicalPreflightVersion: string | null;
	technicalPreflightStatus: string | null;
	technicalPreflightReasonCode: string | null;
	technicalEvidenceFingerprint: string | null;
	technicalCheckedAt: Date | null;
	executionStartedAt: Date | null;
	outputReservationId: string;
	errorCode: string | null;
	errorMessage: string | null;
	finishedAt: Date | null;
};

export type ClaimedRenderAttempt = {
	job: RenderJobReadModel;
	attempt: RenderAttemptReadModel;
};

function mapJob(row: typeof renderJob.$inferSelect): RenderJobReadModel {
	const requestSpec = renderRequestSpecV1Schema.safeParse(row.requestSpecJson);
	if (!requestSpec.success) throw new RenderJobError("RENDER_JOB_DATA_INVALID");
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		projectId: row.projectId,
		compositionVersionId: row.compositionVersionId,
		compositionFingerprint: row.compositionFingerprint,
		canonicalRequestHash: row.canonicalRequestHash,
		requestSpec: requestSpec.data,
		outputEncodingProfileFingerprint: row.outputEncodingProfileFingerprint,
		outputContractVersion: row.outputContractVersion,
		operation: row.operation as RenderJobOperation,
		sourceRenderJobId: row.sourceRenderJobId,
		idempotencyKey: row.idempotencyKey,
		status: row.status,
		attemptCount: row.attemptCount,
		reasonCode: row.reasonCode,
		errorCode: row.errorCode,
		errorMessage: row.errorMessage,
		createdAt: row.createdAt,
		finishedAt: row.finishedAt,
	};
}

function mapAttempt(
	row: typeof renderAttempt.$inferSelect,
): RenderAttemptReadModel {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		renderJobId: row.renderJobId,
		attemptNumber: row.attemptNumber,
		status: row.status,
		leaseOwner: row.leaseOwner,
		leaseExpiresAt: row.leaseExpiresAt,
		claimedAt: row.claimedAt,
		lastHeartbeatAt: row.lastHeartbeatAt,
		authorizedAt: row.authorizedAt,
		authorizationEvidenceFingerprint: row.authorizationEvidenceFingerprint,
		technicalPreflightVersion: row.technicalPreflightVersion,
		technicalPreflightStatus: row.technicalPreflightStatus,
		technicalPreflightReasonCode: row.technicalPreflightReasonCode,
		technicalEvidenceFingerprint: row.technicalEvidenceFingerprint,
		technicalCheckedAt: row.technicalCheckedAt,
		executionStartedAt: row.executionStartedAt,
		outputReservationId: row.outputReservationId,
		errorCode: row.errorCode,
		errorMessage: row.errorMessage,
		finishedAt: row.finishedAt,
	};
}

function isUniqueViolation(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}

function identityMatches(
	row: typeof renderJob.$inferSelect,
	input: {
		projectId: string;
		compositionVersionId: string;
		compositionFingerprint: string;
		canonicalRequestHash: string;
		operation: RenderJobOperation;
		sourceRenderJobId: string | null;
	},
) {
	return (
		row.projectId === input.projectId &&
		row.compositionVersionId === input.compositionVersionId &&
		row.compositionFingerprint === input.compositionFingerprint &&
		row.canonicalRequestHash === input.canonicalRequestHash &&
		row.operation === input.operation &&
		row.sourceRenderJobId === input.sourceRenderJobId
	);
}

export async function findRenderJob(
	actor: WorkspaceActor,
	jobId: string,
): Promise<RenderJobReadModel | undefined> {
	const [row] = await db
		.select()
		.from(renderJob)
		.where(
			and(
				eq(renderJob.id, jobId),
				eq(renderJob.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return row ? mapJob(row) : undefined;
}

export async function createRenderJob(input: {
	actor: WorkspaceActor;
	projectId: string;
	requestSpec: unknown;
	idempotencyKey: string;
	operation?: RenderJobOperation;
	sourceRenderJobId?: string | null;
}): Promise<RenderJobReadModel> {
	const requestSpecResult = renderRequestSpecV1Schema.safeParse(
		input.requestSpec,
	);
	if (!requestSpecResult.success) {
		throw new RenderJobError("RENDER_REQUEST_PROFILE_INVALID");
	}
	const requestSpec = requestSpecResult.data;
	if (!isOutputEncodingProfileComplete(requestSpec.outputEncodingProfile)) {
		throw new RenderJobError("OUTPUT_ENCODING_PROFILE_INCOMPLETE");
	}
	const expectedProfileFingerprint = await fingerprintOutputEncodingProfile(
		requestSpec.outputEncodingProfile,
	);
	if (
		expectedProfileFingerprint !== requestSpec.outputEncodingProfileFingerprint
	) {
		throw new RenderJobError("RENDER_REQUEST_PROFILE_INVALID");
	}
	const canonicalHash = await canonicalRequestHash(requestSpec);
	const operation = input.operation ?? "START_RENDER";
	const sourceRenderJobId = input.sourceRenderJobId ?? null;
	if (
		input.idempotencyKey.trim().length < 8 ||
		input.idempotencyKey.trim().length > 200
	) {
		throw new RenderJobError("RENDER_IDEMPOTENCY_KEY_INVALID");
	}
	if (operation === "START_RENDER" && sourceRenderJobId !== null) {
		throw new RenderJobError("RENDER_SOURCE_JOB_INVALID");
	}
	if (operation === "RENDER_AGAIN" && sourceRenderJobId === null) {
		throw new RenderJobError("RENDER_SOURCE_JOB_REQUIRED");
	}
	if (operation === "RENDER_AGAIN") {
		const business = await preflightCompositionVersion(
			input.actor,
			requestSpec.compositionVersionId,
		);
		if (business.currentness.state === "STALE")
			throw new RenderJobError("COMPOSITION_STALE");
		if (!business.authorization.allowed)
			throw new RenderJobError("RENDER_AGAIN_BUSINESS_BLOCKED");
		const technical = await technicalPreflightCompositionVersion(
			input.actor,
			requestSpec.compositionVersionId,
		);
		if (technical.status === "INVALID" || technical.status === "UNSUPPORTED")
			throw new RenderJobError(
				technical.reasonCode ?? "RENDER_AGAIN_TECHNICAL_INVALID",
			);
		if (technical.status !== "VALID")
			throw new RenderJobError("RENDER_AGAIN_TECHNICAL_UNKNOWN");
	}

	const identity = {
		projectId: input.projectId,
		compositionVersionId: requestSpec.compositionVersionId,
		compositionFingerprint: requestSpec.compositionFingerprint,
		canonicalRequestHash: canonicalHash,
		operation,
		sourceRenderJobId,
	};
	try {
		return await db.transaction(async (transaction) => {
			const existingByKey = await transaction
				.select()
				.from(renderJob)
				.where(
					and(
						eq(renderJob.workspaceId, input.actor.workspaceId),
						eq(renderJob.idempotencyKey, input.idempotencyKey.trim()),
					),
				)
				.limit(1);
			const keyed = existingByKey[0];
			if (keyed) {
				if (!identityMatches(keyed, identity)) {
					throw new RenderJobError("RENDER_IDEMPOTENCY_CONFLICT");
				}
				return mapJob(keyed);
			}

			const active = await transaction
				.select()
				.from(renderJob)
				.where(
					and(
						eq(renderJob.workspaceId, input.actor.workspaceId),
						eq(renderJob.projectId, input.projectId),
						eq(
							renderJob.compositionVersionId,
							requestSpec.compositionVersionId,
						),
						eq(renderJob.canonicalRequestHash, canonicalHash),
						sql`${renderJob.status} in ('QUEUED', 'RUNNING', 'BLOCKED', 'INDETERMINATE')`,
					),
				)
				.orderBy(desc(renderJob.createdAt), desc(renderJob.id))
				.limit(1);
			if (active[0]) return mapJob(active[0]);

			const [projectRecord] = await transaction
				.select({ id: project.id })
				.from(project)
				.where(
					and(
						eq(project.id, input.projectId),
						eq(project.workspaceId, input.actor.workspaceId),
					),
				)
				.limit(1);
			if (!projectRecord) throw new RenderJobError("PROJECT_NOT_FOUND");

			const version = await findCompositionVersionRecordInQuery(
				transaction,
				input.actor,
				requestSpec.compositionVersionId,
			);
			if (
				!version ||
				version.projectId !== input.projectId ||
				version.compositionFingerprint !== requestSpec.compositionFingerprint
			) {
				throw new RenderJobError("COMPOSITION_VERSION_IDENTITY_MISMATCH");
			}
			if (operation === "RENDER_AGAIN") {
				const [source] = await transaction
					.select()
					.from(renderJob)
					.where(
						and(
							eq(renderJob.id, sourceRenderJobId as string),
							eq(renderJob.workspaceId, input.actor.workspaceId),
							eq(renderJob.projectId, input.projectId),
						),
					)
					.limit(1);
				if (source?.status !== "COMPLETED") {
					throw new RenderJobError("RENDER_AGAIN_SOURCE_NOT_COMPLETED");
				}
				if (
					source.compositionVersionId !== requestSpec.compositionVersionId ||
					source.compositionFingerprint !== requestSpec.compositionFingerprint
				) {
					throw new RenderJobError("RENDER_AGAIN_SOURCE_IDENTITY_MISMATCH");
				}
			}

			const renderJobValues = {
				id: randomUUID(),
				workspaceId: input.actor.workspaceId,
				projectId: input.projectId,
				compositionVersionId: requestSpec.compositionVersionId,
				compositionFingerprint: requestSpec.compositionFingerprint,
				canonicalRequestHash: canonicalHash,
				requestSpecJson: requestSpec,
				outputEncodingProfileJson: requestSpec.outputEncodingProfile,
				outputEncodingProfileFingerprint:
					requestSpec.outputEncodingProfileFingerprint,
				outputContractVersion: requestSpec.outputContractVersion,
				operation,
				sourceRenderJobId,
				idempotencyKey: input.idempotencyKey.trim(),
				createdByUserId: input.actor.userId,
				createdAt: sql`now()`,
				updatedAt: sql`now()`,
			};
			const [created] = await transaction
				.insert(renderJob)
				.values(renderJobValues)
				.onConflictDoNothing()
				.returning();
			if (created) return mapJob(created);

			const [sameKey] = await transaction
				.select()
				.from(renderJob)
				.where(
					and(
						eq(renderJob.workspaceId, input.actor.workspaceId),
						eq(renderJob.idempotencyKey, input.idempotencyKey.trim()),
					),
				)
				.limit(1);
			if (sameKey) {
				if (!identityMatches(sameKey, identity)) {
					throw new RenderJobError("RENDER_IDEMPOTENCY_CONFLICT");
				}
				return mapJob(sameKey);
			}
			const [activeAfterConflict] = await transaction
				.select()
				.from(renderJob)
				.where(
					and(
						eq(renderJob.workspaceId, input.actor.workspaceId),
						eq(renderJob.projectId, input.projectId),
						eq(
							renderJob.compositionVersionId,
							requestSpec.compositionVersionId,
						),
						eq(renderJob.canonicalRequestHash, canonicalHash),
						sql`${renderJob.status} in ('QUEUED', 'RUNNING', 'BLOCKED', 'INDETERMINATE')`,
					),
				)
				.orderBy(desc(renderJob.createdAt), desc(renderJob.id))
				.limit(1);
			if (activeAfterConflict) return mapJob(activeAfterConflict);
			throw new RenderJobError("RENDER_JOB_CREATE_CONFLICT");
		});
	} catch (error) {
		if (error instanceof RenderJobError || !isUniqueViolation(error))
			throw error;
		throw new RenderJobError("RENDER_JOB_CREATE_CONFLICT");
	}
}

async function expireOneAttempt(
	transaction: DbTransaction,
	workspaceId: string,
) {
	const [expired] = await transaction
		.select()
		.from(renderAttempt)
		.where(
			and(
				eq(renderAttempt.workspaceId, workspaceId),
				eq(renderAttempt.status, "RUNNING"),
				lte(renderAttempt.leaseExpiresAt, sql`now()`),
			),
		)
		.orderBy(asc(renderAttempt.leaseExpiresAt), asc(renderAttempt.id))
		.limit(1)
		.for("update", { of: renderAttempt, skipLocked: true });
	if (!expired) return;
	const now = new Date();
	const terminalAfterStart = expired.executionStartedAt !== null;
	await transaction
		.update(renderAttempt)
		.set({
			status: terminalAfterStart ? "INDETERMINATE" : "FENCED",
			errorCode: "LEASE_EXPIRED",
			errorMessage: terminalAfterStart
				? "Lease lost after execution started; output proof is unresolved."
				: "Lease expired before execution started.",
			finishedAt: now,
		})
		.where(eq(renderAttempt.id, expired.id));
	await transaction
		.update(renderJob)
		.set({
			status: terminalAfterStart ? "INDETERMINATE" : "QUEUED",
			reasonCode: "LEASE_EXPIRED",
			errorCode: "LEASE_EXPIRED",
			errorMessage: terminalAfterStart
				? "Lease lost after execution started; output proof is unresolved."
				: "Lease expired before execution started.",
			finishedAt: terminalAfterStart ? now : null,
		})
		.where(
			and(
				eq(renderJob.id, expired.renderJobId),
				eq(renderJob.status, "RUNNING"),
			),
		);
}

export async function claimNextRenderAttempt(
	workspaceId: string,
	leaseOwner: string,
): Promise<ClaimedRenderAttempt | undefined> {
	return db.transaction(async (transaction) => {
		await expireOneAttempt(transaction, workspaceId);
		const [job] = await transaction
			.select()
			.from(renderJob)
			.where(
				and(
					eq(renderJob.workspaceId, workspaceId),
					eq(renderJob.status, "QUEUED"),
				),
			)
			.orderBy(asc(renderJob.createdAt), asc(renderJob.id))
			.limit(1)
			.for("update", { of: renderJob, skipLocked: true });
		if (!job) return undefined;
		const now = new Date();
		const attemptNumber = job.attemptCount + 1;
		const [updatedJob] = await transaction
			.update(renderJob)
			.set({
				status: "RUNNING",
				attemptCount: attemptNumber,
				reasonCode: null,
				errorCode: null,
				errorMessage: null,
			})
			.where(and(eq(renderJob.id, job.id), eq(renderJob.status, "QUEUED")))
			.returning();
		if (!updatedJob) return undefined;
		const [attempt] = await transaction
			.insert(renderAttempt)
			.values({
				id: randomUUID(),
				workspaceId,
				renderJobId: job.id,
				attemptNumber,
				leaseOwner,
				leaseExpiresAt: new Date(
					now.getTime() + renderLeaseTtlSeconds() * 1000,
				),
				claimedAt: now,
				lastHeartbeatAt: now,
				outputReservationId: randomUUID(),
			})
			.returning();
		if (!attempt) throw new RenderJobError("RENDER_ATTEMPT_CREATE_FAILED");
		return { job: mapJob(updatedJob), attempt: mapAttempt(attempt) };
	});
}

export async function recordTechnicalEvidence(input: {
	attemptId: string;
	jobId: string;
	leaseOwner: string;
	status: "VALID" | "INVALID" | "UNSUPPORTED" | "UNKNOWN";
	reasonCode: string | null;
	technicalEvidenceFingerprint: string | null;
	technicalPreflightVersion?: string;
}) {
	const [row] = await db
		.update(renderAttempt)
		.set({
			technicalPreflightVersion:
				input.technicalPreflightVersion ?? "composition-technical-preflight.v1",
			technicalPreflightStatus: input.status,
			technicalPreflightReasonCode: input.reasonCode,
			technicalEvidenceFingerprint: input.technicalEvidenceFingerprint,
			technicalCheckedAt: sql`now()`,
		})
		.where(
			and(
				eq(renderAttempt.id, input.attemptId),
				eq(renderAttempt.renderJobId, input.jobId),
				eq(renderAttempt.leaseOwner, input.leaseOwner),
				eq(renderAttempt.status, "RUNNING"),
				gt(renderAttempt.leaseExpiresAt, sql`now()`),
				isNull(renderAttempt.executionStartedAt),
				isNull(renderAttempt.authorizedAt),
			),
		)
		.returning();
	return Boolean(row);
}

type FinalGateOutcome =
	| { kind: "AUTHORIZED"; evidenceFingerprint: string }
	| { kind: "BLOCKED" }
	| { kind: "STALE" }
	| { kind: "NOT_CLAIMED" };

export async function authorizeAttemptInTransaction(input: {
	transaction: DbTransaction;
	actor: WorkspaceActor;
	jobId: string;
	attemptId: string;
	leaseOwner: string;
	technicalEvidenceFingerprint: string;
	businessGate: (
		transaction: DbTransaction,
	) => Promise<CompositionBusinessPreflight>;
}): Promise<FinalGateOutcome> {
	const [job] = await input.transaction
		.select()
		.from(renderJob)
		.where(
			and(
				eq(renderJob.id, input.jobId),
				eq(renderJob.workspaceId, input.actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: renderJob });
	const [attempt] = await input.transaction
		.select()
		.from(renderAttempt)
		.where(
			and(
				eq(renderAttempt.id, input.attemptId),
				eq(renderAttempt.renderJobId, input.jobId),
				eq(renderAttempt.workspaceId, input.actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: renderAttempt });
	if (
		!job ||
		!attempt ||
		job.status !== "RUNNING" ||
		attempt.status !== "RUNNING" ||
		attempt.leaseOwner !== input.leaseOwner ||
		attempt.executionStartedAt !== null ||
		attempt.leaseExpiresAt <= new Date() ||
		attempt.technicalPreflightStatus !== "VALID" ||
		attempt.technicalEvidenceFingerprint !== input.technicalEvidenceFingerprint
	)
		return { kind: "NOT_CLAIMED" };
	await input.transaction
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				eq(project.id, job.projectId),
				eq(project.workspaceId, input.actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: project });

	const gate = await input.businessGate(input.transaction);
	if (gate.currentness.state === "STALE") {
		await fenceLockedAttemptAndJob(
			input.transaction,
			job.id,
			attempt.id,
			"COMPOSITION_STALE",
			"FAILED",
		);
		return { kind: "STALE" };
	}
	if (!gate.authorization.allowed) {
		await fenceLockedAttemptAndJob(
			input.transaction,
			job.id,
			attempt.id,
			gate.authorization.reasonCode,
			"BLOCKED",
		);
		return { kind: "BLOCKED" };
	}
	const evidenceFingerprint = await sha256Hex(
		canonicalizeCompositionJson({
			compositionVersionId: job.compositionVersionId,
			currentness: gate.currentness,
			authorization: gate.authorization,
			factLock: {
				requirement: gate.factLock.requirement,
				outcome: gate.factLock.outcome,
			},
		}),
	);
	const [authorized] = await input.transaction
		.update(renderAttempt)
		.set({
			authorizedAt: sql`now()`,
			authorizationEvidenceFingerprint: evidenceFingerprint,
		})
		.where(
			and(
				eq(renderAttempt.id, attempt.id),
				eq(renderAttempt.status, "RUNNING"),
				eq(renderAttempt.leaseOwner, input.leaseOwner),
				isNull(renderAttempt.executionStartedAt),
				gt(renderAttempt.leaseExpiresAt, sql`now()`),
			),
		)
		.returning();
	return authorized
		? { kind: "AUTHORIZED", evidenceFingerprint }
		: { kind: "NOT_CLAIMED" };
}

async function fenceLockedAttemptAndJob(
	transaction: DbTransaction,
	jobId: string,
	attemptId: string,
	reasonCode: string,
	jobStatus: "QUEUED" | "BLOCKED" | "FAILED",
) {
	const now = new Date();
	await transaction
		.update(renderAttempt)
		.set({ status: "FENCED", errorCode: reasonCode, finishedAt: now })
		.where(
			and(eq(renderAttempt.id, attemptId), eq(renderAttempt.status, "RUNNING")),
		);
	await transaction
		.update(renderJob)
		.set({
			status: jobStatus,
			reasonCode,
			errorCode: reasonCode,
			finishedAt:
				jobStatus === "BLOCKED" || jobStatus === "QUEUED" ? null : now,
		})
		.where(eq(renderJob.id, jobId));
}

export async function authorizeAttempt(input: {
	actor: WorkspaceActor;
	jobId: string;
	attemptId: string;
	leaseOwner: string;
	technicalEvidenceFingerprint: string;
	businessGate: (
		transaction: DbTransaction,
	) => Promise<CompositionBusinessPreflight>;
}): Promise<FinalGateOutcome> {
	return db.transaction((transaction) =>
		authorizeAttemptInTransaction({ ...input, transaction }),
	);
}

/** Reopens only a business-blocked Job; the next claim creates a new Attempt. */
export async function requeueBlockedRenderJob(
	actor: WorkspaceActor,
	jobId: string,
) {
	return db.transaction(async (transaction) => {
		const [job] = await transaction
			.select()
			.from(renderJob)
			.where(
				and(
					eq(renderJob.id, jobId),
					eq(renderJob.workspaceId, actor.workspaceId),
				),
			)
			.limit(1)
			.for("update", { of: renderJob });
		if (job?.status !== "BLOCKED") return false;
		const [activeAttempt] = await transaction
			.select({ id: renderAttempt.id })
			.from(renderAttempt)
			.where(
				and(
					eq(renderAttempt.renderJobId, job.id),
					eq(renderAttempt.status, "RUNNING"),
				),
			)
			.limit(1);
		if (activeAttempt) return false;
		const [requeued] = await transaction
			.update(renderJob)
			.set({
				status: "QUEUED",
				reasonCode: "BLOCKED_REQUEUE_REQUESTED",
				errorCode: null,
				errorMessage: null,
				finishedAt: null,
			})
			.where(and(eq(renderJob.id, job.id), eq(renderJob.status, "BLOCKED")))
			.returning();
		return Boolean(requeued);
	});
}

export async function markExecutionStarted(input: {
	jobId: string;
	attemptId: string;
	leaseOwner: string;
}) {
	return db.transaction(async (transaction) => {
		const [job] = await transaction
			.select({ status: renderJob.status })
			.from(renderJob)
			.where(eq(renderJob.id, input.jobId))
			.limit(1)
			.for("update", { of: renderJob });
		const [attempt] = await transaction
			.select()
			.from(renderAttempt)
			.where(
				and(
					eq(renderAttempt.id, input.attemptId),
					eq(renderAttempt.renderJobId, input.jobId),
				),
			)
			.limit(1)
			.for("update", { of: renderAttempt });
		if (
			job?.status !== "RUNNING" ||
			attempt?.status !== "RUNNING" ||
			attempt.leaseOwner !== input.leaseOwner ||
			attempt.authorizedAt === null ||
			attempt.executionStartedAt !== null ||
			attempt.technicalPreflightStatus !== "VALID" ||
			attempt.technicalEvidenceFingerprint === null ||
			attempt.leaseExpiresAt <= new Date()
		)
			return false;
		const [started] = await transaction
			.update(renderAttempt)
			.set({ executionStartedAt: sql`now()` })
			.where(
				and(
					eq(renderAttempt.id, input.attemptId),
					eq(renderAttempt.status, "RUNNING"),
					eq(renderAttempt.leaseOwner, input.leaseOwner),
					isNull(renderAttempt.executionStartedAt),
					eq(renderAttempt.technicalPreflightStatus, "VALID"),
					isNotNull(renderAttempt.technicalEvidenceFingerprint),
					gt(renderAttempt.leaseExpiresAt, sql`now()`),
				),
			)
			.returning();
		return Boolean(started);
	});
}

export async function heartbeatRenderAttempt(input: {
	attemptId: string;
	jobId: string;
	leaseOwner: string;
}) {
	const [row] = await db
		.update(renderAttempt)
		.set({
			lastHeartbeatAt: sql`now()`,
			leaseExpiresAt: sql`now() + ${renderLeaseTtlSeconds()} * interval '1 second'`,
		})
		.where(
			and(
				eq(renderAttempt.id, input.attemptId),
				eq(renderAttempt.renderJobId, input.jobId),
				eq(renderAttempt.leaseOwner, input.leaseOwner),
				eq(renderAttempt.status, "RUNNING"),
				gt(renderAttempt.leaseExpiresAt, sql`now()`),
			),
		)
		.returning();
	return Boolean(row);
}

export async function loadExecutionSnapshot(
	actor: WorkspaceActor,
	input: {
		jobId: string;
		attemptId: string;
		leaseOwner: string;
		technicalManifest: RenderAttemptExecutionSnapshot["technicalManifest"];
		technicalEvidenceFingerprint: string;
	},
): Promise<RenderAttemptExecutionSnapshot | undefined> {
	const [row] = await db
		.select({
			attempt: renderAttempt,
			job: renderJob,
			version: compositionVersion,
		})
		.from(renderAttempt)
		.innerJoin(renderJob, eq(renderJob.id, renderAttempt.renderJobId))
		.innerJoin(
			compositionVersion,
			eq(compositionVersion.id, renderJob.compositionVersionId),
		)
		.where(
			and(
				eq(renderAttempt.id, input.attemptId),
				eq(renderAttempt.renderJobId, input.jobId),
				eq(renderAttempt.workspaceId, actor.workspaceId),
				eq(renderAttempt.leaseOwner, input.leaseOwner),
				eq(renderAttempt.status, "RUNNING"),
				eq(renderJob.status, "RUNNING"),
				gt(renderAttempt.leaseExpiresAt, sql`now()`),
				eq(
					renderAttempt.technicalEvidenceFingerprint,
					input.technicalEvidenceFingerprint,
				),
			),
		)
		.limit(1);
	if (
		!row ||
		row.attempt.authorizedAt === null ||
		row.attempt.executionStartedAt === null
	)
		return undefined;
	const requestSpec = renderRequestSpecV1Schema.parse(row.job.requestSpecJson);
	const compositionInput = compositionInputV1Schema.parse(
		row.version.compositionInputJson,
	);
	if (
		row.version.id !== row.job.compositionVersionId ||
		row.version.compositionFingerprint !== row.job.compositionFingerprint ||
		requestSpec.compositionVersionId !== row.job.compositionVersionId ||
		requestSpec.compositionFingerprint !== row.job.compositionFingerprint ||
		row.job.outputEncodingProfileFingerprint !==
			requestSpec.outputEncodingProfileFingerprint ||
		(await canonicalRequestHash(requestSpec)) !== row.job.canonicalRequestHash
	)
		throw new RenderJobError("RENDER_EXECUTION_IDENTITY_MISMATCH");
	return {
		jobId: row.job.id,
		attemptId: row.attempt.id,
		attemptNumber: row.attempt.attemptNumber,
		leaseOwner: row.attempt.leaseOwner,
		execution: {
			jobId: row.job.id,
			workspaceId: row.job.workspaceId,
			projectId: row.job.projectId,
			compositionVersionId: row.job.compositionVersionId,
			compositionFingerprint: row.job.compositionFingerprint,
			requestSpec,
			compositionInput,
			outputReservationId: row.attempt.outputReservationId,
		},
		technicalManifest: input.technicalManifest,
		technicalEvidenceFingerprint: input.technicalEvidenceFingerprint,
	};
}

type AttemptMutationInput = {
	attemptId: string;
	jobId: string;
	leaseOwner: string;
	errorCode: string;
	errorMessage?: string;
};

const DEFAULT_RENDER_LEASE_TTL_SECONDS = 300;
const DEFAULT_RENDER_HEARTBEAT_INTERVAL_SECONDS = 60;

export function getRenderLeaseConfiguration() {
	return {
		leaseTtlSeconds:
			env.RENDER_LEASE_TTL_SECONDS ?? DEFAULT_RENDER_LEASE_TTL_SECONDS,
		heartbeatIntervalSeconds:
			env.RENDER_HEARTBEAT_INTERVAL_SECONDS ??
			DEFAULT_RENDER_HEARTBEAT_INTERVAL_SECONDS,
	};
}

const renderLeaseTtlSeconds = () =>
	getRenderLeaseConfiguration().leaseTtlSeconds;

async function updateAttemptAndJob(
	input: AttemptMutationInput & {
		attemptId: string;
		jobId: string;
		leaseOwner: string;
		attemptStatus: "FAILED" | "INDETERMINATE" | "FENCED";
		jobStatus: "FAILED" | "INDETERMINATE" | "QUEUED";
		errorCode: string;
		errorMessage?: string;
	},
) {
	return db.transaction(async (transaction) => {
		const [attempt] = await transaction
			.select()
			.from(renderAttempt)
			.where(
				and(
					eq(renderAttempt.id, input.attemptId),
					eq(renderAttempt.renderJobId, input.jobId),
					eq(renderAttempt.leaseOwner, input.leaseOwner),
					eq(renderAttempt.status, "RUNNING"),
					gt(renderAttempt.leaseExpiresAt, sql`now()`),
				),
			)
			.limit(1)
			.for("update", { of: renderAttempt });
		if (!attempt) return false;
		const executionStarted = attempt.executionStartedAt !== null;
		const now = new Date();
		if (input.attemptStatus === "FENCED" && executionStarted) {
			input.attemptStatus = "INDETERMINATE";
			input.jobStatus = "INDETERMINATE";
		}
		await transaction
			.update(renderAttempt)
			.set({
				status: input.attemptStatus,
				errorCode: input.errorCode,
				errorMessage: input.errorMessage ?? null,
				finishedAt: now,
			})
			.where(eq(renderAttempt.id, attempt.id));
		await transaction
			.update(renderJob)
			.set({
				status: input.jobStatus,
				reasonCode: input.errorCode,
				errorCode: input.errorCode,
				errorMessage: input.errorMessage ?? null,
				finishedAt: input.jobStatus === "QUEUED" ? null : now,
			})
			.where(
				and(eq(renderJob.id, input.jobId), eq(renderJob.status, "RUNNING")),
			);
		return true;
	});
}

export async function failTechnical(input: AttemptMutationInput) {
	return updateAttemptAndJob({
		...input,
		attemptStatus: "FAILED",
		jobStatus: "FAILED",
	});
}

export async function fenceAndRequeue(input: AttemptMutationInput) {
	return updateAttemptAndJob({
		...input,
		attemptStatus: "FENCED",
		jobStatus: "QUEUED",
	});
}

export async function markIndeterminate(input: AttemptMutationInput) {
	return updateAttemptAndJob({
		...input,
		attemptStatus: "INDETERMINATE",
		jobStatus: "INDETERMINATE",
	});
}

export async function failJobAfterExecution(input: AttemptMutationInput) {
	return updateAttemptAndJob({
		...input,
		attemptStatus: "FAILED",
		jobStatus: "FAILED",
	});
}

export async function requeueAfterSideEffectFreeFailure(
	input: AttemptMutationInput,
) {
	return updateAttemptAndJob({
		...input,
		attemptStatus: "FAILED",
		jobStatus: "QUEUED",
	});
}
