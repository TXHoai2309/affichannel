import { randomUUID } from "node:crypto";

import {
	canonicalizeJson,
	parseScriptClaimRefreshRunRecord,
	type ScriptClaimRefreshRun,
} from "@affichannel/core";
import {
	db,
	project,
	scriptClaimRefreshRun,
	scriptVersion,
	workspace,
} from "@affichannel/db";
import { and, eq, isNull } from "drizzle-orm";

type ScriptClaimRefreshRunRow = typeof scriptClaimRefreshRun.$inferSelect;

export type ScriptClaimRefreshRepositoryTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];

export const scriptClaimRefreshRepositoryErrorCodes = [
	"SCRIPT_CLAIM_REFRESH_NOT_FOUND",
	"SCRIPT_CLAIM_REFRESH_INPUT_INVALID",
	"SCRIPT_CLAIM_REFRESH_IDEMPOTENCY_CONFLICT",
	"SCRIPT_CLAIM_REFRESH_PERSISTED_DATA_INVALID",
] as const;

export type ScriptClaimRefreshRepositoryErrorCode =
	(typeof scriptClaimRefreshRepositoryErrorCodes)[number];

export class ScriptClaimRefreshRepositoryError extends Error {
	readonly code: ScriptClaimRefreshRepositoryErrorCode;

	constructor(code: ScriptClaimRefreshRepositoryErrorCode) {
		super(code);
		this.name = "ScriptClaimRefreshRepositoryError";
		this.code = code;
	}
}

export type CreateOrReuseScriptClaimRefreshRunInput = Readonly<{
	workspaceId: string;
	projectId: string;
	scriptVersionId: string;
	sourceScriptRevision: number;
	idempotencyKey: string;
	requestHash: string;
	inputSnapshotJson: unknown;
	inputHash: string;
	sourceContentHash: string;
	promptHash: string;
	provider: string;
	model: string;
	promptVersion: string;
	outputSchemaVersion: string;
	createdByUserId: string;
}>;

export type CreateOrReuseScriptClaimRefreshRunResult = Readonly<{
	created: boolean;
	run: ScriptClaimRefreshRun;
}>;

const SHA256 = /^[0-9a-f]{64}$/;

function repositoryInputInvalid(): ScriptClaimRefreshRepositoryError {
	return new ScriptClaimRefreshRepositoryError(
		"SCRIPT_CLAIM_REFRESH_INPUT_INVALID",
	);
}

function repositoryNotFound(): ScriptClaimRefreshRepositoryError {
	return new ScriptClaimRefreshRepositoryError(
		"SCRIPT_CLAIM_REFRESH_NOT_FOUND",
	);
}

function persistedDataInvalid(): ScriptClaimRefreshRepositoryError {
	return new ScriptClaimRefreshRepositoryError(
		"SCRIPT_CLAIM_REFRESH_PERSISTED_DATA_INVALID",
	);
}

function idempotencyConflict(): ScriptClaimRefreshRepositoryError {
	return new ScriptClaimRefreshRepositoryError(
		"SCRIPT_CLAIM_REFRESH_IDEMPOTENCY_CONFLICT",
	);
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}

function assertNonEmpty(value: unknown): asserts value is string {
	if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
		throw repositoryInputInvalid();
	}
}

function assertCreateInput(
	input: CreateOrReuseScriptClaimRefreshRunInput,
): void {
	for (const value of [
		input.workspaceId,
		input.projectId,
		input.scriptVersionId,
		input.provider,
		input.model,
		input.promptVersion,
		input.outputSchemaVersion,
		input.createdByUserId,
	]) {
		assertNonEmpty(value);
	}
	if (
		!Number.isFinite(input.sourceScriptRevision) ||
		!Number.isInteger(input.sourceScriptRevision) ||
		input.sourceScriptRevision < 1 ||
		typeof input.idempotencyKey !== "string" ||
		input.idempotencyKey.trim() !== input.idempotencyKey ||
		input.idempotencyKey.length < 8 ||
		input.idempotencyKey.length > 200 ||
		!SHA256.test(input.requestHash) ||
		!SHA256.test(input.inputHash) ||
		!SHA256.test(input.sourceContentHash) ||
		!SHA256.test(input.promptHash) ||
		input.inputSnapshotJson === undefined
	) {
		throw repositoryInputInvalid();
	}
	try {
		canonicalizeJson(input.inputSnapshotJson);
	} catch {
		throw repositoryInputInvalid();
	}
}

function semanticProjectionFromInput(
	input: CreateOrReuseScriptClaimRefreshRunInput,
) {
	return {
		workspaceId: input.workspaceId,
		projectId: input.projectId,
		scriptVersionId: input.scriptVersionId,
		sourceScriptRevision: input.sourceScriptRevision,
		requestHash: input.requestHash,
		inputSnapshotJson: input.inputSnapshotJson,
		inputHash: input.inputHash,
		sourceContentHash: input.sourceContentHash,
		promptHash: input.promptHash,
		provider: input.provider,
		model: input.model,
		promptVersion: input.promptVersion,
		outputSchemaVersion: input.outputSchemaVersion,
	};
}

function semanticProjectionFromRow(row: ScriptClaimRefreshRunRow) {
	return {
		workspaceId: row.workspaceId,
		projectId: row.projectId,
		scriptVersionId: row.scriptVersionId,
		sourceScriptRevision: row.sourceScriptRevision,
		requestHash: row.requestHash,
		inputSnapshotJson: row.inputSnapshotJson,
		inputHash: row.inputHash,
		sourceContentHash: row.sourceContentHash,
		promptHash: row.promptHash,
		provider: row.provider,
		model: row.model,
		promptVersion: row.promptVersion,
		outputSchemaVersion: row.outputSchemaVersion,
	};
}

function hasExactSemanticPayload(
	row: ScriptClaimRefreshRunRow,
	input: CreateOrReuseScriptClaimRefreshRunInput,
): boolean {
	try {
		return (
			canonicalizeJson(semanticProjectionFromRow(row)) ===
			canonicalizeJson(semanticProjectionFromInput(input))
		);
	} catch {
		return false;
	}
}

export function mapScriptClaimRefreshRunRow(
	row: ScriptClaimRefreshRunRow,
): ScriptClaimRefreshRun {
	try {
		return Object.freeze(
			parseScriptClaimRefreshRunRecord({
				id: row.id,
				workspaceId: row.workspaceId,
				projectId: row.projectId,
				scriptVersionId: row.scriptVersionId,
				sourceScriptRevision: row.sourceScriptRevision,
				idempotencyKey: row.idempotencyKey,
				requestHash: row.requestHash,
				inputSnapshotJson: row.inputSnapshotJson,
				inputHash: row.inputHash,
				sourceContentHash: row.sourceContentHash,
				promptHash: row.promptHash,
				provider: row.provider,
				model: row.model,
				promptVersion: row.promptVersion,
				outputSchemaVersion: row.outputSchemaVersion,
				status: row.status,
				providerRequestId: row.providerRequestId,
				inputTokens: row.inputTokens,
				outputTokens: row.outputTokens,
				estimatedCostMicros: row.estimatedCostMicros,
				actualCostMicros: row.actualCostMicros,
				currency: row.currency,
				errorCode: row.errorCode,
				errorMessage: row.errorMessage,
				executionClaimedAt: row.executionClaimedAt,
				createdByUserId: row.createdByUserId,
				createdAt: row.createdAt,
				finishedAt: row.finishedAt,
				resultScriptRevision: row.resultScriptRevision,
			}),
		);
	} catch {
		throw persistedDataInvalid();
	}
}

async function findByIdempotencyKey(
	transaction: ScriptClaimRefreshRepositoryTransaction,
	input: Pick<
		CreateOrReuseScriptClaimRefreshRunInput,
		"workspaceId" | "idempotencyKey"
	>,
): Promise<ScriptClaimRefreshRunRow | undefined> {
	const [row] = await transaction
		.select()
		.from(scriptClaimRefreshRun)
		.where(
			and(
				eq(scriptClaimRefreshRun.workspaceId, input.workspaceId),
				eq(scriptClaimRefreshRun.idempotencyKey, input.idempotencyKey),
			),
		)
		.limit(1);
	return row;
}

async function findPendingByRequest(
	transaction: ScriptClaimRefreshRepositoryTransaction,
	input: Pick<
		CreateOrReuseScriptClaimRefreshRunInput,
		"workspaceId" | "projectId" | "requestHash"
	>,
): Promise<ScriptClaimRefreshRunRow | undefined> {
	const [row] = await transaction
		.select()
		.from(scriptClaimRefreshRun)
		.where(
			and(
				eq(scriptClaimRefreshRun.workspaceId, input.workspaceId),
				eq(scriptClaimRefreshRun.projectId, input.projectId),
				eq(scriptClaimRefreshRun.requestHash, input.requestHash),
				eq(scriptClaimRefreshRun.status, "pending"),
			),
		)
		.limit(1);
	return row;
}

async function assertParentScope(
	transaction: ScriptClaimRefreshRepositoryTransaction,
	input: CreateOrReuseScriptClaimRefreshRunInput,
): Promise<void> {
	const [workspaceRow] = await transaction
		.select({ id: workspace.id })
		.from(workspace)
		.where(eq(workspace.id, input.workspaceId))
		.limit(1);
	const [projectRow] = await transaction
		.select({ workspaceId: project.workspaceId })
		.from(project)
		.where(eq(project.id, input.projectId))
		.limit(1);
	const [scriptVersionRow] = await transaction
		.select({
			workspaceId: scriptVersion.workspaceId,
			projectId: scriptVersion.projectId,
		})
		.from(scriptVersion)
		.where(eq(scriptVersion.id, input.scriptVersionId))
		.limit(1);
	if (
		!workspaceRow ||
		!projectRow ||
		projectRow.workspaceId !== input.workspaceId ||
		!scriptVersionRow ||
		scriptVersionRow.workspaceId !== input.workspaceId ||
		scriptVersionRow.projectId !== input.projectId
	) {
		throw repositoryInputInvalid();
	}
}

async function createOrReuseWithTransaction(
	transaction: ScriptClaimRefreshRepositoryTransaction,
	input: CreateOrReuseScriptClaimRefreshRunInput,
): Promise<CreateOrReuseScriptClaimRefreshRunResult> {
	assertCreateInput(input);
	await assertParentScope(transaction, input);
	const [inserted] = await transaction
		.insert(scriptClaimRefreshRun)
		.values({
			id: randomUUID(),
			workspaceId: input.workspaceId,
			projectId: input.projectId,
			scriptVersionId: input.scriptVersionId,
			sourceScriptRevision: input.sourceScriptRevision,
			idempotencyKey: input.idempotencyKey,
			requestHash: input.requestHash,
			inputSnapshotJson: input.inputSnapshotJson,
			inputHash: input.inputHash,
			sourceContentHash: input.sourceContentHash,
			promptHash: input.promptHash,
			provider: input.provider,
			model: input.model,
			promptVersion: input.promptVersion,
			outputSchemaVersion: input.outputSchemaVersion,
			status: "pending",
			createdByUserId: input.createdByUserId,
		})
		.onConflictDoNothing()
		.returning();

	if (inserted) {
		return { created: true, run: mapScriptClaimRefreshRunRow(inserted) };
	}

	const existingByKey = await findByIdempotencyKey(transaction, input);
	if (existingByKey) {
		const existing = mapScriptClaimRefreshRunRow(existingByKey);
		if (!hasExactSemanticPayload(existingByKey, input)) {
			throw idempotencyConflict();
		}
		return { created: false, run: existing };
	}

	const existingPending = await findPendingByRequest(transaction, input);
	if (existingPending) {
		if (!hasExactSemanticPayload(existingPending, input)) {
			throw idempotencyConflict();
		}
		return {
			created: false,
			run: mapScriptClaimRefreshRunRow(existingPending),
		};
	}

	throw idempotencyConflict();
}

export function createOrReuseScriptClaimRefreshRunInTransaction(
	transaction: ScriptClaimRefreshRepositoryTransaction,
	input: CreateOrReuseScriptClaimRefreshRunInput,
): Promise<CreateOrReuseScriptClaimRefreshRunResult> {
	return createOrReuseWithTransaction(transaction, input);
}

export async function createOrReuseScriptClaimRefreshRun(
	input: CreateOrReuseScriptClaimRefreshRunInput,
): Promise<CreateOrReuseScriptClaimRefreshRunResult> {
	assertCreateInput(input);
	try {
		return await db.transaction((transaction) =>
			createOrReuseWithTransaction(transaction, input),
		);
	} catch (error) {
		if (error instanceof ScriptClaimRefreshRepositoryError) throw error;
		if (isUniqueViolation(error)) throw idempotencyConflict();
		throw error;
	}
}

function assertLookupInput(workspaceId: unknown, id: unknown): void {
	if (
		typeof workspaceId !== "string" ||
		typeof id !== "string" ||
		!workspaceId.trim() ||
		!id.trim()
	) {
		throw repositoryInputInvalid();
	}
}

export async function getScriptClaimRefreshRunById(input: {
	workspaceId: string;
	id: string;
}): Promise<ScriptClaimRefreshRun | null> {
	assertLookupInput(input.workspaceId, input.id);
	const [row] = await db
		.select()
		.from(scriptClaimRefreshRun)
		.where(
			and(
				eq(scriptClaimRefreshRun.workspaceId, input.workspaceId),
				eq(scriptClaimRefreshRun.id, input.id),
			),
		)
		.limit(1);
	return row ? mapScriptClaimRefreshRunRow(row) : null;
}

export async function getScriptClaimRefreshRunByIdempotencyKey(input: {
	workspaceId: string;
	idempotencyKey: string;
}): Promise<ScriptClaimRefreshRun | null> {
	assertLookupInput(input.workspaceId, input.idempotencyKey);
	const [row] = await db
		.select()
		.from(scriptClaimRefreshRun)
		.where(
			and(
				eq(scriptClaimRefreshRun.workspaceId, input.workspaceId),
				eq(scriptClaimRefreshRun.idempotencyKey, input.idempotencyKey),
			),
		)
		.limit(1);
	return row ? mapScriptClaimRefreshRunRow(row) : null;
}

export async function findPendingScriptClaimRefreshRun(input: {
	workspaceId: string;
	projectId: string;
	requestHash: string;
}): Promise<ScriptClaimRefreshRun | null> {
	assertLookupInput(input.workspaceId, input.projectId);
	if (!SHA256.test(input.requestHash)) throw repositoryInputInvalid();
	const [row] = await db
		.select()
		.from(scriptClaimRefreshRun)
		.where(
			and(
				eq(scriptClaimRefreshRun.workspaceId, input.workspaceId),
				eq(scriptClaimRefreshRun.projectId, input.projectId),
				eq(scriptClaimRefreshRun.requestHash, input.requestHash),
				eq(scriptClaimRefreshRun.status, "pending"),
			),
		)
		.limit(1);
	return row ? mapScriptClaimRefreshRunRow(row) : null;
}

export const SCRIPT_CLAIM_REFRESH_EXECUTION_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

export type ScriptClaimRefreshExecutionClaim =
	| Readonly<{
			owner: true;
			run: ScriptClaimRefreshRun;
			claimedAt: Date;
	  }>
	| Readonly<{
			owner: false;
			run: ScriptClaimRefreshRun;
			stale: boolean;
	  }>;

export async function claimScriptClaimRefreshExecution(input: {
	workspaceId: string;
	id: string;
}): Promise<ScriptClaimRefreshExecutionClaim> {
	assertLookupInput(input.workspaceId, input.id);
	return db.transaction(async (transaction) => {
		const claimedAt = new Date();
		const [claimed] = await transaction
			.update(scriptClaimRefreshRun)
			.set({ executionClaimedAt: claimedAt })
			.where(
				and(
					eq(scriptClaimRefreshRun.workspaceId, input.workspaceId),
					eq(scriptClaimRefreshRun.id, input.id),
					eq(scriptClaimRefreshRun.status, "pending"),
					isNull(scriptClaimRefreshRun.executionClaimedAt),
				),
			)
			.returning();
		if (claimed) {
			return {
				owner: true as const,
				run: mapScriptClaimRefreshRunRow(claimed),
				claimedAt,
			};
		}

		const [current] = await transaction
			.select()
			.from(scriptClaimRefreshRun)
			.where(
				and(
					eq(scriptClaimRefreshRun.workspaceId, input.workspaceId),
					eq(scriptClaimRefreshRun.id, input.id),
				),
			)
			.limit(1);
		if (!current) throw repositoryNotFound();
		const stale =
			current.status === "pending" &&
			current.executionClaimedAt !== null &&
			Date.now() - current.executionClaimedAt.getTime() >
				SCRIPT_CLAIM_REFRESH_EXECUTION_CLAIM_TIMEOUT_MS;
		return {
			owner: false as const,
			run: mapScriptClaimRefreshRunRow(current),
			stale,
		};
	});
}

export type ScriptClaimRefreshTerminalUpdate = Readonly<{
	workspaceId: string;
	id: string;
	executionClaimedAt: Date;
	status: "completed" | "failed" | "indeterminate";
	resultScriptRevision: number | null;
	errorCode: string | null;
	errorMessage: string | null;
	providerRequestId?: string | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	estimatedCostMicros?: bigint | null;
	actualCostMicros?: bigint | null;
	currency?: string | null;
}>;

export async function finalizeScriptClaimRefreshRunInTransaction(
	transaction: ScriptClaimRefreshRepositoryTransaction,
	input: ScriptClaimRefreshTerminalUpdate,
): Promise<ScriptClaimRefreshRun | null> {
	assertLookupInput(input.workspaceId, input.id);
	if (
		input.status === "completed" &&
		(input.resultScriptRevision === null ||
			input.errorCode !== null ||
			input.errorMessage !== null)
	) {
		throw repositoryInputInvalid();
	}
	if (
		(input.status === "failed" || input.status === "indeterminate") &&
		(input.resultScriptRevision !== null ||
			input.errorCode === null ||
			input.errorMessage === null)
	) {
		throw repositoryInputInvalid();
	}
	const [updated] = await transaction
		.update(scriptClaimRefreshRun)
		.set({
			status: input.status,
			resultScriptRevision: input.resultScriptRevision,
			errorCode: input.errorCode,
			errorMessage: input.errorMessage,
			providerRequestId: input.providerRequestId,
			inputTokens: input.inputTokens,
			outputTokens: input.outputTokens,
			estimatedCostMicros: input.estimatedCostMicros,
			actualCostMicros: input.actualCostMicros,
			currency: input.currency,
			finishedAt: new Date(),
		})
		.where(
			and(
				eq(scriptClaimRefreshRun.workspaceId, input.workspaceId),
				eq(scriptClaimRefreshRun.id, input.id),
				eq(scriptClaimRefreshRun.status, "pending"),
				eq(scriptClaimRefreshRun.executionClaimedAt, input.executionClaimedAt),
			),
		)
		.returning();
	return updated ? mapScriptClaimRefreshRunRow(updated) : null;
}

export async function finalizeScriptClaimRefreshRun(
	input: ScriptClaimRefreshTerminalUpdate,
): Promise<ScriptClaimRefreshRun> {
	return db.transaction(async (transaction) => {
		const updated = await finalizeScriptClaimRefreshRunInTransaction(
			transaction,
			input,
		);
		if (updated) return updated;
		const [current] = await transaction
			.select()
			.from(scriptClaimRefreshRun)
			.where(
				and(
					eq(scriptClaimRefreshRun.workspaceId, input.workspaceId),
					eq(scriptClaimRefreshRun.id, input.id),
				),
			)
			.limit(1);
		if (!current) throw repositoryNotFound();
		return mapScriptClaimRefreshRunRow(current);
	});
}
