import { randomUUID } from "node:crypto";
import type {
	RenderAttemptExecutionSnapshot,
	RenderJobOperation,
	RenderRequestSpec,
	RenderRequestSpecV1,
} from "@affichannel/core";
import {
	CompositionError,
	canonicalizeCompositionJson,
	canonicalRequestHash,
	compositionInputV1Schema,
	compositionInputV2Schema,
	createQuickImageRenderPlan,
	fingerprintOutputEncodingProfile,
	fingerprintVideoOnlyOutputProfile,
	isOutputEncodingProfileComplete,
	MP4_H264_VIDEO_ONLY_V1,
	quickImageRenderRequestSchema,
	renderRequestSpecV1Schema,
	sha256Hex,
	validateRenderLeaseConfiguration,
} from "@affichannel/core";
import {
	compositionVersion,
	db,
	project,
	renderArtifact,
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
import {
	preflightCompositionVersion,
	preflightCompositionVersionInTransaction,
} from "./composition-preflight-service";
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
	requestSpec: RenderRequestSpec;
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
	const requestSpec = parseRenderRequest(row.requestSpecJson);
	if (!requestSpec) throw new RenderJobError("RENDER_JOB_DATA_INVALID");
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

function parseRenderRequest(value: unknown):
	| { data: RenderRequestSpecV1 }
	| {
			data: Extract<
				RenderRequestSpec,
				{ schemaVersion: "render-request.quick-image.v1" }
			>;
	  }
	| undefined {
	const v1 = renderRequestSpecV1Schema.safeParse(value);
	if (v1.success) return { data: v1.data };
	const quickImage = quickImageRenderRequestSchema.safeParse(value);
	return quickImage.success ? { data: quickImage.data } : undefined;
}

/** D2 job identity adds the version ID without changing the accepted D1 request fingerprint. */
export async function canonicalQuickImageRenderJobRequestHash(
	request: Extract<
		RenderRequestSpec,
		{ schemaVersion: "render-request.quick-image.v1" }
	>,
) {
	const parsed = quickImageRenderRequestSchema.parse(request);
	return sha256Hex(
		canonicalizeCompositionJson({
			inputVersion: "render-job.render-request.quick-image.v1",
			compositionVersionId: parsed.compositionVersionId,
			compositionFingerprint: parsed.compositionFingerprint,
			requestVersion: parsed.schemaVersion,
			renderPlanFingerprint: parsed.renderPlanFingerprint,
			outputProfileFingerprint: parsed.outputProfileFingerprint,
			outputContractVersion: parsed.outputContractVersion,
		}),
	);
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

function renderAgainSourceCompatibilityMatches(
	source: typeof renderJob.$inferSelect,
	requestSpec: RenderRequestSpecV1,
	canonicalHash: string,
) {
	return (
		source.compositionVersionId === requestSpec.compositionVersionId &&
		source.compositionFingerprint === requestSpec.compositionFingerprint &&
		source.canonicalRequestHash === canonicalHash &&
		source.outputEncodingProfileFingerprint ===
			requestSpec.outputEncodingProfileFingerprint &&
		source.outputContractVersion === requestSpec.outputContractVersion
	);
}

async function assertRenderAgainSourceInTransaction(
	transaction: DbTransaction,
	input: {
		actor: WorkspaceActor;
		projectId: string;
		sourceRenderJobId: string;
		requestSpec: RenderRequestSpecV1;
		canonicalHash: string;
	},
) {
	const [source] = await transaction
		.select()
		.from(renderJob)
		.where(
			and(
				eq(renderJob.id, input.sourceRenderJobId),
				eq(renderJob.workspaceId, input.actor.workspaceId),
				eq(renderJob.projectId, input.projectId),
			),
		)
		.limit(1);
	if (source?.status !== "COMPLETED")
		throw new RenderJobError("RENDER_AGAIN_SOURCE_NOT_COMPLETED");
	if (
		!renderAgainSourceCompatibilityMatches(
			source,
			input.requestSpec,
			input.canonicalHash,
		)
	)
		throw new RenderJobError("RENDER_AGAIN_SOURCE_IDENTITY_MISMATCH");
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

/**
 * Discovers only persisted Quick Image jobs for one exact frozen composition.
 * Active work wins; otherwise a completed job with an artifact wins over an
 * older failed/terminal job. This is deliberately not a latest-version query.
 */
export async function findLatestQuickImageRenderForComposition(
	actor: WorkspaceActor,
	input: { projectId: string; compositionVersionId: string },
): Promise<RenderJobReadModel | undefined> {
	const rows = await db
		.select({ job: renderJob })
		.from(renderJob)
		.leftJoin(
			renderArtifact,
			and(
				eq(renderArtifact.renderJobId, renderJob.id),
				eq(renderArtifact.workspaceId, actor.workspaceId),
			),
		)
		.where(
			and(
				eq(renderJob.workspaceId, actor.workspaceId),
				eq(renderJob.projectId, input.projectId),
				eq(renderJob.compositionVersionId, input.compositionVersionId),
			),
		)
		.orderBy(
			sql`case
				when ${renderJob.status} in ('QUEUED', 'RUNNING', 'BLOCKED', 'INDETERMINATE') then 0
				when ${renderJob.status} = 'COMPLETED' and ${renderArtifact.id} is not null then 1
				else 2
			end`,
			desc(renderJob.createdAt),
			desc(renderJob.id),
		);
	for (const row of rows) {
		if (
			quickImageRenderRequestSchema.safeParse(row.job.requestSpecJson).success
		)
			return mapJob(row.job);
	}
	return undefined;
}

/** Returns only the latest persisted attempt in the caller's project scope. */
export async function findLatestRenderAttempt(
	actor: WorkspaceActor,
	input: { projectId: string; jobId: string },
): Promise<RenderAttemptReadModel | undefined> {
	const [row] = await db
		.select({ attempt: renderAttempt })
		.from(renderAttempt)
		.innerJoin(renderJob, eq(renderJob.id, renderAttempt.renderJobId))
		.where(
			and(
				eq(renderJob.id, input.jobId),
				eq(renderJob.workspaceId, actor.workspaceId),
				eq(renderJob.projectId, input.projectId),
				eq(renderAttempt.workspaceId, actor.workspaceId),
			),
		)
		.orderBy(desc(renderAttempt.attemptNumber), desc(renderAttempt.id))
		.limit(1);
	return row ? mapAttempt(row.attempt) : undefined;
}

export async function createRenderJob(input: {
	actor: WorkspaceActor;
	projectId: string;
	requestSpec: unknown;
	idempotencyKey: string;
	operation?: RenderJobOperation;
	sourceRenderJobId?: string | null;
}): Promise<RenderJobReadModel> {
	const parsedRequest = parseRenderRequest(input.requestSpec);
	if (!parsedRequest) {
		throw new RenderJobError("RENDER_REQUEST_PROFILE_INVALID");
	}
	const requestSpec = parsedRequest.data;
	const isQuickImage =
		requestSpec.schemaVersion === "render-request.quick-image.v1";
	if (isQuickImage) {
		if (input.operation === "RENDER_AGAIN")
			throw new RenderJobError("QUICK_IMAGE_RENDER_AGAIN_UNSUPPORTED");
		if (
			(await fingerprintVideoOnlyOutputProfile(requestSpec.outputProfile)) !==
			requestSpec.outputProfileFingerprint
		)
			throw new RenderJobError("RENDER_REQUEST_PROFILE_INVALID");
	} else {
		if (!isOutputEncodingProfileComplete(requestSpec.outputEncodingProfile)) {
			throw new RenderJobError("OUTPUT_ENCODING_PROFILE_INCOMPLETE");
		}
		const expectedProfileFingerprint = await fingerprintOutputEncodingProfile(
			requestSpec.outputEncodingProfile,
		);
		if (
			expectedProfileFingerprint !==
			requestSpec.outputEncodingProfileFingerprint
		) {
			throw new RenderJobError("RENDER_REQUEST_PROFILE_INVALID");
		}
	}
	const canonicalHash = isQuickImage
		? await canonicalQuickImageRenderJobRequestHash(requestSpec)
		: await canonicalRequestHash(requestSpec);
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
		if (requestSpec.schemaVersion !== "render-request.v1")
			throw new RenderJobError("QUICK_IMAGE_RENDER_AGAIN_UNSUPPORTED");
		// Source validation is deliberately completed before any idempotency or
		// active-dedup lookup. A bad source must never be accepted by an
		// unrelated active semantic Job.
		await db.transaction((transaction) =>
			assertRenderAgainSourceInTransaction(transaction, {
				actor: input.actor,
				projectId: input.projectId,
				sourceRenderJobId: sourceRenderJobId as string,
				requestSpec,
				canonicalHash,
			}),
		);
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
			if (isQuickImage) {
				if (version.schemaVersion !== "composition-input.v2")
					throw new RenderJobError("QUICK_IMAGE_COMPOSITION_INVALID");
				let plan: Awaited<ReturnType<typeof createQuickImageRenderPlan>>;
				try {
					plan = await createQuickImageRenderPlan({
						compositionVersionId: version.id,
						compositionFingerprint: version.compositionFingerprint,
						compositionInput: version.compositionInput,
						outputProfile: requestSpec.outputProfile,
						outputProfileFingerprint: requestSpec.outputProfileFingerprint,
					});
				} catch {
					throw new RenderJobError("QUICK_IMAGE_COMPOSITION_INVALID");
				}
				if (plan.planFingerprint !== requestSpec.renderPlanFingerprint)
					throw new RenderJobError("QUICK_IMAGE_PLAN_IDENTITY_MISMATCH");
			}
			if (operation === "RENDER_AGAIN") {
				if (requestSpec.schemaVersion !== "render-request.v1")
					throw new RenderJobError("QUICK_IMAGE_RENDER_AGAIN_UNSUPPORTED");
				await assertRenderAgainSourceInTransaction(transaction, {
					actor: input.actor,
					projectId: input.projectId,
					sourceRenderJobId: sourceRenderJobId as string,
					requestSpec,
					canonicalHash,
				});
			}

			const renderJobValues = {
				id: randomUUID(),
				workspaceId: input.actor.workspaceId,
				projectId: input.projectId,
				compositionVersionId: requestSpec.compositionVersionId,
				compositionFingerprint: requestSpec.compositionFingerprint,
				canonicalRequestHash: canonicalHash,
				requestSpecJson: requestSpec,
				outputEncodingProfileJson: isQuickImage
					? requestSpec.outputProfile
					: requestSpec.outputEncodingProfile,
				outputEncodingProfileFingerprint: isQuickImage
					? requestSpec.outputProfileFingerprint
					: requestSpec.outputEncodingProfileFingerprint,
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
	// Candidate discovery intentionally takes no conflicting lock. Every
	// mutation then acquires RenderJob first and RenderAttempt second.
	const [candidate] = await transaction
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
		.limit(1);
	if (!candidate) return;
	const [job] = await transaction
		.select()
		.from(renderJob)
		.where(
			and(
				eq(renderJob.id, candidate.renderJobId),
				eq(renderJob.workspaceId, workspaceId),
				eq(renderJob.status, "RUNNING"),
			),
		)
		.limit(1)
		.for("update", { of: renderJob });
	if (!job) return;
	const [expired] = await transaction
		.select()
		.from(renderAttempt)
		.where(
			and(
				eq(renderAttempt.id, candidate.id),
				eq(renderAttempt.renderJobId, job.id),
				eq(renderAttempt.workspaceId, workspaceId),
				eq(renderAttempt.status, "RUNNING"),
				lte(renderAttempt.leaseExpiresAt, sql`now()`),
			),
		)
		.limit(1)
		.for("update", { of: renderAttempt });
	if (!expired || job.attemptCount !== expired.attemptNumber) return;
	const now = new Date();
	const terminalAfterStart = expired.executionStartedAt !== null;
	const [fencedAttempt] = await transaction
		.update(renderAttempt)
		.set({
			status: terminalAfterStart ? "INDETERMINATE" : "FENCED",
			errorCode: "LEASE_EXPIRED",
			errorMessage: terminalAfterStart
				? "Lease lost after execution started; output proof is unresolved."
				: "Lease expired before execution started.",
			finishedAt: now,
		})
		.where(
			and(
				eq(renderAttempt.id, expired.id),
				eq(renderAttempt.renderJobId, job.id),
				eq(renderAttempt.attemptNumber, expired.attemptNumber),
				eq(renderAttempt.status, "RUNNING"),
			),
		)
		.returning({ id: renderAttempt.id });
	if (!fencedAttempt) return;
	const [updatedJob] = await transaction
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
				eq(renderJob.id, job.id),
				eq(renderJob.attemptCount, expired.attemptNumber),
				eq(renderJob.status, "RUNNING"),
			),
		)
		.returning({ id: renderJob.id });
	if (!updatedJob) throw new RenderJobError("RENDER_LEASE_RECONCILE_CONFLICT");
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
	attemptNumber: number;
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
				eq(renderAttempt.attemptNumber, input.attemptNumber),
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
	| { kind: "RETRYABLE"; reason: string }
	| { kind: "NOT_CLAIMED" };

export async function authorizeAttemptInTransaction(input: {
	transaction: DbTransaction;
	actor: WorkspaceActor;
	jobId: string;
	attemptId: string;
	attemptNumber: number;
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
				eq(renderAttempt.attemptNumber, input.attemptNumber),
				eq(renderAttempt.workspaceId, input.actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: renderAttempt });
	if (
		!job ||
		!attempt ||
		job.status !== "RUNNING" ||
		job.attemptCount !== attempt.attemptNumber ||
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

	let gate: CompositionBusinessPreflight;
	try {
		gate = await input.businessGate(input.transaction);
	} catch (error) {
		const failure = classifyBusinessPreflightFailure(error);
		const fenced = await fenceLockedAttemptAndJob(input.transaction, {
			jobId: job.id,
			attemptId: attempt.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner: input.leaseOwner,
			reasonCode: failure.reason,
			jobStatus: failure.jobStatus,
		});
		if (!fenced) return { kind: "NOT_CLAIMED" };
		if (failure.jobStatus === "FAILED") return { kind: "STALE" };
		if (failure.jobStatus === "BLOCKED") return { kind: "BLOCKED" };
		return { kind: "RETRYABLE", reason: failure.reason };
	}
	if (gate.currentness.state === "UNKNOWN") {
		const fenced = await fenceLockedAttemptAndJob(input.transaction, {
			jobId: job.id,
			attemptId: attempt.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner: input.leaseOwner,
			reasonCode: gate.currentness.reason,
			jobStatus: "QUEUED",
		});
		if (!fenced) return { kind: "NOT_CLAIMED" };
		return { kind: "RETRYABLE", reason: gate.currentness.reason };
	}
	if (gate.currentness.state === "STALE") {
		const fenced = await fenceLockedAttemptAndJob(input.transaction, {
			jobId: job.id,
			attemptId: attempt.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner: input.leaseOwner,
			reasonCode: "COMPOSITION_STALE",
			jobStatus: "FAILED",
		});
		if (!fenced) return { kind: "NOT_CLAIMED" };
		return { kind: "STALE" };
	}
	if (!gate.authorization.allowed) {
		const fenced = await fenceLockedAttemptAndJob(input.transaction, {
			jobId: job.id,
			attemptId: attempt.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner: input.leaseOwner,
			reasonCode: gate.authorization.reasonCode,
			jobStatus: "BLOCKED",
		});
		if (!fenced) return { kind: "NOT_CLAIMED" };
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
				eq(renderAttempt.renderJobId, job.id),
				eq(renderAttempt.attemptNumber, attempt.attemptNumber),
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

function classifyBusinessPreflightFailure(error: unknown): {
	reason: string;
	jobStatus: "QUEUED" | "BLOCKED" | "FAILED";
} {
	const reason =
		error instanceof CompositionError
			? error.code
			: error instanceof Error && error.name === "CompositionError"
				? error.message
				: "COMPOSITION_CURRENTNESS_UNKNOWN";
	if (reason === "COMPOSITION_EXECUTION_BLOCKED")
		return { reason, jobStatus: "BLOCKED" };
	if (
		reason === "COMPOSITION_STALE" ||
		reason === "COMPOSITION_VERSION_NOT_FOUND" ||
		reason === "COMPOSITION_SCOPE_MISMATCH" ||
		reason === "COMPOSITION_INPUT_INVALID" ||
		reason === "COMPOSITION_INPUT_INCOMPLETE"
	)
		return { reason, jobStatus: "FAILED" };
	return { reason, jobStatus: "QUEUED" };
}

type FencedAttemptAndJobInput = {
	jobId: string;
	attemptId: string;
	attemptNumber: number;
	leaseOwner: string;
	reasonCode: string;
	jobStatus: "QUEUED" | "BLOCKED" | "FAILED";
};

async function fenceLockedAttemptAndJob(
	transaction: DbTransaction,
	input: FencedAttemptAndJobInput,
) {
	const now = new Date();
	const [fencedAttempt] = await transaction
		.update(renderAttempt)
		.set({ status: "FENCED", errorCode: input.reasonCode, finishedAt: now })
		.where(
			and(
				eq(renderAttempt.id, input.attemptId),
				eq(renderAttempt.renderJobId, input.jobId),
				eq(renderAttempt.attemptNumber, input.attemptNumber),
				eq(renderAttempt.leaseOwner, input.leaseOwner),
				eq(renderAttempt.status, "RUNNING"),
				isNull(renderAttempt.executionStartedAt),
				gt(renderAttempt.leaseExpiresAt, sql`now()`),
			),
		)
		.returning({ id: renderAttempt.id });
	if (!fencedAttempt) return false;
	const [updatedJob] = await transaction
		.update(renderJob)
		.set({
			status: input.jobStatus,
			reasonCode: input.reasonCode,
			errorCode: input.reasonCode,
			finishedAt:
				input.jobStatus === "BLOCKED" || input.jobStatus === "QUEUED"
					? null
					: now,
		})
		.where(
			and(
				eq(renderJob.id, input.jobId),
				eq(renderJob.attemptCount, input.attemptNumber),
				eq(renderJob.status, "RUNNING"),
			),
		)
		.returning({ id: renderJob.id });
	if (!updatedJob) throw new RenderJobError("RENDER_STATE_TRANSITION_LOST");
	return true;
}

export async function authorizeAttempt(input: {
	actor: WorkspaceActor;
	jobId: string;
	attemptId: string;
	attemptNumber: number;
	leaseOwner: string;
	technicalEvidenceFingerprint: string;
	businessGate: (
		transaction: DbTransaction,
	) => Promise<CompositionBusinessPreflight>;
}): Promise<FinalGateOutcome> {
	try {
		return await db.transaction((transaction) =>
			authorizeAttemptInTransaction({ ...input, transaction }),
		);
	} catch (error) {
		// If a database/preflight exception aborted the transaction that held the
		// locks, make one owner-locked attempt to fence the pre-execution state.
		const failure = classifyBusinessPreflightFailure(error);
		try {
			const fenced = await transitionOwnedAttemptAndJob({
				jobId: input.jobId,
				attemptId: input.attemptId,
				attemptNumber: input.attemptNumber,
				leaseOwner: input.leaseOwner,
				attemptStatus: "FENCED",
				jobStatus: failure.jobStatus,
				errorCode: failure.reason,
			});
			if (!fenced) return { kind: "NOT_CLAIMED" };
			if (failure.jobStatus === "FAILED") return { kind: "STALE" };
			if (failure.jobStatus === "BLOCKED") return { kind: "BLOCKED" };
			return { kind: "RETRYABLE", reason: failure.reason };
		} catch {
			return { kind: "NOT_CLAIMED" };
		}
	}
}

export type RequeueBlockedRenderJobOutcome =
	| { kind: "QUEUED"; job: RenderJobReadModel }
	| { kind: "BLOCKED"; job: RenderJobReadModel; reason: string }
	| { kind: "FAILED"; job: RenderJobReadModel; reason: string }
	| { kind: "RETRYABLE"; job: RenderJobReadModel; reason: string }
	| { kind: "ACTIVE_ATTEMPT"; job: RenderJobReadModel }
	| { kind: "NOT_FOUND" };

type RequeueBusinessGate = (
	transaction: DbTransaction,
	actor: WorkspaceActor,
	compositionVersionId: string,
) => Promise<CompositionBusinessPreflight>;

/** Reopens only a business-blocked Job; the next claim creates a new Attempt. */
export async function requeueBlockedRenderJob(
	actor: WorkspaceActor,
	jobId: string,
	businessGate: RequeueBusinessGate = (
		transaction,
		gateActor,
		compositionVersionId,
	) =>
		preflightCompositionVersionInTransaction(
			transaction,
			gateActor,
			compositionVersionId,
		),
): Promise<RequeueBlockedRenderJobOutcome> {
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
		if (job?.status !== "BLOCKED") return { kind: "NOT_FOUND" };
		const [activeAttempt] = await transaction
			.select()
			.from(renderAttempt)
			.where(
				and(
					eq(renderAttempt.workspaceId, actor.workspaceId),
					eq(renderAttempt.renderJobId, job.id),
					eq(renderAttempt.status, "RUNNING"),
				),
			)
			.limit(1);
		if (activeAttempt) return { kind: "ACTIVE_ATTEMPT", job: mapJob(job) };

		const requestSpec = renderRequestSpecV1Schema.safeParse(
			job.requestSpecJson,
		);
		const [version] = await transaction
			.select({
				id: compositionVersion.id,
				projectId: compositionVersion.projectId,
				compositionFingerprint: compositionVersion.compositionFingerprint,
			})
			.from(compositionVersion)
			.where(
				and(
					eq(compositionVersion.id, job.compositionVersionId),
					eq(compositionVersion.workspaceId, actor.workspaceId),
					eq(compositionVersion.projectId, job.projectId),
				),
			)
			.limit(1);
		if (
			!requestSpec.success ||
			!version ||
			version.compositionFingerprint !== job.compositionFingerprint
		)
			return await failBlockedJobInTransaction(
				transaction,
				job,
				"COMPOSITION_VERSION_IDENTITY_MISMATCH",
			);

		let gate: CompositionBusinessPreflight;
		try {
			gate = await businessGate(transaction, actor, job.compositionVersionId);
		} catch (error) {
			const failure = classifyBusinessPreflightFailure(error);
			if (failure.jobStatus === "FAILED")
				return await failBlockedJobInTransaction(
					transaction,
					job,
					failure.reason,
				);
			if (failure.jobStatus === "BLOCKED")
				return {
					kind: "BLOCKED",
					job: mapJob(job),
					reason: failure.reason,
				};
			return {
				kind: "RETRYABLE",
				job: mapJob(job),
				reason: failure.reason,
			};
		}
		if (gate.currentness.state === "STALE")
			return await failBlockedJobInTransaction(
				transaction,
				job,
				gate.currentness.reason ?? "COMPOSITION_STALE",
			);
		if (gate.currentness.state === "UNKNOWN")
			return {
				kind: "RETRYABLE",
				job: mapJob(job),
				reason: gate.currentness.reason,
			};
		if (!gate.authorization.allowed)
			return {
				kind: "BLOCKED",
				job: mapJob(job),
				reason: gate.authorization.reasonCode,
			};

		const [requeued] = await transaction
			.update(renderJob)
			.set({
				status: "QUEUED",
				reasonCode: "BLOCKED_REQUEUE_REQUESTED",
				errorCode: null,
				errorMessage: null,
				finishedAt: null,
			})
			.where(
				and(
					eq(renderJob.id, job.id),
					eq(renderJob.workspaceId, actor.workspaceId),
					eq(renderJob.status, "BLOCKED"),
				),
			)
			.returning();
		if (!requeued) return { kind: "NOT_FOUND" };
		return { kind: "QUEUED", job: mapJob(requeued) };
	});
}

async function failBlockedJobInTransaction(
	transaction: DbTransaction,
	job: typeof renderJob.$inferSelect,
	reason: string,
): Promise<Extract<RequeueBlockedRenderJobOutcome, { kind: "FAILED" }>> {
	const now = new Date();
	const [failed] = await transaction
		.update(renderJob)
		.set({
			status: "FAILED",
			reasonCode: reason,
			errorCode: reason,
			errorMessage: reason,
			finishedAt: now,
		})
		.where(and(eq(renderJob.id, job.id), eq(renderJob.status, "BLOCKED")))
		.returning();
	if (!failed) throw new RenderJobError("RENDER_STATE_TRANSITION_LOST");
	return { kind: "FAILED", job: mapJob(failed), reason };
}

export async function markExecutionStarted(input: {
	jobId: string;
	attemptId: string;
	attemptNumber: number;
	leaseOwner: string;
}) {
	return db.transaction(async (transaction) => {
		const [job] = await transaction
			.select({
				status: renderJob.status,
				attemptCount: renderJob.attemptCount,
			})
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
					eq(renderAttempt.attemptNumber, input.attemptNumber),
				),
			)
			.limit(1)
			.for("update", { of: renderAttempt });
		if (
			job?.status !== "RUNNING" ||
			job?.attemptCount !== attempt?.attemptNumber ||
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
					eq(renderAttempt.renderJobId, input.jobId),
					eq(renderAttempt.attemptNumber, input.attemptNumber),
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

/**
 * Records a pre-execution capability block using the existing fenced-attempt
 * state. This is the fail-closed boundary for unapproved Quick Image live
 * execution; it never marks execution as started.
 */
export async function blockRenderAttemptBeforeExecution(
	input: AttemptMutationInput,
) {
	return updateAttemptAndJob({
		...input,
		attemptStatus: "FENCED",
		jobStatus: "BLOCKED",
		beforeExecutionOnly: true,
	});
}

/** Handles an explicit adapter capability block without introducing a status. */
export async function blockRenderAttempt(input: AttemptMutationInput) {
	return updateAttemptAndJob({
		...input,
		attemptStatus: "FENCED",
		jobStatus: "BLOCKED",
		allowPostExecutionRetry: true,
	});
}

export async function heartbeatRenderAttempt(input: {
	attemptId: string;
	jobId: string;
	attemptNumber: number;
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
				eq(renderAttempt.attemptNumber, input.attemptNumber),
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
		attemptNumber: number;
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
				eq(renderAttempt.attemptNumber, input.attemptNumber),
				eq(renderAttempt.workspaceId, actor.workspaceId),
				eq(renderAttempt.leaseOwner, input.leaseOwner),
				eq(renderAttempt.status, "RUNNING"),
				eq(renderJob.status, "RUNNING"),
				eq(renderJob.attemptCount, input.attemptNumber),
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
	const requestSpec = parseRenderRequest(row.job.requestSpecJson)?.data;
	if (!requestSpec)
		throw new RenderJobError("RENDER_EXECUTION_IDENTITY_MISMATCH");
	if (
		row.version.id !== row.job.compositionVersionId ||
		row.version.workspaceId !== row.job.workspaceId ||
		row.version.projectId !== row.job.projectId ||
		row.version.compositionFingerprint !== row.job.compositionFingerprint ||
		requestSpec.compositionVersionId !== row.job.compositionVersionId ||
		requestSpec.compositionFingerprint !== row.job.compositionFingerprint
	)
		throw new RenderJobError("RENDER_EXECUTION_IDENTITY_MISMATCH");

	let compositionInput:
		| ReturnType<typeof compositionInputV1Schema.parse>
		| ReturnType<typeof compositionInputV2Schema.parse>;
	let renderKind: "T09" | "QUICK_IMAGE" = "T09";
	let quickImagePlan:
		| Awaited<ReturnType<typeof createQuickImageRenderPlan>>
		| undefined;
	if (requestSpec.schemaVersion === "render-request.quick-image.v1") {
		renderKind = "QUICK_IMAGE";
		if (row.version.schemaVersion !== "composition-input.v2")
			throw new RenderJobError("RENDER_EXECUTION_SCHEMA_UNSUPPORTED");
		compositionInput = compositionInputV2Schema.parse(
			row.version.compositionInputJson,
		);
		const source = compositionInput.source;
		if (
			row.version.sourceKind !== "QUICK_IMAGE" ||
			row.version.sourceScriptVersionId !== null ||
			row.version.sourceScriptRevision !== null ||
			row.version.sourceMediaAssetId !== source.mediaAssetId ||
			row.version.sourceMediaChecksumSha256 !== source.checksumSha256 ||
			row.version.sourceMediaStorageProvider !== source.storageProvider ||
			row.version.sourceMediaStorageKey !== source.storageKey ||
			row.version.sourceMediaMimeType !== source.mimeType ||
			row.version.sourceMediaByteSize !== source.byteSize ||
			row.version.sourceMediaWidth !== source.width ||
			row.version.sourceMediaHeight !== source.height
		)
			throw new RenderJobError("RENDER_EXECUTION_IDENTITY_MISMATCH");
		if (
			(await fingerprintVideoOnlyOutputProfile(requestSpec.outputProfile)) !==
				requestSpec.outputProfileFingerprint ||
			requestSpec.outputProfileFingerprint !==
				(await fingerprintVideoOnlyOutputProfile(MP4_H264_VIDEO_ONLY_V1)) ||
			row.job.outputEncodingProfileFingerprint !==
				requestSpec.outputProfileFingerprint ||
			row.job.outputContractVersion !== requestSpec.outputContractVersion
		)
			throw new RenderJobError("RENDER_EXECUTION_IDENTITY_MISMATCH");
		try {
			quickImagePlan = await createQuickImageRenderPlan({
				compositionVersionId: row.job.compositionVersionId,
				compositionFingerprint: row.job.compositionFingerprint,
				compositionInput,
				outputProfile: requestSpec.outputProfile,
				outputProfileFingerprint: requestSpec.outputProfileFingerprint,
			});
		} catch {
			throw new RenderJobError("RENDER_EXECUTION_IDENTITY_MISMATCH");
		}
		if (
			quickImagePlan.planFingerprint !== requestSpec.renderPlanFingerprint ||
			(await canonicalQuickImageRenderJobRequestHash(requestSpec)) !==
				row.job.canonicalRequestHash
		)
			throw new RenderJobError("RENDER_EXECUTION_IDENTITY_MISMATCH");
	} else {
		compositionInput = compositionInputV1Schema.parse(
			row.version.compositionInputJson,
		);
		if (
			row.job.outputEncodingProfileFingerprint !==
				requestSpec.outputEncodingProfileFingerprint ||
			row.job.outputContractVersion !== requestSpec.outputContractVersion ||
			(await canonicalRequestHash(requestSpec)) !== row.job.canonicalRequestHash
		)
			throw new RenderJobError("RENDER_EXECUTION_IDENTITY_MISMATCH");
	}
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
			renderKind,
			quickImagePlan,
		},
		technicalManifest: input.technicalManifest,
		technicalEvidenceFingerprint: input.technicalEvidenceFingerprint,
	};
}

export type RenderAttemptAuthoritativeState = Readonly<{
	jobId: string;
	jobWorkspaceId: string;
	jobStatus: string;
	jobAttemptCount: number;
	attemptId: string;
	attemptJobId: string;
	attemptWorkspaceId: string;
	attemptNumber: number;
	attemptStatus: string;
	leaseOwner: string;
	leaseExpiresAt: Date;
	executionStartedAt: Date | null;
}>;

/**
 * Reads the exact Job/Attempt tuple without requiring current ownership. This
 * is used only after a worker CAS miss to distinguish a concurrent winner from
 * an unresolved state transition.
 */
export async function readRenderAttemptState(
	actor: WorkspaceActor,
	input: {
		jobId: string;
		attemptId: string;
		attemptNumber: number;
	},
): Promise<RenderAttemptAuthoritativeState | undefined> {
	const [row] = await db
		.select({
			jobId: renderJob.id,
			jobWorkspaceId: renderJob.workspaceId,
			jobStatus: renderJob.status,
			jobAttemptCount: renderJob.attemptCount,
			attemptId: renderAttempt.id,
			attemptJobId: renderAttempt.renderJobId,
			attemptWorkspaceId: renderAttempt.workspaceId,
			attemptNumber: renderAttempt.attemptNumber,
			attemptStatus: renderAttempt.status,
			leaseOwner: renderAttempt.leaseOwner,
			leaseExpiresAt: renderAttempt.leaseExpiresAt,
			executionStartedAt: renderAttempt.executionStartedAt,
		})
		.from(renderAttempt)
		.innerJoin(renderJob, eq(renderJob.id, renderAttempt.renderJobId))
		.where(
			and(
				eq(renderJob.id, input.jobId),
				eq(renderJob.workspaceId, actor.workspaceId),
				eq(renderAttempt.id, input.attemptId),
				eq(renderAttempt.renderJobId, input.jobId),
				eq(renderAttempt.workspaceId, actor.workspaceId),
				eq(renderAttempt.attemptNumber, input.attemptNumber),
			),
		)
		.limit(1);
	return row;
}

type AttemptMutationInput = {
	attemptId: string;
	jobId: string;
	attemptNumber: number;
	leaseOwner: string;
	errorCode: string;
	errorMessage?: string;
};

const DEFAULT_RENDER_LEASE_TTL_SECONDS = 300;
const DEFAULT_RENDER_HEARTBEAT_INTERVAL_SECONDS = 60;

const renderLeaseConfiguration = validateRenderLeaseConfiguration({
	leaseTtlSeconds:
		env.RENDER_LEASE_TTL_SECONDS ?? DEFAULT_RENDER_LEASE_TTL_SECONDS,
	heartbeatIntervalSeconds:
		env.RENDER_HEARTBEAT_INTERVAL_SECONDS ??
		DEFAULT_RENDER_HEARTBEAT_INTERVAL_SECONDS,
});

export function getRenderLeaseConfiguration() {
	return renderLeaseConfiguration;
}

const renderLeaseTtlSeconds = () =>
	getRenderLeaseConfiguration().leaseTtlSeconds;

async function updateAttemptAndJob(
	input: AttemptMutationInput & {
		attemptStatus: "FAILED" | "INDETERMINATE" | "FENCED";
		jobStatus: "FAILED" | "INDETERMINATE" | "QUEUED" | "BLOCKED";
		beforeExecutionOnly?: boolean;
		allowPostExecutionRetry?: boolean;
		errorCode: string;
		errorMessage?: string;
	},
) {
	return db.transaction(async (transaction) => {
		// Canonical lock order: RenderJob first, RenderAttempt second.
		const [job] = await transaction
			.select()
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
					eq(renderAttempt.attemptNumber, input.attemptNumber),
					eq(renderAttempt.leaseOwner, input.leaseOwner),
					eq(renderAttempt.status, "RUNNING"),
					gt(renderAttempt.leaseExpiresAt, sql`now()`),
				),
			)
			.limit(1)
			.for("update", { of: renderAttempt });
		if (
			!job ||
			!attempt ||
			job.status !== "RUNNING" ||
			job.attemptCount !== attempt.attemptNumber ||
			attempt.workspaceId !== job.workspaceId ||
			(input.beforeExecutionOnly === true &&
				attempt.executionStartedAt !== null)
		)
			return false;
		const executionStarted = attempt.executionStartedAt !== null;
		const now = new Date();
		let attemptStatus = input.attemptStatus;
		let jobStatus = input.jobStatus;
		if (
			attemptStatus === "FENCED" &&
			executionStarted &&
			input.allowPostExecutionRetry !== true
		) {
			attemptStatus = "INDETERMINATE";
			jobStatus = "INDETERMINATE";
		}
		const [updatedAttempt] = await transaction
			.update(renderAttempt)
			.set({
				status: attemptStatus,
				errorCode: input.errorCode,
				errorMessage: input.errorMessage ?? null,
				finishedAt: now,
			})
			.where(
				and(
					eq(renderAttempt.id, attempt.id),
					eq(renderAttempt.renderJobId, job.id),
					eq(renderAttempt.attemptNumber, attempt.attemptNumber),
					eq(renderAttempt.leaseOwner, input.leaseOwner),
					eq(renderAttempt.status, "RUNNING"),
				),
			)
			.returning({ id: renderAttempt.id });
		if (!updatedAttempt) return false;
		const [updatedJob] = await transaction
			.update(renderJob)
			.set({
				status: jobStatus,
				reasonCode: input.errorCode,
				errorCode: input.errorCode,
				errorMessage: input.errorMessage ?? null,
				finishedAt:
					jobStatus === "QUEUED" || jobStatus === "BLOCKED" ? null : now,
			})
			.where(
				and(
					eq(renderJob.id, job.id),
					eq(renderJob.attemptCount, attempt.attemptNumber),
					eq(renderJob.status, "RUNNING"),
				),
			)
			.returning({ id: renderJob.id });
		if (!updatedJob) throw new RenderJobError("RENDER_STATE_TRANSITION_LOST");
		return true;
	});
}

const transitionOwnedAttemptAndJob = updateAttemptAndJob;

export async function failTechnical(input: AttemptMutationInput) {
	return updateAttemptAndJob({
		...input,
		attemptStatus: "FAILED",
		jobStatus: "FAILED",
		beforeExecutionOnly: true,
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
		attemptStatus: "FENCED",
		jobStatus: "QUEUED",
		allowPostExecutionRetry: true,
	});
}
