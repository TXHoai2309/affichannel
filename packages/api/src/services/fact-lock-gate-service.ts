import {
	type ClaimManifest,
	evaluateFactLockGate,
	FactLockError,
	type FactLockGateEvaluationInput,
	type FactLockGateResult,
	type FactLockProductFactSnapshot,
	factLockInputSnapshotSchema,
	manifestFactLockInputSnapshotSchema,
	type ParsedFactLockInputSnapshot,
	type ParsedManifestFactLockInputSnapshot,
} from "@affichannel/core";
import { FACT_LOCK_MANIFEST_INPUT_MODE } from "@affichannel/core/fact-lock/manifest-contract";
import type { FactLockRunStatus } from "@affichannel/core/fact-lock/types";
import type { factDependency, factLockRun, productFact } from "@affichannel/db";
import {
	loadFactLockReadContext,
	toFactLockReadModel,
} from "./fact-lock-read-service";
import type { WorkspaceActor } from "./workspace";

type GateRunRow = typeof factLockRun.$inferSelect;
type FactDependencyRow = typeof factDependency.$inferSelect;
type ProductFactRow = typeof productFact.$inferSelect;

type GateProject = {
	id: string;
	workspaceId?: string;
	productId: string | null;
	contentType: string | null;
	creationPath: string | null;
	contentFormatKey: string | null;
	contentFormatVersion: number | null;
	archivedAt?: Date | null;
};

export type FactLockGateInputBuilderInput = {
	productId: string | null;
	currentScriptVersion: FactLockGateEvaluationInput["currentScriptVersion"];
	runs: GateRunRow[];
	dependencies: FactDependencyRow[];
	facts: ProductFactRow[];
	project?: GateProject;
	claimManifests?: readonly ClaimManifest[];
};

function invalidRead(message: string): never {
	throw new FactLockError("FACT_LOCK_SCRIPT_NOT_READY", message);
}

function invalidManifest(message: string): never {
	throw new FactLockError("CLAIM_MANIFEST_FINGERPRINT_MISMATCH", message);
}

function factsAreCurrent(
	snapshotFacts: readonly FactLockProductFactSnapshot[],
	dependencies: readonly FactDependencyRow[],
	facts: readonly ProductFactRow[],
	productId: string | null,
) {
	if (productId === null || dependencies.length !== snapshotFacts.length)
		return false;
	const factsById = new Map(facts.map((fact) => [fact.id, fact]));
	return snapshotFacts.every((snapshotFact) => {
		const dependency = dependencies.find(
			(candidate) => candidate.productFactId === snapshotFact.id,
		);
		const currentFact = factsById.get(snapshotFact.id);
		return (
			dependency !== undefined &&
			dependency.factRevision === snapshotFact.revision &&
			dependency.detachedAt === null &&
			dependency.invalidatedAt === null &&
			currentFact !== undefined &&
			currentFact.productId === productId &&
			currentFact.revision === snapshotFact.revision &&
			currentFact.status === "verified"
		);
	});
}

function parseRun(row: GateRunRow) {
	if (row.inputMode === null) {
		const parsed = factLockInputSnapshotSchema.safeParse(row.inputSnapshotJson);
		if (
			!parsed.success ||
			row.scriptVersionId === null ||
			row.sourceScriptRevision === null ||
			parsed.data.scriptVersion.id !== row.scriptVersionId ||
			parsed.data.scriptVersion.revision !== row.sourceScriptRevision
		)
			invalidRead("Legacy Fact Lock snapshot không hợp lệ.");
		return {
			mode: "LEGACY" as const,
			snapshot: parsed.data as ParsedFactLockInputSnapshot,
			manifest: undefined,
		};
	}
	if (row.inputMode !== FACT_LOCK_MANIFEST_INPUT_MODE)
		invalidRead("Fact Lock input mode không được hỗ trợ.");
	const parsed = manifestFactLockInputSnapshotSchema.safeParse(
		row.inputSnapshotJson,
	);
	if (
		!parsed.success ||
		row.claimManifestId === null ||
		row.claimManifestFingerprint === null ||
		parsed.data.claimManifest.id !== row.claimManifestId ||
		parsed.data.claimManifest.fingerprint !== row.claimManifestFingerprint ||
		parsed.data.source.sourceType !== "SCRIPT_VERSION" ||
		row.scriptVersionId === null ||
		row.sourceScriptRevision === null ||
		parsed.data.source.scriptVersionId !== row.scriptVersionId ||
		parsed.data.source.scriptVersionRevision !== row.sourceScriptRevision
	)
		invalidManifest("Manifest Fact Lock snapshot không hợp lệ.");
	return {
		mode: "MANIFEST_V1" as const,
		snapshot: parsed.data as ParsedManifestFactLockInputSnapshot,
		manifest: undefined as ClaimManifest | undefined,
	};
}

function buildInput(
	input: FactLockGateInputBuilderInput,
): FactLockGateEvaluationInput {
	const dependenciesByRun = new Map<string, FactDependencyRow[]>();
	for (const dependency of input.dependencies) {
		const current = dependenciesByRun.get(dependency.dependentId) ?? [];
		current.push(dependency);
		dependenciesByRun.set(dependency.dependentId, current);
	}
	const manifestsById = new Map(
		(input.claimManifests ?? []).map((manifest) => [manifest.id, manifest]),
	);
	return {
		currentScriptVersion: input.currentScriptVersion,
		runs: input.runs.map((row) => {
			const parsed = parseRun(row);
			let manifest = parsed.manifest;
			if (parsed.mode === "MANIFEST_V1") {
				manifest = manifestsById.get(row.claimManifestId as string);
				if (
					!manifest ||
					manifest.fingerprint !== row.claimManifestFingerprint ||
					manifest.workspaceId !== input.project?.workspaceId ||
					manifest.projectId !== input.project?.id
				)
					invalidManifest("Manifest Fact Lock reference không hợp lệ.");
			}
			const runDependencies = dependenciesByRun.get(row.id) ?? [];
			const snapshotFacts = inputFacts(parsed.snapshot);
			const sourceCurrent = manifest
				? Boolean(
						input.project &&
							input.project.archivedAt === null &&
							input.project.contentType === "AFFILIATE" &&
							input.project.creationPath === "SCRIPTED" &&
							input.project.contentFormatKey === "SCRIPTED_STANDARD" &&
							input.project.contentFormatVersion === 1 &&
							manifest.source.sourceType === "SCRIPT_VERSION" &&
							row.scriptVersionId === manifest.source.scriptVersionId &&
							row.sourceScriptRevision ===
								manifest.source.scriptVersionRevision &&
							input.currentScriptVersion?.id ===
								manifest.source.scriptVersionId &&
							input.currentScriptVersion.revision ===
								manifest.source.scriptVersionRevision,
					)
				: row.scriptVersionId === input.currentScriptVersion?.id &&
					row.sourceScriptRevision === input.currentScriptVersion?.revision;
			const dependenciesCurrent =
				parsed.mode === "MANIFEST_V1" &&
				manifest?.claimCount === 0 &&
				manifest.isEmpty
					? parsed.snapshot.zeroClaim !== null &&
						input.productId !== null &&
						manifest.productId === input.productId &&
						runDependencies.length === 0
					: (manifest === undefined ||
							manifest.productId === input.productId) &&
						factsAreCurrent(
							snapshotFacts,
							runDependencies,
							input.facts,
							input.productId,
						);
			return {
				id: row.id,
				inputMode: parsed.mode,
				scriptVersionId: row.scriptVersionId,
				sourceScriptRevision: row.sourceScriptRevision,
				sourceCurrent,
				status: row.status as FactLockRunStatus,
				dependenciesCurrent,
				createdAt: row.createdAt,
			};
		}),
	};
}

function inputFacts(
	snapshot: ParsedFactLockInputSnapshot | ParsedManifestFactLockInputSnapshot,
) {
	return snapshot.productFacts as FactLockProductFactSnapshot[];
}

/** Pure builder used by the workflow batch path; all DB lookup belongs to the
 * async read loader below. */
export function buildFactLockGateEvaluationInput(
	input: FactLockGateInputBuilderInput,
): FactLockGateEvaluationInput {
	return buildInput(input);
}

export async function loadFactLockGateEvaluationInput(
	actor: WorkspaceActor,
	projectId: string,
) {
	return (await loadFactLockReadContext(actor, projectId)).gateInput;
}

export const FactLockGate = {
	async evaluate(
		actor: WorkspaceActor,
		projectId: string,
	): Promise<FactLockGateResult> {
		return evaluateFactLockGate(
			await loadFactLockGateEvaluationInput(actor, projectId),
		);
	},

	async assertPassed(actor: WorkspaceActor, projectId: string) {
		const evaluation = await this.evaluate(actor, projectId);
		if (!evaluation.allowed) {
			throw new FactLockError(
				"FACT_LOCK_REQUIRED",
				"Fact Lock chưa đạt; bước downstream đang bị khóa.",
				{
					reason: evaluation.reason,
					factLockRunId: evaluation.factLockRunId,
					currentScriptVersionId: evaluation.currentScriptVersionId,
					currentScriptRevision: evaluation.currentScriptRevision,
				},
			);
		}
		return evaluation;
	},
};

export async function getFactLockGateReadModel(
	actor: WorkspaceActor,
	projectId: string,
) {
	return toFactLockReadModel(
		await loadFactLockReadContext(actor, projectId, { includeArchived: false }),
	);
}
