import type { ScriptClaimRefreshInputSnapshot } from "@affichannel/core";
import {
	aiSettingsSchema,
	buildScriptClaimRefreshSourceProjection,
	parseScriptClaimRefreshInputSnapshot,
	SCRIPT_CLAIM_REFRESH_INPUT_VERSION,
	SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION,
	SCRIPT_CLAIM_REFRESH_PROMPT_VERSION,
	type ScriptClaimRefreshCandidateClaim,
	type ScriptClaimRefreshSourceProjection,
	type ScriptVersionEditableSnapshot,
	type ScriptVersionReadModel,
	scriptVersionEditableSnapshotSchema,
	validateScriptClaimRefreshProviderOutput,
	validateScriptVersionForFactLockRun,
} from "@affichannel/core";
import {
	aiSettings,
	db,
	product,
	project,
	scriptClaimRefreshRun,
	scriptVersion,
} from "@affichannel/db";
import { env } from "@affichannel/env/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import type {
	TextProvider,
	TextProviderResult,
} from "../providers/text/text-provider";
import { TextProviderError } from "../providers/text/text-provider";
import { resolveTextProvider } from "../providers/text/text-provider-registry";
import {
	canonicalScriptClaimRefreshPrompt,
	renderScriptClaimRefreshPrompt,
} from "./script-claim-refresh-prompt";
import {
	claimScriptClaimRefreshExecution,
	finalizeScriptClaimRefreshRun,
	finalizeScriptClaimRefreshRunInTransaction,
	mapScriptClaimRefreshRunRow,
	type ScriptClaimRefreshRepositoryTransaction,
} from "./script-claim-refresh-repository";
import { sha256Hex } from "./script-generation-hashing";
import { mapScriptVersionRecord } from "./script-version-repository";
import type { WorkspaceActor } from "./workspace";

export const scriptClaimRefreshServiceErrorCodes = [
	"SCRIPT_CLAIM_REFRESH_PROJECT_NOT_FOUND",
	"SCRIPT_CLAIM_REFRESH_SOURCE_NOT_FOUND",
	"SCRIPT_CLAIM_REFRESH_NOT_ELIGIBLE",
	"SCRIPT_CLAIM_REFRESH_PRODUCT_NOT_FOUND",
	"SCRIPT_CLAIM_REFRESH_SOURCE_REVISION_CONFLICT",
	"SCRIPT_CLAIM_REFRESH_SOURCE_NOT_USABLE",
	"SCRIPT_CLAIM_REFRESH_CLAIMS_STATE_INVALID",
	"SCRIPT_CLAIM_REFRESH_PROVIDER_NOT_CONFIGURED",
	"SCRIPT_CLAIM_REFRESH_INPUT_INVALID",
	"SCRIPT_CLAIM_REFRESH_PROVIDER_RESULT_MISMATCH",
	"SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED",
	"SCRIPT_CLAIM_REFRESH_EXECUTION_CLAIM_STALE_UNCERTAIN",
	"SCRIPT_CLAIM_REFRESH_PROVIDER_FAILED",
	"SCRIPT_CLAIM_REFRESH_PROVIDER_INDETERMINATE",
] as const;

export type ScriptClaimRefreshServiceErrorCode =
	(typeof scriptClaimRefreshServiceErrorCodes)[number];

export class ScriptClaimRefreshServiceError extends Error {
	readonly code: ScriptClaimRefreshServiceErrorCode;
	readonly retryable: boolean;

	constructor(code: ScriptClaimRefreshServiceErrorCode, retryable = false) {
		super(code);
		this.name = "ScriptClaimRefreshServiceError";
		this.code = code;
		this.retryable = retryable;
	}
}

export type ScriptClaimRefreshRequest = Readonly<{
	actor: WorkspaceActor;
	projectId: string;
	scriptVersionId: string;
	expectedScriptVersionRevision: number;
	idempotencyKey: string;
}>;

export type ScriptClaimRefreshProviderConfig = Readonly<{
	provider: string;
	model: string;
	promptVersion: typeof SCRIPT_CLAIM_REFRESH_PROMPT_VERSION;
	outputSchemaVersion: typeof SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION;
}>;

export type ScriptClaimRefreshRuntimeDependencies = Readonly<{
	provider?: TextProvider;
	resolveProvider?: (
		config: ScriptClaimRefreshProviderConfig,
	) => TextProvider | undefined;
}>;

export type PreparedScriptClaimRefresh = Readonly<{
	kind: "prepared";
	run: import("@affichannel/core").ScriptClaimRefreshRun;
	created: boolean;
	inputSnapshot: ScriptClaimRefreshInputSnapshot;
	source: ScriptClaimRefreshSourceProjection;
	config: ScriptClaimRefreshProviderConfig;
}>;

export type ScriptClaimRefreshPreparation =
	| Readonly<{
			kind: "not_required";
			scriptVersion: ScriptVersionReadModel;
	  }>
	| PreparedScriptClaimRefresh;

export type ScriptClaimRefreshExecutionResult =
	| Readonly<{
			kind: "not_required";
			scriptVersion: ScriptVersionReadModel;
	  }>
	| Readonly<{
			kind: "pending";
			run: import("@affichannel/core").ScriptClaimRefreshRun;
	  }>
	| Readonly<{
			kind: "completed";
			run: import("@affichannel/core").ScriptClaimRefreshRun;
			resultingScriptVersion: ScriptVersionReadModel;
	  }>
	| Readonly<{
			kind: "failed" | "indeterminate";
			run: import("@affichannel/core").ScriptClaimRefreshRun;
	  }>;

type ScriptClaimRefreshTransaction = ScriptClaimRefreshRepositoryTransaction;
type ScriptVersionRow = typeof scriptVersion.$inferSelect;

function serviceError(
	code: ScriptClaimRefreshServiceErrorCode,
	retryable = false,
): ScriptClaimRefreshServiceError {
	return new ScriptClaimRefreshServiceError(code, retryable);
}

function assertRequest(input: ScriptClaimRefreshRequest): void {
	if (
		!input.actor.workspaceId.trim() ||
		!input.actor.userId.trim() ||
		!input.projectId.trim() ||
		!input.scriptVersionId.trim() ||
		!input.idempotencyKey.trim() ||
		input.idempotencyKey !== input.idempotencyKey.trim() ||
		input.idempotencyKey.length < 8 ||
		input.idempotencyKey.length > 200
	) {
		throw serviceError("SCRIPT_CLAIM_REFRESH_SOURCE_NOT_FOUND");
	}
	if (
		!Number.isFinite(input.expectedScriptVersionRevision) ||
		!Number.isInteger(input.expectedScriptVersionRevision) ||
		input.expectedScriptVersionRevision < 1
	) {
		throw serviceError("SCRIPT_CLAIM_REFRESH_SOURCE_REVISION_CONFLICT", true);
	}
}

function assertActiveScriptedAffiliateProject(record: {
	contentType: string;
	creationPath: string;
	contentFormatKey: string;
	contentFormatVersion: number;
}): void {
	if (
		record.contentType !== "AFFILIATE" ||
		record.creationPath !== "SCRIPTED" ||
		record.contentFormatKey !== "SCRIPTED_STANDARD" ||
		record.contentFormatVersion !== 1
	) {
		throw serviceError("SCRIPT_CLAIM_REFRESH_NOT_ELIGIBLE");
	}
}

async function resolveProviderConfig(
	transaction: ScriptClaimRefreshTransaction,
	workspaceId: string,
): Promise<ScriptClaimRefreshProviderConfig> {
	const [settings] = await transaction
		.select({
			textProvider: aiSettings.textProvider,
			textModel: aiSettings.textModel,
		})
		.from(aiSettings)
		.where(eq(aiSettings.workspaceId, workspaceId))
		.limit(1);
	const parsed = aiSettingsSchema.safeParse(settings);
	if (settings && !parsed.success) {
		throw serviceError("SCRIPT_CLAIM_REFRESH_PROVIDER_NOT_CONFIGURED");
	}
	return {
		provider: parsed.success
			? parsed.data.textProvider
			: env.TEXT_AI_DEFAULT_PROVIDER,
		model: parsed.success ? parsed.data.textModel : env.TEXT_AI_DEFAULT_MODEL,
		promptVersion: SCRIPT_CLAIM_REFRESH_PROMPT_VERSION,
		outputSchemaVersion: SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION,
	};
}

function sourceSnapshotFromRow(
	row: ScriptVersionRow,
): ScriptVersionEditableSnapshot {
	const parsed = scriptVersionEditableSnapshotSchema.safeParse(
		row.editableSnapshotJson,
	);
	if (!parsed.success)
		throw serviceError("SCRIPT_CLAIM_REFRESH_SOURCE_NOT_USABLE");
	const validForRun = validateScriptVersionForFactLockRun(parsed.data);
	if (!validForRun.success)
		throw serviceError("SCRIPT_CLAIM_REFRESH_SOURCE_NOT_USABLE");
	return validForRun.data;
}

function claimMetadataIsCurrent(
	snapshot: ScriptVersionEditableSnapshot,
	projection: ScriptClaimRefreshSourceProjection,
	revision: number,
): boolean {
	if (
		snapshot.claimsStatus !== "current" ||
		snapshot.claimsSourceRevision !== revision
	) {
		return false;
	}
	return validateScriptClaimRefreshProviderOutput(
		{ claims: snapshot.claims },
		projection,
	).success;
}

function buildInputSnapshot(
	scriptVersionId: string,
	sourceScriptRevision: number,
	projection: ScriptClaimRefreshSourceProjection,
	sourceContentHash: string,
): ScriptClaimRefreshInputSnapshot {
	return {
		inputVersion: SCRIPT_CLAIM_REFRESH_INPUT_VERSION,
		scriptVersionId,
		sourceScriptRevision,
		sourceContentHash,
		source: projection,
	};
}

function normalizeProviderText(value: string): string {
	return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function providerTelemetry(result: TextProviderResult) {
	const inputTokens =
		typeof result.inputTokens === "number" &&
		Number.isSafeInteger(result.inputTokens) &&
		result.inputTokens >= 0
			? result.inputTokens
			: null;
	const outputTokens =
		typeof result.outputTokens === "number" &&
		Number.isSafeInteger(result.outputTokens) &&
		result.outputTokens >= 0
			? result.outputTokens
			: null;
	const currency =
		typeof result.currency === "string" && /^[A-Z]{3}$/.test(result.currency)
			? result.currency
			: null;
	const validCost = (value: bigint | null | undefined) =>
		typeof value === "bigint" && value >= BigInt(0) ? value : null;
	return {
		providerRequestId:
			typeof result.providerRequestId === "string"
				? normalizeProviderText(result.providerRequestId)
				: null,
		inputTokens,
		outputTokens,
		estimatedCostMicros: currency
			? validCost(result.estimatedCostMicros)
			: null,
		actualCostMicros: currency ? validCost(result.actualCostMicros) : null,
		currency,
	};
}

async function prepareInTransaction(
	transaction: ScriptClaimRefreshTransaction,
	input: ScriptClaimRefreshRequest,
): Promise<ScriptClaimRefreshPreparation> {
	const [projectRecord] = await transaction
		.select({
			id: project.id,
			productId: project.productId,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
		})
		.from(project)
		.where(
			and(
				eq(project.id, input.projectId),
				eq(project.workspaceId, input.actor.workspaceId),
				isNull(project.archivedAt),
			),
		)
		.limit(1)
		.for("update", { of: project });
	if (!projectRecord)
		throw serviceError("SCRIPT_CLAIM_REFRESH_PROJECT_NOT_FOUND");
	assertActiveScriptedAffiliateProject(projectRecord);
	if (!projectRecord.productId)
		throw serviceError("SCRIPT_CLAIM_REFRESH_PRODUCT_NOT_FOUND");

	const [accessibleProduct] = await transaction
		.select({ id: product.id })
		.from(product)
		.where(
			and(
				eq(product.id, projectRecord.productId),
				eq(product.workspaceId, input.actor.workspaceId),
			),
		)
		.limit(1);
	if (!accessibleProduct)
		throw serviceError("SCRIPT_CLAIM_REFRESH_PRODUCT_NOT_FOUND");

	const [sourceRow] = await transaction
		.select()
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.id, input.scriptVersionId),
				eq(scriptVersion.workspaceId, input.actor.workspaceId),
				eq(scriptVersion.projectId, projectRecord.id),
				eq(scriptVersion.status, "draft"),
			),
		)
		.limit(1)
		.for("update", { of: scriptVersion });
	if (!sourceRow) throw serviceError("SCRIPT_CLAIM_REFRESH_SOURCE_NOT_FOUND");
	if (sourceRow.revision !== input.expectedScriptVersionRevision) {
		throw serviceError("SCRIPT_CLAIM_REFRESH_SOURCE_REVISION_CONFLICT", true);
	}

	const sourceSnapshot = sourceSnapshotFromRow(sourceRow);
	const source = buildScriptClaimRefreshSourceProjection(sourceSnapshot);
	if (claimMetadataIsCurrent(sourceSnapshot, source, sourceRow.revision)) {
		return {
			kind: "not_required",
			scriptVersion: mapScriptVersionRecord(sourceRow),
		};
	}
	if (sourceSnapshot.claimsStatus !== "stale") {
		throw serviceError("SCRIPT_CLAIM_REFRESH_CLAIMS_STATE_INVALID");
	}

	const sourceContentHash = await sha256Hex(source);
	const inputSnapshot = buildInputSnapshot(
		sourceRow.id,
		sourceRow.revision,
		source,
		sourceContentHash,
	);
	const requestHash = await sha256Hex({
		inputVersion: SCRIPT_CLAIM_REFRESH_INPUT_VERSION,
		scriptVersionId: sourceRow.id,
		sourceScriptRevision: sourceRow.revision,
		sourceContentHash,
	});
	const inputHash = await sha256Hex(inputSnapshot);
	const config = await resolveProviderConfig(
		transaction,
		input.actor.workspaceId,
	);
	const prompt = renderScriptClaimRefreshPrompt(inputSnapshot);
	const promptHash = await sha256Hex(canonicalScriptClaimRefreshPrompt(prompt));
	const created = await import("./script-claim-refresh-repository").then(
		({ createOrReuseScriptClaimRefreshRunInTransaction }) =>
			createOrReuseScriptClaimRefreshRunInTransaction(transaction, {
				workspaceId: input.actor.workspaceId,
				projectId: projectRecord.id,
				scriptVersionId: sourceRow.id,
				sourceScriptRevision: sourceRow.revision,
				idempotencyKey: input.idempotencyKey,
				requestHash,
				inputSnapshotJson: inputSnapshot,
				inputHash,
				sourceContentHash,
				promptHash,
				provider: config.provider,
				model: config.model,
				promptVersion: config.promptVersion,
				outputSchemaVersion: config.outputSchemaVersion,
				createdByUserId: input.actor.userId,
			}),
	);
	return {
		kind: "prepared",
		run: created.run,
		created: created.created,
		inputSnapshot,
		source,
		config,
	};
}

export async function prepareScriptClaimRefresh(
	input: ScriptClaimRefreshRequest,
): Promise<ScriptClaimRefreshPreparation> {
	assertRequest(input);
	return db.transaction((transaction) =>
		prepareInTransaction(transaction, input),
	);
}

function resultFromTerminalRun(
	run: import("@affichannel/core").ScriptClaimRefreshRun,
	resultingScriptVersion?: ScriptVersionReadModel,
): ScriptClaimRefreshExecutionResult {
	if (run.status === "completed") {
		if (!resultingScriptVersion)
			throw serviceError("SCRIPT_CLAIM_REFRESH_SOURCE_NOT_FOUND");
		return { kind: "completed", run, resultingScriptVersion };
	}
	if (run.status === "failed") return { kind: "failed", run };
	if (run.status === "indeterminate") return { kind: "indeterminate", run };
	return { kind: "pending", run };
}

async function currentScriptVersion(
	input: ScriptClaimRefreshRequest,
): Promise<ScriptVersionReadModel | undefined> {
	const [row] = await db
		.select()
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.id, input.scriptVersionId),
				eq(scriptVersion.workspaceId, input.actor.workspaceId),
			),
		)
		.limit(1);
	return row ? mapScriptVersionRecord(row) : undefined;
}

function resolveProvider(
	config: ScriptClaimRefreshProviderConfig,
	dependencies: ScriptClaimRefreshRuntimeDependencies,
): TextProvider | undefined {
	if (dependencies.provider) return dependencies.provider;
	if (dependencies.resolveProvider) return dependencies.resolveProvider(config);
	return resolveTextProvider(config.provider, null, {
		allowDeterministic: false,
	});
}

function providerRequest(
	run: import("@affichannel/core").ScriptClaimRefreshRun,
	snapshot: ScriptClaimRefreshInputSnapshot,
) {
	const prompt = renderScriptClaimRefreshPrompt(snapshot);
	return {
		messages: [
			{ role: "system" as const, content: prompt.trustedInstructions },
			{ role: "developer" as const, content: prompt.outputSchema },
			{ role: "user" as const, content: prompt.untrustedInputData },
		],
		model: run.model,
		mode: "full" as const,
		sections: ["claims"],
		idempotencyKey: run.idempotencyKey,
		operation: "script-claim-refresh" as const,
	};
}

function providerFailureCode(error: unknown): {
	status: "failed" | "indeterminate";
	code:
		| "SCRIPT_CLAIM_REFRESH_PROVIDER_FAILED"
		| "SCRIPT_CLAIM_REFRESH_PROVIDER_INDETERMINATE";
} {
	if (
		error instanceof TextProviderError &&
		(error.code === "AI_TIMEOUT_UNCERTAIN" ||
			error.code === "AI_PROVIDER_UNCERTAIN")
	) {
		return {
			status: "indeterminate",
			code: "SCRIPT_CLAIM_REFRESH_PROVIDER_INDETERMINATE",
		};
	}
	return {
		status: "failed",
		code: "SCRIPT_CLAIM_REFRESH_PROVIDER_FAILED",
	};
}

async function finalizeFailure(
	run: import("@affichannel/core").ScriptClaimRefreshRun,
	status: "failed" | "indeterminate",
	code:
		| "SCRIPT_CLAIM_REFRESH_PROVIDER_FAILED"
		| "SCRIPT_CLAIM_REFRESH_PROVIDER_INDETERMINATE"
		| "SCRIPT_CLAIM_REFRESH_PROVIDER_RESULT_MISMATCH"
		| "SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED"
		| "SCRIPT_CLAIM_REFRESH_INPUT_INVALID"
		| "SCRIPT_CLAIM_REFRESH_EXECUTION_CLAIM_STALE_UNCERTAIN",
	telemetry: Partial<ReturnType<typeof providerTelemetry>> = {},
) {
	return finalizeScriptClaimRefreshRun({
		workspaceId: run.workspaceId,
		id: run.id,
		executionClaimedAt: run.executionClaimedAt as Date,
		status,
		resultScriptRevision: null,
		errorCode: code,
		errorMessage: code,
		providerRequestId: telemetry.providerRequestId ?? null,
		inputTokens: telemetry.inputTokens ?? null,
		outputTokens: telemetry.outputTokens ?? null,
		estimatedCostMicros: telemetry.estimatedCostMicros ?? null,
		actualCostMicros: telemetry.actualCostMicros ?? null,
		currency: telemetry.currency ?? null,
	});
}

async function finalizeSuccessfulApply(
	input: ScriptClaimRefreshRequest,
	run: import("@affichannel/core").ScriptClaimRefreshRun,
	claims: readonly ScriptClaimRefreshCandidateClaim[],
	telemetry: ReturnType<typeof providerTelemetry>,
): Promise<ScriptClaimRefreshExecutionResult> {
	return db.transaction(async (transaction) => {
		const [persistedRun] = await transaction
			.select()
			.from(scriptClaimRefreshRun)
			.where(
				and(
					eq(scriptClaimRefreshRun.workspaceId, input.actor.workspaceId),
					eq(scriptClaimRefreshRun.id, run.id),
				),
			)
			.limit(1)
			.for("update", { of: scriptClaimRefreshRun });
		if (!persistedRun)
			throw serviceError("SCRIPT_CLAIM_REFRESH_SOURCE_NOT_FOUND");
		if (
			persistedRun.status !== "pending" ||
			persistedRun.executionClaimedAt === null ||
			!run.executionClaimedAt ||
			persistedRun.executionClaimedAt.getTime() !==
				run.executionClaimedAt.getTime()
		) {
			const terminalRun = mapScriptClaimRefreshRunRow(persistedRun);
			if (terminalRun.status !== "completed")
				return resultFromTerminalRun(terminalRun);
			const [terminalScript] = await transaction
				.select()
				.from(scriptVersion)
				.where(
					and(
						eq(scriptVersion.id, terminalRun.scriptVersionId),
						eq(scriptVersion.workspaceId, input.actor.workspaceId),
					),
				)
				.limit(1);
			return resultFromTerminalRun(
				terminalRun,
				terminalScript ? mapScriptVersionRecord(terminalScript) : undefined,
			);
		}

		const [current] = await transaction
			.select()
			.from(scriptVersion)
			.where(
				and(
					eq(scriptVersion.id, run.scriptVersionId),
					eq(scriptVersion.workspaceId, input.actor.workspaceId),
					eq(scriptVersion.projectId, run.projectId),
					eq(scriptVersion.status, "draft"),
				),
			)
			.limit(1)
			.for("update", { of: scriptVersion });
		if (!current) {
			const failed = await finalizeScriptClaimRefreshRunInTransaction(
				transaction,
				{
					workspaceId: run.workspaceId,
					id: run.id,
					executionClaimedAt: run.executionClaimedAt,
					status: "failed",
					resultScriptRevision: null,
					errorCode: "SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED",
					errorMessage: "SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED",
					...telemetry,
				},
			);
			if (!failed)
				throw new Error("Script Claim Refresh finalization lost its CAS.");
			return { kind: "failed", run: failed };
		}

		let currentSnapshot: ScriptVersionEditableSnapshot;
		try {
			currentSnapshot = sourceSnapshotFromRow(current);
		} catch {
			currentSnapshot =
				current.editableSnapshotJson as ScriptVersionEditableSnapshot;
		}
		let currentProjection: ScriptClaimRefreshSourceProjection;
		try {
			currentProjection =
				buildScriptClaimRefreshSourceProjection(currentSnapshot);
		} catch {
			currentProjection = {} as ScriptClaimRefreshSourceProjection;
		}
		const currentSourceHash = await sha256Hex(currentProjection);
		if (
			current.revision !== run.sourceScriptRevision ||
			currentSourceHash !== run.sourceContentHash
		) {
			const failed = await finalizeScriptClaimRefreshRunInTransaction(
				transaction,
				{
					workspaceId: run.workspaceId,
					id: run.id,
					executionClaimedAt: run.executionClaimedAt,
					status: "failed",
					resultScriptRevision: null,
					errorCode: "SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED",
					errorMessage: "SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED",
					...telemetry,
				},
			);
			if (!failed) throw new Error("Script Claim Refresh source CAS was lost.");
			return { kind: "failed", run: failed };
		}

		const nextRevision = current.revision + 1;
		const nextSnapshot = {
			...currentSnapshot,
			claims: claims.map((claim) => ({
				text: claim.text,
				occurrence: claim.occurrence,
			})),
			claimsStatus: "current" as const,
			claimsSourceRevision: nextRevision,
		};
		const parsedNext =
			scriptVersionEditableSnapshotSchema.safeParse(nextSnapshot);
		if (!parsedNext.success) {
			const failed = await finalizeScriptClaimRefreshRunInTransaction(
				transaction,
				{
					workspaceId: run.workspaceId,
					id: run.id,
					executionClaimedAt: run.executionClaimedAt,
					status: "failed",
					resultScriptRevision: null,
					errorCode: "SCRIPT_CLAIM_REFRESH_PROVIDER_RESULT_MISMATCH",
					errorMessage: "SCRIPT_CLAIM_REFRESH_PROVIDER_RESULT_MISMATCH",
					...telemetry,
				},
			);
			if (!failed) throw new Error("Script Claim Refresh result CAS was lost.");
			return { kind: "failed", run: failed };
		}

		const [updatedScript] = await transaction
			.update(scriptVersion)
			.set({
				editableSnapshotJson: parsedNext.data,
				revision: sql`${scriptVersion.revision} + 1`,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(scriptVersion.id, current.id),
					eq(scriptVersion.workspaceId, input.actor.workspaceId),
					eq(scriptVersion.projectId, run.projectId),
					eq(scriptVersion.status, "draft"),
					eq(scriptVersion.revision, run.sourceScriptRevision),
				),
			)
			.returning();
		if (!updatedScript) {
			const failed = await finalizeScriptClaimRefreshRunInTransaction(
				transaction,
				{
					workspaceId: run.workspaceId,
					id: run.id,
					executionClaimedAt: run.executionClaimedAt,
					status: "failed",
					resultScriptRevision: null,
					errorCode: "SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED",
					errorMessage: "SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED",
					...telemetry,
				},
			);
			if (!failed) throw new Error("Script Claim Refresh update CAS was lost.");
			return { kind: "failed", run: failed };
		}

		const completed = await finalizeScriptClaimRefreshRunInTransaction(
			transaction,
			{
				workspaceId: run.workspaceId,
				id: run.id,
				executionClaimedAt: run.executionClaimedAt,
				status: "completed",
				resultScriptRevision: nextRevision,
				errorCode: null,
				errorMessage: null,
				...telemetry,
			},
		);
		if (!completed)
			throw new Error("Script Claim Refresh completion CAS was lost.");
		return {
			kind: "completed" as const,
			run: completed,
			resultingScriptVersion: mapScriptVersionRecord(updatedScript),
		};
	});
}

async function executePrepared(
	input: ScriptClaimRefreshRequest,
	prepared: PreparedScriptClaimRefresh,
	dependencies: ScriptClaimRefreshRuntimeDependencies,
): Promise<ScriptClaimRefreshExecutionResult> {
	if (prepared.run.status !== "pending") {
		return resultFromTerminalRun(
			prepared.run,
			prepared.run.status === "completed"
				? await currentScriptVersion(input)
				: undefined,
		);
	}

	const claim = await claimScriptClaimRefreshExecution({
		workspaceId: prepared.run.workspaceId,
		id: prepared.run.id,
	});
	if (!claim.owner) {
		if (claim.stale && claim.run.executionClaimedAt) {
			const stale = await finalizeScriptClaimRefreshRun({
				workspaceId: claim.run.workspaceId,
				id: claim.run.id,
				executionClaimedAt: claim.run.executionClaimedAt,
				status: "indeterminate",
				resultScriptRevision: null,
				errorCode: "SCRIPT_CLAIM_REFRESH_EXECUTION_CLAIM_STALE_UNCERTAIN",
				errorMessage: "SCRIPT_CLAIM_REFRESH_EXECUTION_CLAIM_STALE_UNCERTAIN",
			});
			return resultFromTerminalRun(stale);
		}
		return resultFromTerminalRun(claim.run);
	}

	const run = claim.run;
	if (!run.executionClaimedAt)
		throw serviceError("SCRIPT_CLAIM_REFRESH_INPUT_INVALID");
	let persistedSnapshot: ScriptClaimRefreshInputSnapshot;
	try {
		persistedSnapshot = parseScriptClaimRefreshInputSnapshot(
			run.inputSnapshotJson,
		);
		const sourceHash = await sha256Hex(persistedSnapshot.source);
		const inputHash = await sha256Hex(persistedSnapshot);
		const requestHash = await sha256Hex({
			inputVersion: persistedSnapshot.inputVersion,
			scriptVersionId: persistedSnapshot.scriptVersionId,
			sourceScriptRevision: persistedSnapshot.sourceScriptRevision,
			sourceContentHash: persistedSnapshot.sourceContentHash,
		});
		const prompt = renderScriptClaimRefreshPrompt(persistedSnapshot);
		const promptHash = await sha256Hex(
			canonicalScriptClaimRefreshPrompt(prompt),
		);
		if (
			sourceHash !== persistedSnapshot.sourceContentHash ||
			inputHash !== run.inputHash ||
			requestHash !== run.requestHash ||
			promptHash !== run.promptHash ||
			run.promptVersion !== SCRIPT_CLAIM_REFRESH_PROMPT_VERSION ||
			run.outputSchemaVersion !== SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION
		) {
			throw new Error("pinned semantic payload mismatch");
		}
	} catch {
		const failed = await finalizeFailure(
			run,
			"failed",
			"SCRIPT_CLAIM_REFRESH_INPUT_INVALID",
		);
		return resultFromTerminalRun(failed);
	}

	const provider = resolveProvider(prepared.config, dependencies);
	if (!provider) {
		const failed = await finalizeFailure(
			run,
			"failed",
			"SCRIPT_CLAIM_REFRESH_PROVIDER_FAILED",
		);
		return resultFromTerminalRun(failed);
	}

	let providerResult: TextProviderResult;
	try {
		providerResult = await provider.generate(
			providerRequest(run, persistedSnapshot),
		);
	} catch (error) {
		const failure = providerFailureCode(error);
		const failed = await finalizeFailure(run, failure.status, failure.code);
		return resultFromTerminalRun(failed);
	}

	const telemetry = providerTelemetry(providerResult);
	const validation = validateScriptClaimRefreshProviderOutput(
		providerResult.content,
		persistedSnapshot.source,
	);
	if (!validation.success) {
		const failed = await finalizeFailure(
			run,
			"failed",
			"SCRIPT_CLAIM_REFRESH_PROVIDER_RESULT_MISMATCH",
			telemetry,
		);
		return resultFromTerminalRun(failed);
	}

	return finalizeSuccessfulApply(input, run, validation.claims, telemetry);
}

export async function executeScriptClaimRefresh(
	input: ScriptClaimRefreshRequest,
	dependencies: ScriptClaimRefreshRuntimeDependencies = {},
): Promise<ScriptClaimRefreshExecutionResult> {
	assertRequest(input);
	const prepared = await prepareScriptClaimRefresh(input);
	if (prepared.kind === "not_required") return prepared;
	return executePrepared(input, prepared, dependencies);
}

export async function finalizeScriptClaimRefreshAsIndeterminate(input: {
	workspaceId: string;
	runId: string;
	executionClaimedAt: Date;
}) {
	return finalizeScriptClaimRefreshRun({
		workspaceId: input.workspaceId,
		id: input.runId,
		executionClaimedAt: input.executionClaimedAt,
		status: "indeterminate",
		resultScriptRevision: null,
		errorCode: "SCRIPT_CLAIM_REFRESH_EXECUTION_CLAIM_STALE_UNCERTAIN",
		errorMessage: "SCRIPT_CLAIM_REFRESH_EXECUTION_CLAIM_STALE_UNCERTAIN",
	});
}
