import { randomUUID } from "node:crypto";
import {
	buildManifestFactLockInputSnapshot,
	buildManifestZeroClaimOutcome,
	computeFactLockZeroClaimPolicyHash,
	computeManifestFactLockInputHash,
	computeManifestRequestHash,
	computeProductFactsFingerprint,
	computeZeroClaimManifestRequestHash,
	evaluateManifestExecutionEligibility,
	FACT_LOCK_MANIFEST_INPUT_MODE,
	FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	FACT_LOCK_ZERO_CLAIM_MODEL,
	FACT_LOCK_ZERO_CLAIM_PROMPT_VERSION,
	FACT_LOCK_ZERO_CLAIM_PROVIDER,
	FactLockError,
	type ManifestExecutionEligibilityManifest,
	type ManifestFactLockInputSnapshot,
	type ManifestProductFactsSnapshot,
} from "@affichannel/core";
import type { FactLockRunStatus } from "@affichannel/core/fact-lock/types";
import type {
	ContentType,
	CreationPath,
} from "@affichannel/core/project/channel-first-types";
import {
	db,
	factLockRun,
	product,
	project,
	scriptVersion,
} from "@affichannel/db";
import { and, eq } from "drizzle-orm";

import {
	ClaimManifestRepositoryError,
	getClaimManifestByIdInTransaction,
} from "./claim-manifest-repository";
import {
	loadFactLockPolicyInTransaction,
	loadFactLockProductFactsInTransaction,
} from "./fact-lock-service";
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
