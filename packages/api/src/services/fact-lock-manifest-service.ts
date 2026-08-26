import { randomUUID } from "node:crypto";
import {
	buildManifestFactLockInputSnapshot,
	buildManifestFactLockVerificationInput,
	buildManifestZeroClaimOutcome,
	computeFactLockZeroClaimPolicyHash,
	computeManifestFactLockInputHash,
	computeManifestRequestHash,
	computeProductFactsFingerprint,
	computeZeroClaimManifestRequestHash,
	deriveFactLockRunStatus,
	evaluateManifestExecutionEligibility,
	FACT_LOCK_MANIFEST_INPUT_MODE,
	FACT_LOCK_MANIFEST_PROMPT_VERSION,
	FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	FACT_LOCK_ZERO_CLAIM_MODEL,
	FACT_LOCK_ZERO_CLAIM_PROMPT_VERSION,
	FACT_LOCK_ZERO_CLAIM_PROVIDER,
	FactLockError,
	type FactLockStoredClaim,
	type ManifestExecutionEligibilityManifest,
	type ManifestFactLockInputSnapshot,
	type ManifestFactLockVerificationInput,
	type ManifestProductFactsSnapshot,
	validateManifestFactLockProviderResult,
} from "@affichannel/core";
import type { FactLockRunStatus } from "@affichannel/core/fact-lock/types";
import type {
	ContentType,
	CreationPath,
} from "@affichannel/core/project/channel-first-types";
import {
	db,
	factLockClaim,
	factLockClaimFact,
	factLockRun,
	product,
	project,
	scriptVersion,
} from "@affichannel/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type {
	TextProvider,
	TextProviderResult,
} from "../providers/text/text-provider";
import { TextProviderError } from "../providers/text/text-provider";
import {
	ClaimManifestRepositoryError,
	getClaimManifestByIdInTransaction,
} from "./claim-manifest-repository";
import {
	detachFactDependenciesInTransaction,
	registerFactDependenciesInTransaction,
} from "./fact-dependency-repository";
import { renderManifestFactLockPrompt } from "./fact-lock-manifest-prompt";
import {
	loadFactLockPolicyInTransaction,
	loadFactLockProductFactsInTransaction,
} from "./fact-lock-service";
import { sha256Hex } from "./script-generation-hashing";
import { resolveServerGenerationConfig } from "./script-generation-service";
import type { WorkspaceActor } from "./workspace";

type FactLockTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ClaimManifestRecord = NonNullable<
	Awaited<ReturnType<typeof getClaimManifestByIdInTransaction>>
>;

export type ManifestFactLockPreparationInput = Readonly<{
	actor: WorkspaceActor;
	projectId: string;
	claimManifestId: string;
	idempotencyKey: string;
}>;

type ExistingManifestFactLock = Readonly<{
	id: string;
	status: FactLockRunStatus;
	requestHash: string;
	inputMode: "MANIFEST_V1";
	claimManifestId: string | null;
	claimManifestFingerprint: string | null;
}>;

type ManifestFactLockPreparedBase = Readonly<{
	manifest: Awaited<
		ReturnType<typeof getClaimManifestByIdInTransaction>
	> extends infer T
		? Exclude<T, null>
		: never;
	productFacts: ManifestProductFactsSnapshot;
	productFactsFingerprint: string | null;
	requestHash: string;
	inputSnapshot: ManifestFactLockInputSnapshot;
	inputHash: string;
	idempotencyKey: string;
}>;

export type ManifestFactLockPreparation =
	| (ManifestFactLockPreparedBase & {
			kind: "prepared";
			persistence: "deferred_to_18d";
	  })
	| (ManifestFactLockPreparedBase & {
			kind: "existing";
			run: ExistingManifestFactLock;
			zeroClaim?: {
				status: "passed";
				providerRequired: false;
				claimResults: readonly [];
				dependenciesRequired: false;
			};
	  });

export type ManifestFactLockProviderConfig = Readonly<{
	provider: string;
	model: string;
	promptVersion: typeof FACT_LOCK_MANIFEST_PROMPT_VERSION;
	outputSchemaVersion: typeof FACT_LOCK_OUTPUT_SCHEMA_VERSION;
}>;

export type ManifestFactLockRunArtifact = Readonly<{
	id: string;
	workspaceId: string;
	projectId: string;
	scriptVersionId: string | null;
	sourceScriptRevision: number | null;
	inputMode: typeof FACT_LOCK_MANIFEST_INPUT_MODE;
	claimManifestId: string;
	claimManifestFingerprint: string;
	idempotencyKey: string;
	requestHash: string;
	inputHash: string;
	promptHash: string;
	provider: string;
	model: string;
	promptVersion: string;
	outputSchemaVersion: string;
	status: FactLockRunStatus;
	inputSnapshot: ManifestFactLockInputSnapshot;
	providerRequestId: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	estimatedCostMicros: bigint | null;
	actualCostMicros: bigint | null;
	currency: string | null;
	errorCode: string | null;
	executionClaimedAt: Date | null;
	createdAt: Date;
	finishedAt: Date | null;
}>;

export type ManifestFactLockRunResult = ManifestFactLockRunArtifact & {
	claims: FactLockStoredClaim[];
};

type ManifestFactLockRunRow = typeof factLockRun.$inferSelect & {
	inputMode: typeof FACT_LOCK_MANIFEST_INPUT_MODE;
	claimManifestId: string;
	claimManifestFingerprint: string;
};

function normalizeInput(
	input: ManifestFactLockPreparationInput,
): ManifestFactLockPreparationInput {
	const projectId = input.projectId.trim();
	const claimManifestId = input.claimManifestId.trim();
	const idempotencyKey = input.idempotencyKey.trim();
	if (!projectId)
		throw new FactLockError("FACT_LOCK_NOT_FOUND", "Project không hợp lệ.");
	if (!claimManifestId)
		throw new FactLockError(
			"FACT_LOCK_MANIFEST_REQUIRED",
			"Fact Lock yêu cầu claimManifestId tường minh.",
		);
	if (idempotencyKey.length < 8 || idempotencyKey.length > 200)
		throw new FactLockError(
			"FACT_LOCK_IDEMPOTENCY_CONFLICT",
			"Idempotency key không hợp lệ.",
		);
	return {
		...input,
		projectId,
		claimManifestId,
		idempotencyKey,
	};
}

function notExecutable(): never {
	throw new FactLockError(
		"CLAIM_MANIFEST_NOT_EXECUTABLE",
		"ClaimManifest không thể dùng cho Fact Lock hiện tại.",
	);
}

function mapManifestLookupFailure(error: unknown): never {
	if (
		error instanceof ClaimManifestRepositoryError &&
		error.code === "CLAIM_MANIFEST_PERSISTED_DATA_INVALID"
	)
		throw new FactLockError(
			"CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
			"ClaimManifest integrity check failed.",
		);
	throw error;
}

function manifestEligibilityProjection(
	manifest: ManifestFactLockPreparedBase["manifest"],
): ManifestExecutionEligibilityManifest {
	return {
		id: manifest.id,
		workspaceId: manifest.workspaceId,
		projectId: manifest.projectId,
		source: manifest.source,
		productId: manifest.productId,
		fingerprint: manifest.fingerprint,
		claims: manifest.claims,
		claimCount: manifest.claimCount,
		isEmpty: manifest.isEmpty,
		schemaVersion: manifest.schemaVersion,
		builderVersion: manifest.builderVersion,
	};
}

async function findExistingManifestRun(
	transaction: FactLockTransaction,
	actor: WorkspaceActor,
	input: { projectId: string; idempotencyKey: string; requestHash: string },
): Promise<ExistingManifestFactLock | null> {
	const [byIdempotency] = await transaction
		.select({
			id: factLockRun.id,
			status: factLockRun.status,
			requestHash: factLockRun.requestHash,
			inputMode: factLockRun.inputMode,
			claimManifestId: factLockRun.claimManifestId,
			claimManifestFingerprint: factLockRun.claimManifestFingerprint,
		})
		.from(factLockRun)
		.where(
			and(
				eq(factLockRun.workspaceId, actor.workspaceId),
				eq(factLockRun.idempotencyKey, input.idempotencyKey),
			),
		)
		.limit(1);
	if (byIdempotency) {
		if (
			byIdempotency.inputMode !== "MANIFEST_V1" ||
			byIdempotency.requestHash !== input.requestHash
		)
			throw new FactLockError(
				"FACT_LOCK_IDEMPOTENCY_CONFLICT",
				"Idempotency key đã được dùng cho intent khác.",
			);
		return {
			...byIdempotency,
			status: byIdempotency.status as FactLockRunStatus,
			inputMode: "MANIFEST_V1",
		};
	}

	const [pending] = await transaction
		.select({
			id: factLockRun.id,
			status: factLockRun.status,
			requestHash: factLockRun.requestHash,
			inputMode: factLockRun.inputMode,
			claimManifestId: factLockRun.claimManifestId,
			claimManifestFingerprint: factLockRun.claimManifestFingerprint,
		})
		.from(factLockRun)
		.where(
			and(
				eq(factLockRun.workspaceId, actor.workspaceId),
				eq(factLockRun.projectId, input.projectId),
				eq(factLockRun.requestHash, input.requestHash),
				eq(factLockRun.status, "pending"),
				eq(factLockRun.inputMode, "MANIFEST_V1"),
			),
		)
		.limit(1);
	if (!pending) return null;
	return {
		...pending,
		status: pending.status as FactLockRunStatus,
		inputMode: "MANIFEST_V1",
	};
}

function mapPersistedManifestRun(row: {
	id: string;
	status: string;
	requestHash: string;
	inputMode: string | null;
	claimManifestId: string | null;
	claimManifestFingerprint: string | null;
}): ExistingManifestFactLock {
	return {
		id: row.id,
		status: row.status as FactLockRunStatus,
		requestHash: row.requestHash,
		inputMode: FACT_LOCK_MANIFEST_INPUT_MODE,
		claimManifestId: row.claimManifestId,
		claimManifestFingerprint: row.claimManifestFingerprint,
	};
}

async function persistZeroClaimRun(
	transaction: FactLockTransaction,
	input: ManifestFactLockPreparationInput,
	prepared: ManifestFactLockPreparedBase,
): Promise<ExistingManifestFactLock> {
	if (prepared.manifest.source.sourceType !== "SCRIPT_VERSION")
		throw new FactLockError(
			"CLAIM_MANIFEST_NOT_EXECUTABLE",
			"ClaimManifest không thể dùng cho Fact Lock hiện tại.",
		);
	const [created] = await transaction
		.insert(factLockRun)
		.values({
			id: randomUUID(),
			workspaceId: input.actor.workspaceId,
			projectId: input.projectId,
			scriptVersionId: prepared.manifest.source.scriptVersionId,
			sourceScriptRevision: prepared.manifest.source.scriptVersionRevision,
			inputMode: FACT_LOCK_MANIFEST_INPUT_MODE,
			claimManifestId: prepared.manifest.id,
			claimManifestFingerprint: prepared.manifest.fingerprint,
			idempotencyKey: prepared.idempotencyKey,
			requestHash: prepared.requestHash,
			inputSnapshotJson: prepared.inputSnapshot,
			inputHash: prepared.inputHash,
			promptHash: await computeFactLockZeroClaimPolicyHash(),
			provider: FACT_LOCK_ZERO_CLAIM_PROVIDER,
			model: FACT_LOCK_ZERO_CLAIM_MODEL,
			promptVersion: FACT_LOCK_ZERO_CLAIM_PROMPT_VERSION,
			outputSchemaVersion: FACT_LOCK_OUTPUT_SCHEMA_VERSION,
			status: "passed",
			createdByUserId: input.actor.userId,
			finishedAt: new Date(),
		})
		.onConflictDoNothing()
		.returning({
			id: factLockRun.id,
			status: factLockRun.status,
			requestHash: factLockRun.requestHash,
			inputMode: factLockRun.inputMode,
			claimManifestId: factLockRun.claimManifestId,
			claimManifestFingerprint: factLockRun.claimManifestFingerprint,
		});
	if (created) return mapPersistedManifestRun(created);

	const [retry] = await transaction
		.select({
			id: factLockRun.id,
			status: factLockRun.status,
			requestHash: factLockRun.requestHash,
			inputMode: factLockRun.inputMode,
			claimManifestId: factLockRun.claimManifestId,
			claimManifestFingerprint: factLockRun.claimManifestFingerprint,
		})
		.from(factLockRun)
		.where(
			and(
				eq(factLockRun.workspaceId, input.actor.workspaceId),
				eq(factLockRun.idempotencyKey, prepared.idempotencyKey),
			),
		)
		.limit(1);
	if (retry) {
		if (
			retry.inputMode !== FACT_LOCK_MANIFEST_INPUT_MODE ||
			retry.requestHash !== prepared.requestHash
		)
			throw new FactLockError(
				"FACT_LOCK_IDEMPOTENCY_CONFLICT",
				"Idempotency key đã được dùng cho intent khác.",
			);
		return mapPersistedManifestRun(retry);
	}
	throw new FactLockError(
		"FACT_LOCK_CONFLICT",
		"Fact Lock zero-claim chưa thể tạo request.",
	);
}

async function buildPreparation(
	transaction: FactLockTransaction,
	input: ManifestFactLockPreparationInput,
): Promise<ManifestFactLockPreparedBase> {
	const [projectRecord] = await transaction
		.select({
			id: project.id,
			workspaceId: project.workspaceId,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
			productId: project.productId,
			archivedAt: project.archivedAt,
		})
		.from(project)
		.where(
			and(
				eq(project.id, input.projectId),
				eq(project.workspaceId, input.actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: project });
	if (!projectRecord || projectRecord.archivedAt !== null) notExecutable();

	const [currentScript] = await transaction
		.select()
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.workspaceId, input.actor.workspaceId),
				eq(scriptVersion.projectId, projectRecord.id),
				eq(scriptVersion.status, "draft"),
			),
		)
		.limit(1)
		.for("update", { of: scriptVersion });

	if (!projectRecord.productId) notExecutable();
	const [currentProduct] = await transaction
		.select({ id: product.id })
		.from(product)
		.where(
			and(
				eq(product.id, projectRecord.productId),
				eq(product.workspaceId, input.actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: product });
	if (!currentProduct) notExecutable();

	let manifest: ClaimManifestRecord | null = null;
	try {
		manifest = await getClaimManifestByIdInTransaction(transaction, {
			workspaceId: input.actor.workspaceId,
			projectId: projectRecord.id,
			claimManifestId: input.claimManifestId,
		});
	} catch (error) {
		mapManifestLookupFailure(error);
	}
	if (!manifest) {
		throw new FactLockError(
			"CLAIM_MANIFEST_NOT_FOUND",
			"ClaimManifest không tồn tại trong phạm vi yêu cầu.",
		);
	}

	const eligibility = await evaluateManifestExecutionEligibility({
		manifest: manifestEligibilityProjection(manifest),
		project: {
			id: projectRecord.id,
			workspaceId: projectRecord.workspaceId,
			contentType: projectRecord.contentType as ContentType,
			creationPath: projectRecord.creationPath as CreationPath,
			contentFormatKey: projectRecord.contentFormatKey,
			contentFormatVersion: projectRecord.contentFormatVersion,
			productId: currentProduct.id,
			currentScriptVersionId: currentScript?.id ?? null,
		},
		currentScriptVersion: currentScript
			? {
					id: currentScript.id,
					revision: currentScript.revision,
					status: currentScript.status as "draft" | "saved",
				}
			: null,
	});
	if (!eligibility.eligible) {
		throw new FactLockError(
			eligibility.code,
			"ClaimManifest không thể dùng cho Fact Lock hiện tại.",
			{ reason: eligibility.reason },
		);
	}

	if (manifest.claims.length === 0) {
		const inputSnapshot = buildManifestFactLockInputSnapshot({
			manifest,
			productFacts: [],
			policy: null,
			outputRules: null,
		});
		return {
			manifest,
			productFacts: [],
			productFactsFingerprint: null,
			requestHash: await computeZeroClaimManifestRequestHash({
				claimManifestFingerprint: manifest.fingerprint,
			}),
			inputSnapshot,
			inputHash: await computeManifestFactLockInputHash(inputSnapshot),
			idempotencyKey: input.idempotencyKey,
		};
	}

	const loadedProductFacts = await loadFactLockProductFactsInTransaction(
		transaction,
		input.actor,
		currentProduct.id,
	);
	const productFacts = loadedProductFacts.map((fact) => ({
		...fact,
		assessment: {
			...fact.assessment,
			verification: "verified" as const,
		},
	}));
	if (productFacts.length === 0)
		throw new FactLockError(
			"FACT_LOCK_NO_USABLE_FACTS",
			"Không có Product Fact đủ điều kiện cho Fact Lock.",
		);
	const productFactsFingerprint =
		await computeProductFactsFingerprint(productFacts);
	const { policy, outputRules } = await loadFactLockPolicyInTransaction(
		transaction,
		input.actor,
	);
	const inputSnapshot = buildManifestFactLockInputSnapshot({
		manifest,
		productFacts,
		productFactsFingerprint,
		policy,
		outputRules,
	});
	return {
		manifest,
		productFacts,
		productFactsFingerprint,
		requestHash: await computeManifestRequestHash({
			claimManifestFingerprint: manifest.fingerprint,
			productFactsFingerprint,
		}),
		inputSnapshot,
		inputHash: await computeManifestFactLockInputHash(inputSnapshot),
		idempotencyKey: input.idempotencyKey,
	};
}

export async function prepareManifestFactLock(
	rawInput: ManifestFactLockPreparationInput,
): Promise<ManifestFactLockPreparation> {
	const input = normalizeInput(rawInput);
	return db.transaction(async (transaction) => {
		const prepared = await buildPreparation(transaction, input);
		const existing = await findExistingManifestRun(transaction, input.actor, {
			projectId: input.projectId,
			idempotencyKey: input.idempotencyKey,
			requestHash: prepared.requestHash,
		});
		if (existing) {
			const zeroClaim =
				prepared.manifest.claims.length === 0
					? buildManifestZeroClaimOutcome({
							manifest: manifestEligibilityProjection(prepared.manifest),
							eligibility: { eligible: true },
						})
					: undefined;
			return {
				...prepared,
				kind: "existing" as const,
				run: existing,
				...(zeroClaim ? { zeroClaim } : {}),
			};
		}

		if (prepared.manifest.claims.length === 0) {
			const zeroClaim = buildManifestZeroClaimOutcome({
				manifest: manifestEligibilityProjection(prepared.manifest),
				eligibility: { eligible: true },
			});
			const run = await persistZeroClaimRun(transaction, input, prepared);
			return {
				...prepared,
				kind: "existing" as const,
				run,
				zeroClaim,
			};
		}
		return {
			...prepared,
			kind: "prepared" as const,
			persistence: "deferred_to_18d" as const,
		};
	});
}

function isManifestFactLockRun(
	row: typeof factLockRun.$inferSelect,
): row is ManifestFactLockRunRow {
	return (
		row.inputMode === FACT_LOCK_MANIFEST_INPUT_MODE &&
		row.claimManifestId !== null &&
		row.claimManifestFingerprint !== null
	);
}

function toManifestFactLockRunArtifact(
	row: typeof factLockRun.$inferSelect,
): ManifestFactLockRunArtifact {
	if (!isManifestFactLockRun(row)) {
		throw new FactLockError(
			"FACT_LOCK_SCRIPT_NOT_READY",
			"Fact Lock run không thuộc Manifest-first flow.",
		);
	}
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		projectId: row.projectId,
		scriptVersionId: row.scriptVersionId,
		sourceScriptRevision: row.sourceScriptRevision,
		inputMode: FACT_LOCK_MANIFEST_INPUT_MODE,
		claimManifestId: row.claimManifestId,
		claimManifestFingerprint: row.claimManifestFingerprint,
		idempotencyKey: row.idempotencyKey,
		requestHash: row.requestHash,
		inputHash: row.inputHash,
		promptHash: row.promptHash,
		provider: row.provider,
		model: row.model,
		promptVersion: row.promptVersion,
		outputSchemaVersion: row.outputSchemaVersion,
		status: row.status as FactLockRunStatus,
		inputSnapshot: row.inputSnapshotJson as ManifestFactLockInputSnapshot,
		providerRequestId: row.providerRequestId,
		inputTokens: row.inputTokens,
		outputTokens: row.outputTokens,
		estimatedCostMicros: row.estimatedCostMicros,
		actualCostMicros: row.actualCostMicros,
		currency: row.currency,
		errorCode: row.errorCode,
		executionClaimedAt: row.executionClaimedAt,
		createdAt: row.createdAt,
		finishedAt: row.finishedAt,
	};
}

async function getManifestFactLockRunInTransaction(
	transaction: FactLockTransaction,
	actor: WorkspaceActor,
	runId: string,
): Promise<ManifestFactLockRunRow> {
	const [row] = await transaction
		.select()
		.from(factLockRun)
		.where(
			and(
				eq(factLockRun.workspaceId, actor.workspaceId),
				eq(factLockRun.id, runId),
			),
		)
		.limit(1);
	if (!row || !isManifestFactLockRun(row)) {
		throw new FactLockError(
			"FACT_LOCK_NOT_FOUND",
			"Manifest Fact Lock run không tồn tại trong workspace.",
		);
	}
	return row;
}

async function getManifestFactLockRun(
	actor: WorkspaceActor,
	runId: string,
): Promise<ManifestFactLockRunArtifact> {
	return db.transaction(async (transaction) =>
		toManifestFactLockRunArtifact(
			await getManifestFactLockRunInTransaction(transaction, actor, runId),
		),
	);
}

function buildManifestVerificationInput(
	manifest: ClaimManifestRecord,
	productFacts: readonly ManifestProductFactsSnapshot[number][],
): ManifestFactLockVerificationInput {
	return buildManifestFactLockVerificationInput({
		manifest: manifestEligibilityProjection(manifest),
		productFacts: [...productFacts],
	});
}

function buildManifestProviderPrompt(
	manifest: ClaimManifestRecord,
	inputSnapshot: ManifestFactLockInputSnapshot,
): {
	verificationInput: ManifestFactLockVerificationInput;
	prompt: ReturnType<typeof renderManifestFactLockPrompt>;
} {
	if (!inputSnapshot.policy || !inputSnapshot.outputRules) {
		throw new FactLockError(
			"FACT_LOCK_SCRIPT_NOT_READY",
			"Manifest Fact Lock thiếu policy hoặc output rules.",
		);
	}
	const verificationInput = buildManifestVerificationInput(
		manifest,
		inputSnapshot.productFacts,
	);
	return {
		verificationInput,
		prompt: renderManifestFactLockPrompt({
			claims: verificationInput.claims,
			productFacts: verificationInput.productFacts,
			policy: inputSnapshot.policy,
			outputRules: inputSnapshot.outputRules,
		}),
	};
}

export async function resolveServerManifestFactLockConfig(
	actor: WorkspaceActor,
): Promise<ManifestFactLockProviderConfig> {
	const config = await resolveServerGenerationConfig(actor);
	return {
		provider: config.provider,
		model: config.model,
		promptVersion: FACT_LOCK_MANIFEST_PROMPT_VERSION,
		outputSchemaVersion: FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	};
}

async function persistNonEmptyManifestFactLock(
	input: ManifestFactLockPreparationInput,
	config: ManifestFactLockProviderConfig,
): Promise<ManifestFactLockRunArtifact> {
	return db.transaction(async (transaction) => {
		const prepared = await buildPreparation(transaction, input);
		if (prepared.manifest.claims.length === 0) {
			throw new FactLockError(
				"FACT_LOCK_CONFLICT",
				"Manifest đã chuyển sang zero-claim; dùng execution path nội bộ.",
			);
		}
		if (prepared.manifest.source.sourceType !== "SCRIPT_VERSION") {
			throw new FactLockError(
				"CLAIM_MANIFEST_NOT_EXECUTABLE",
				"Manifest source không được hỗ trợ cho runtime hiện tại.",
			);
		}
		const { prompt } = buildManifestProviderPrompt(
			prepared.manifest,
			prepared.inputSnapshot,
		);
		const productFactsFingerprint = prepared.productFactsFingerprint;
		if (!productFactsFingerprint) {
			throw new FactLockError(
				"FACT_LOCK_CONFLICT",
				"Manifest Fact Lock thiếu Product Facts fingerprint.",
			);
		}
		const promptHash = sha256Hex(prompt);
		const [created] = await transaction
			.insert(factLockRun)
			.values({
				id: randomUUID(),
				workspaceId: input.actor.workspaceId,
				projectId: input.projectId,
				scriptVersionId: prepared.manifest.source.scriptVersionId,
				sourceScriptRevision: prepared.manifest.source.scriptVersionRevision,
				inputMode: FACT_LOCK_MANIFEST_INPUT_MODE,
				claimManifestId: prepared.manifest.id,
				claimManifestFingerprint: prepared.manifest.fingerprint,
				idempotencyKey: prepared.idempotencyKey,
				requestHash: prepared.requestHash,
				inputSnapshotJson: prepared.inputSnapshot,
				inputHash: prepared.inputHash,
				promptHash,
				provider: config.provider,
				model: config.model,
				promptVersion: config.promptVersion,
				outputSchemaVersion: config.outputSchemaVersion,
				status: "pending",
				createdByUserId: input.actor.userId,
			})
			.onConflictDoNothing()
			.returning();
		if (created) {
			await registerFactDependenciesInTransaction(transaction, input.actor, {
				dependentType: "fact_lock",
				dependentId: created.id,
				facts: prepared.productFacts.map((fact) => ({
					id: fact.id,
					revision: fact.revision,
				})),
			});
			return toManifestFactLockRunArtifact(created);
		}

		const [sameIdempotency] = await transaction
			.select()
			.from(factLockRun)
			.where(
				and(
					eq(factLockRun.workspaceId, input.actor.workspaceId),
					eq(factLockRun.idempotencyKey, prepared.idempotencyKey),
				),
			)
			.limit(1);
		if (sameIdempotency) {
			if (
				!isManifestFactLockRun(sameIdempotency) ||
				sameIdempotency.requestHash !== prepared.requestHash
			)
				throw new FactLockError(
					"FACT_LOCK_IDEMPOTENCY_CONFLICT",
					"Idempotency key đã được dùng cho intent khác.",
				);
			return toManifestFactLockRunArtifact(sameIdempotency);
		}

		const [pending] = await transaction
			.select()
			.from(factLockRun)
			.where(
				and(
					eq(factLockRun.workspaceId, input.actor.workspaceId),
					eq(factLockRun.projectId, input.projectId),
					eq(factLockRun.requestHash, prepared.requestHash),
					eq(factLockRun.status, "pending"),
					eq(factLockRun.inputMode, FACT_LOCK_MANIFEST_INPUT_MODE),
				),
			)
			.limit(1);
		if (pending && isManifestFactLockRun(pending))
			return toManifestFactLockRunArtifact(pending);
		throw new FactLockError(
			"FACT_LOCK_CONFLICT",
			"Manifest Fact Lock chưa thể tạo request.",
		);
	});
}

async function loadManifestClaimsInTransaction(
	transaction: FactLockTransaction,
	actor: WorkspaceActor,
	runId: string,
	manifest: ClaimManifestRecord,
): Promise<FactLockStoredClaim[]> {
	const rows = await transaction
		.select()
		.from(factLockClaim)
		.where(
			and(
				eq(factLockClaim.workspaceId, actor.workspaceId),
				eq(factLockClaim.runId, runId),
			),
		);
	if (rows.length === 0) return [];
	const mappings = await transaction
		.select()
		.from(factLockClaimFact)
		.where(
			inArray(
				factLockClaimFact.claimId,
				rows.map((row) => row.id),
			),
		);
	const mappingsByClaim = new Map<
		string,
		FactLockStoredClaim["factMappings"]
	>();
	for (const mapping of mappings) {
		const current = mappingsByClaim.get(mapping.claimId) ?? [];
		current.push({
			factId: mapping.factId,
			factRevision: mapping.factRevision,
			relation:
				mapping.relation as FactLockStoredClaim["factMappings"][number]["relation"],
		});
		mappingsByClaim.set(mapping.claimId, current);
	}
	const byKey = new Map(rows.map((row) => [row.claimKey, row]));
	return manifest.claims.flatMap((manifestClaim) => {
		const row = byKey.get(manifestClaim.claimKey);
		if (!row) return [];
		return [
			{
				id: row.id,
				claimKey: manifestClaim.claimKey,
				claimText: manifestClaim.claimText,
				occurrence:
					manifestClaim.locator.sourceType === "SCRIPT_VERSION"
						? manifestClaim.locator.occurrence
						: (row.occurrenceJson as FactLockStoredClaim["occurrence"]),
				classificationStatus:
					row.classificationStatus as FactLockStoredClaim["classificationStatus"],
				reason: row.reason,
				confidence: row.confidence,
				suggestionText: row.suggestionText,
				factMappings: mappingsByClaim.get(row.id) ?? [],
				reviewStatus: row.reviewStatus as FactLockStoredClaim["reviewStatus"],
				checkedAt: row.checkedAt,
				reviewedByUserId: row.reviewedByUserId,
				reviewedAt: row.reviewedAt,
				reviewNote: row.reviewNote,
			},
		];
	});
}

function persistedManifestInputFailure(): never {
	throw new FactLockError(
		"CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
		"Manifest Fact Lock input integrity check failed.",
	);
}

async function loadManifestExecutionContext(
	transaction: FactLockTransaction,
	actor: WorkspaceActor,
	run: ManifestFactLockRunArtifact,
): Promise<{
	manifest: ClaimManifestRecord;
	verificationInput: ManifestFactLockVerificationInput;
	prompt: ReturnType<typeof renderManifestFactLockPrompt>;
}> {
	if (
		run.promptVersion !== FACT_LOCK_MANIFEST_PROMPT_VERSION ||
		run.outputSchemaVersion !== FACT_LOCK_OUTPUT_SCHEMA_VERSION
	) {
		persistedManifestInputFailure();
	}
	const snapshot = run.inputSnapshot;
	if (
		snapshot.inputMode !== FACT_LOCK_MANIFEST_INPUT_MODE ||
		snapshot.claimManifest.id !== run.claimManifestId ||
		snapshot.claimManifest.fingerprint !== run.claimManifestFingerprint ||
		snapshot.productFacts.length === 0 ||
		typeof snapshot.productFactsFingerprint !== "string" ||
		snapshot.policy === null ||
		snapshot.outputRules === null ||
		snapshot.zeroClaim !== null
	) {
		persistedManifestInputFailure();
	}
	let manifest: ClaimManifestRecord | null = null;
	try {
		manifest = await getClaimManifestByIdInTransaction(transaction, {
			workspaceId: actor.workspaceId,
			projectId: run.projectId,
			claimManifestId: run.claimManifestId,
		});
	} catch (error) {
		mapManifestLookupFailure(error);
	}
	if (
		!manifest ||
		manifest.fingerprint !== run.claimManifestFingerprint ||
		manifest.source.sourceType !== "SCRIPT_VERSION" ||
		run.scriptVersionId !== manifest.source.scriptVersionId ||
		run.sourceScriptRevision !== manifest.source.scriptVersionRevision
	) {
		persistedManifestInputFailure();
	}
	try {
		const productFactsFingerprint = await computeProductFactsFingerprint(
			snapshot.productFacts,
		);
		if (snapshot.productFactsFingerprint !== productFactsFingerprint) {
			persistedManifestInputFailure();
		}
		const canonicalSnapshot = buildManifestFactLockInputSnapshot({
			manifest,
			productFacts: snapshot.productFacts,
			productFactsFingerprint,
			policy: snapshot.policy,
			outputRules: snapshot.outputRules,
		});
		if (
			(await computeManifestFactLockInputHash(canonicalSnapshot)) !==
			run.inputHash
		) {
			persistedManifestInputFailure();
		}
		const expectedRequestHash = await computeManifestRequestHash({
			claimManifestFingerprint: manifest.fingerprint,
			productFactsFingerprint,
		});
		if (expectedRequestHash !== run.requestHash) {
			persistedManifestInputFailure();
		}
		const built = buildManifestProviderPrompt(manifest, canonicalSnapshot);
		if (sha256Hex(built.prompt) !== run.promptHash) {
			persistedManifestInputFailure();
		}
		return { manifest, ...built };
	} catch (error) {
		if (error instanceof FactLockError) throw error;
		persistedManifestInputFailure();
	}
}

async function getManifestFactLockRunResult(
	actor: WorkspaceActor,
	runId: string,
): Promise<ManifestFactLockRunResult> {
	return db.transaction(async (transaction) => {
		const row = await getManifestFactLockRunInTransaction(
			transaction,
			actor,
			runId,
		);
		const manifest = await getClaimManifestByIdInTransaction(transaction, {
			workspaceId: actor.workspaceId,
			projectId: row.projectId,
			claimManifestId: row.claimManifestId,
		});
		if (!manifest) {
			throw new FactLockError(
				"CLAIM_MANIFEST_NOT_FOUND",
				"ClaimManifest không tồn tại trong phạm vi yêu cầu.",
			);
		}
		return {
			...toManifestFactLockRunArtifact(row),
			claims: await loadManifestClaimsInTransaction(
				transaction,
				actor,
				row.id,
				manifest,
			),
		};
	});
}

const MANIFEST_EXECUTION_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

type ManifestFactLockExecutionClaim =
	| { owner: true; run: ManifestFactLockRunArtifact }
	| {
			owner: false;
			run: ManifestFactLockRunArtifact;
			claims: FactLockStoredClaim[];
			stale: boolean;
	  };

async function claimManifestFactLockExecution(
	actor: WorkspaceActor,
	runId: string,
): Promise<ManifestFactLockExecutionClaim> {
	return db.transaction(async (transaction) => {
		const now = new Date();
		const [claimed] = await transaction
			.update(factLockRun)
			.set({ executionClaimedAt: now })
			.where(
				and(
					eq(factLockRun.workspaceId, actor.workspaceId),
					eq(factLockRun.id, runId),
					eq(factLockRun.inputMode, FACT_LOCK_MANIFEST_INPUT_MODE),
					eq(factLockRun.status, "pending"),
					isNull(factLockRun.executionClaimedAt),
				),
			)
			.returning();
		if (claimed) {
			return {
				owner: true as const,
				run: toManifestFactLockRunArtifact(claimed),
			};
		}

		const current = await getManifestFactLockRunInTransaction(
			transaction,
			actor,
			runId,
		);
		const manifest = await getClaimManifestByIdInTransaction(transaction, {
			workspaceId: actor.workspaceId,
			projectId: current.projectId,
			claimManifestId: current.claimManifestId,
		});
		if (!manifest) {
			throw new FactLockError(
				"CLAIM_MANIFEST_NOT_FOUND",
				"ClaimManifest không tồn tại trong phạm vi yêu cầu.",
			);
		}
		const claimedAt = current.executionClaimedAt;
		return {
			owner: false as const,
			run: toManifestFactLockRunArtifact(current),
			claims: await loadManifestClaimsInTransaction(
				transaction,
				actor,
				current.id,
				manifest,
			),
			stale:
				current.status === "pending" &&
				claimedAt !== null &&
				now.getTime() - claimedAt.getTime() >
					MANIFEST_EXECUTION_CLAIM_TIMEOUT_MS,
		};
	});
}

export type ManifestFactLockFinalizeOutcome =
	| { kind: "success"; result: TextProviderResult }
	| { kind: "failure"; code: string };

function isUncertainManifestFailure(code: string) {
	return code.includes("UNCERTAIN") || code === "AI_TIMEOUT_UNCERTAIN";
}

function storedManifestClaims(
	validation: Extract<
		ReturnType<typeof validateManifestFactLockProviderResult>,
		{ success: true }
	>,
): FactLockStoredClaim[] {
	const checkedAt = new Date();
	return validation.claims.map((claim) => ({
		id: null,
		claimKey: claim.claimKey,
		claimText: claim.claimText,
		occurrence:
			claim.locator.sourceType === "SCRIPT_VERSION"
				? claim.locator.occurrence
				: (() => {
						throw new FactLockError(
							"CLAIM_MANIFEST_NOT_EXECUTABLE",
							"Manifest locator không được hỗ trợ cho runtime hiện tại.",
						);
					})(),
		classificationStatus: claim.classificationStatus,
		reason: claim.reason,
		confidence: claim.confidence,
		suggestionText: claim.suggestionText,
		factMappings: [...claim.factMappings],
		reviewStatus:
			claim.classificationStatus === "SUPPORTED"
				? ("AUTO_PASSED" as const)
				: ("UNRESOLVED" as const),
		checkedAt,
		reviewedByUserId: null,
		reviewedAt: null,
		reviewNote: null,
	}));
}

export async function finalizeManifestFactLockRun(
	actor: WorkspaceActor,
	input: {
		runId: string;
		expectedExecutionClaimedAt: Date;
		outcome: ManifestFactLockFinalizeOutcome;
	},
): Promise<ManifestFactLockRunResult> {
	return db.transaction(async (transaction) => {
		const [run] = await transaction
			.select()
			.from(factLockRun)
			.where(
				and(
					eq(factLockRun.workspaceId, actor.workspaceId),
					eq(factLockRun.id, input.runId),
				),
			)
			.limit(1)
			.for("update", { of: factLockRun });
		if (!run || !isManifestFactLockRun(run)) {
			throw new FactLockError(
				"FACT_LOCK_NOT_FOUND",
				"Manifest Fact Lock run không tồn tại trong workspace.",
			);
		}
		const manifest = await getClaimManifestByIdInTransaction(transaction, {
			workspaceId: actor.workspaceId,
			projectId: run.projectId,
			claimManifestId: run.claimManifestId,
		});
		if (!manifest) {
			throw new FactLockError(
				"CLAIM_MANIFEST_NOT_FOUND",
				"ClaimManifest không tồn tại trong phạm vi yêu cầu.",
			);
		}
		if (run.status !== "pending") {
			return {
				...toManifestFactLockRunArtifact(run),
				claims: await loadManifestClaimsInTransaction(
					transaction,
					actor,
					run.id,
					manifest,
				),
			};
		}
		if (
			!run.executionClaimedAt ||
			run.executionClaimedAt.getTime() !==
				input.expectedExecutionClaimedAt.getTime()
		) {
			throw new FactLockError(
				"FACT_LOCK_CONFLICT",
				"Manifest Fact Lock execution claim không còn hợp lệ.",
			);
		}

		const artifact = toManifestFactLockRunArtifact(run);
		let status: FactLockRunStatus;
		let errorCode: string | null = null;
		let errorMessage: string | null = null;
		let claims: FactLockStoredClaim[] = [];
		let providerRequestId: string | null = null;
		let inputTokens: number | null = run.inputTokens;
		let outputTokens: number | null = run.outputTokens;
		let estimatedCostMicros: bigint | null = run.estimatedCostMicros;
		let actualCostMicros: bigint | null = null;
		let currency: string | null = run.currency;
		if (input.outcome.kind === "failure") {
			errorCode = input.outcome.code;
			status = isUncertainManifestFailure(input.outcome.code)
				? "indeterminate"
				: "failed";
		} else {
			providerRequestId = input.outcome.result.providerRequestId;
			inputTokens = input.outcome.result.inputTokens;
			outputTokens = input.outcome.result.outputTokens;
			estimatedCostMicros =
				input.outcome.result.estimatedCostMicros ?? run.estimatedCostMicros;
			actualCostMicros = input.outcome.result.actualCostMicros;
			currency =
				estimatedCostMicros !== null || actualCostMicros !== null
					? (input.outcome.result.currency ?? run.currency)
					: null;
			const context = await loadManifestExecutionContext(
				transaction,
				actor,
				artifact,
			);
			const validation = validateManifestFactLockProviderResult(
				input.outcome.result.content,
				context.verificationInput,
			);
			if (!validation.success) {
				status = "indeterminate";
				if (validation.issueCodes.length > 0)
					errorMessage = validation.issueCodes.join(",");
				errorCode = validation.code;
			} else {
				claims = storedManifestClaims(validation);
				status = deriveFactLockRunStatus(claims);
			}
		}

		if (status === "failed") {
			await detachFactDependenciesInTransaction(transaction, actor, {
				dependentType: "fact_lock",
				dependentId: run.id,
			});
		}
		const finishedAt = new Date();
		const [updated] = await transaction
			.update(factLockRun)
			.set({
				status,
				providerRequestId,
				inputTokens,
				outputTokens,
				estimatedCostMicros,
				actualCostMicros,
				currency,
				errorCode,
				errorMessage,
				finishedAt,
			})
			.where(
				and(
					eq(factLockRun.workspaceId, actor.workspaceId),
					eq(factLockRun.id, run.id),
					eq(factLockRun.inputMode, FACT_LOCK_MANIFEST_INPUT_MODE),
					eq(factLockRun.status, "pending"),
					eq(factLockRun.executionClaimedAt, input.expectedExecutionClaimedAt),
				),
			)
			.returning();
		if (!updated) {
			throw new FactLockError(
				"FACT_LOCK_CONFLICT",
				"Manifest Fact Lock finalize CAS thất bại.",
			);
		}
		for (const claim of claims) {
			const [stored] = await transaction
				.insert(factLockClaim)
				.values({
					id: randomUUID(),
					workspaceId: actor.workspaceId,
					runId: run.id,
					claimKey: claim.claimKey,
					claimText: claim.claimText,
					occurrenceJson: claim.occurrence,
					classificationStatus: claim.classificationStatus,
					reviewStatus: claim.reviewStatus,
					reason: claim.reason,
					confidence: claim.confidence,
					suggestionText: claim.suggestionText,
					checkedAt: claim.checkedAt,
					reviewedByUserId: null,
					reviewedAt: null,
					reviewNote: null,
				})
				.returning({ id: factLockClaim.id });
			if (!stored) throw new Error("Manifest Fact Lock claim insert failed.");
			if (claim.factMappings.length > 0) {
				await transaction.insert(factLockClaimFact).values(
					claim.factMappings.map((mapping) => ({
						claimId: stored.id,
						factId: mapping.factId,
						factRevision: mapping.factRevision,
						relation: mapping.relation,
					})),
				);
			}
		}
		const [final] = await transaction
			.select()
			.from(factLockRun)
			.where(
				and(
					eq(factLockRun.workspaceId, actor.workspaceId),
					eq(factLockRun.id, run.id),
				),
			)
			.limit(1);
		if (!final || !isManifestFactLockRun(final))
			throw new Error("Could not reload Manifest Fact Lock run.");
		return {
			...toManifestFactLockRunArtifact(final),
			claims: await loadManifestClaimsInTransaction(
				transaction,
				actor,
				run.id,
				manifest,
			),
		};
	});
}

function manifestProviderRequest(
	run: ManifestFactLockRunArtifact,
	prompt: ReturnType<typeof renderManifestFactLockPrompt>,
) {
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
		operation: "fact-lock" as const,
	};
}

export type ManifestFactLockProvider =
	| TextProvider
	| ((config: ManifestFactLockProviderConfig) => TextProvider);

export async function executeManifestFactLock(
	actor: WorkspaceActor,
	rawInput: Omit<ManifestFactLockPreparationInput, "actor">,
	providerOrFactory: ManifestFactLockProvider,
): Promise<ManifestFactLockRunResult> {
	const input = normalizeInput({ ...rawInput, actor });
	const preview = await prepareManifestFactLock(input);
	if (preview.manifest.claims.length === 0) {
		if (preview.kind !== "existing")
			throw new FactLockError(
				"FACT_LOCK_CONFLICT",
				"Zero-claim Manifest phải dùng execution path nội bộ.",
			);
		const zeroRun = await getManifestFactLockRunResult(actor, preview.run.id);
		return zeroRun;
	}

	let run: ManifestFactLockRunArtifact;
	if (preview.kind === "existing") {
		run = await getManifestFactLockRun(actor, preview.run.id);
	} else {
		run = await persistNonEmptyManifestFactLock(
			input,
			await resolveServerManifestFactLockConfig(actor),
		);
	}
	if (run.status !== "pending")
		return getManifestFactLockRunResult(actor, run.id);

	const claimed = await claimManifestFactLockExecution(actor, run.id);
	if (!claimed.owner) {
		if (claimed.stale) {
			return finalizeManifestFactLockRun(actor, {
				runId: run.id,
				expectedExecutionClaimedAt: claimed.run.executionClaimedAt as Date,
				outcome: {
					kind: "failure",
					code: "FACT_LOCK_EXECUTION_CLAIM_STALE_UNCERTAIN",
				},
			});
		}
		return { ...claimed.run, claims: claimed.claims };
	}

	let context: Awaited<ReturnType<typeof loadManifestExecutionContext>>;
	try {
		context = await db.transaction((transaction) =>
			loadManifestExecutionContext(transaction, actor, claimed.run),
		);
	} catch {
		return finalizeManifestFactLockRun(actor, {
			runId: claimed.run.id,
			expectedExecutionClaimedAt: claimed.run.executionClaimedAt as Date,
			outcome: {
				kind: "failure",
				code: "FACT_LOCK_EXECUTION_INPUT_STALE_UNCERTAIN",
			},
		});
	}

	let provider: TextProvider;
	const providerConfig: ManifestFactLockProviderConfig = {
		provider: claimed.run.provider,
		model: claimed.run.model,
		promptVersion: FACT_LOCK_MANIFEST_PROMPT_VERSION,
		outputSchemaVersion: FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	};
	try {
		provider =
			typeof providerOrFactory === "function"
				? providerOrFactory(providerConfig)
				: providerOrFactory;
	} catch (error) {
		return finalizeManifestFactLockRun(actor, {
			runId: claimed.run.id,
			expectedExecutionClaimedAt: claimed.run.executionClaimedAt as Date,
			outcome: {
				kind: "failure",
				code:
					error instanceof FactLockError
						? error.code
						: "FACT_LOCK_PROVIDER_UNAVAILABLE",
			},
		});
	}

	try {
		const result = await provider.generate(
			manifestProviderRequest(claimed.run, context.prompt),
		);
		return finalizeManifestFactLockRun(actor, {
			runId: claimed.run.id,
			expectedExecutionClaimedAt: claimed.run.executionClaimedAt as Date,
			outcome: { kind: "success", result },
		});
	} catch (error) {
		return finalizeManifestFactLockRun(actor, {
			runId: claimed.run.id,
			expectedExecutionClaimedAt: claimed.run.executionClaimedAt as Date,
			outcome: {
				kind: "failure",
				code:
					error instanceof TextProviderError ? error.code : "AI_PROVIDER_ERROR",
			},
		});
	}
}
