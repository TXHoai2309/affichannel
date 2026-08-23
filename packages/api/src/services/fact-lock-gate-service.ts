import {
	evaluateFactLockGate,
	FactLockError,
	type FactLockGateResult,
	type FactLockInputSnapshot,
} from "@affichannel/core";
import type { FactLockRunStatus } from "@affichannel/core/fact-lock/types";
import type { ScriptVersionEditableSnapshot } from "@affichannel/core/script-version/types";
import {
	db,
	factDependency,
	factLockRun,
	productFact,
	project,
	scriptVersion,
} from "@affichannel/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { WorkspaceActor } from "./workspace";

type GateRunRow = typeof factLockRun.$inferSelect;

function dependenciesAreCurrent(
	run: GateRunRow,
	dependencies: Array<typeof factDependency.$inferSelect>,
	facts: Array<typeof productFact.$inferSelect>,
	productId: string,
) {
	const snapshot = run.inputSnapshotJson as FactLockInputSnapshot;
	if (dependencies.length !== snapshot.productFacts.length) return false;

	const factsById = new Map(facts.map((fact) => [fact.id, fact]));
	return snapshot.productFacts.every((snapshotFact) => {
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

async function loadGateInput(actor: WorkspaceActor, projectId: string) {
	const [projectRecord] = await db
		.select({ id: project.id, productId: project.productId })
		.from(project)
		.where(
			and(
				eq(project.id, projectId),
				eq(project.workspaceId, actor.workspaceId),
				isNull(project.archivedAt),
			),
		)
		.limit(1);
	if (!projectRecord) {
		throw new FactLockError(
			"FACT_LOCK_NOT_FOUND",
			"Project không tồn tại trong workspace.",
		);
	}
	const productId = projectRecord.productId;

	const [currentScript] = await db
		.select({
			id: scriptVersion.id,
			revision: scriptVersion.revision,
			editableSnapshotJson: scriptVersion.editableSnapshotJson,
		})
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.workspaceId, actor.workspaceId),
				eq(scriptVersion.projectId, projectId),
				eq(scriptVersion.status, "draft"),
			),
		)
		.orderBy(desc(scriptVersion.updatedAt), desc(scriptVersion.id))
		.limit(1);

	const currentScriptVersion = currentScript
		? {
				id: currentScript.id,
				revision: currentScript.revision,
				snapshot:
					currentScript.editableSnapshotJson as ScriptVersionEditableSnapshot,
			}
		: null;

	const runs = await db
		.select()
		.from(factLockRun)
		.where(
			and(
				eq(factLockRun.workspaceId, actor.workspaceId),
				eq(factLockRun.projectId, projectId),
			),
		)
		.orderBy(desc(factLockRun.createdAt), desc(factLockRun.id));

	if (runs.length === 0) {
		return {
			currentScriptVersion,
			runs: [],
		};
	}

	if (productId === null) {
		return {
			currentScriptVersion,
			runs: runs.map((run) => ({
				id: run.id,
				scriptVersionId: run.scriptVersionId,
				sourceScriptRevision: run.sourceScriptRevision,
				status: run.status as FactLockRunStatus,
				dependenciesCurrent: false,
				createdAt: run.createdAt,
			})),
		};
	}

	const runIds = runs.map((run) => run.id);
	const dependencies = await db
		.select()
		.from(factDependency)
		.where(
			and(
				eq(factDependency.workspaceId, actor.workspaceId),
				eq(factDependency.dependentType, "fact_lock"),
				inArray(factDependency.dependentId, runIds),
			),
		);
	const dependencyByRun = new Map<
		string,
		Array<typeof factDependency.$inferSelect>
	>();
	for (const dependency of dependencies) {
		const current = dependencyByRun.get(dependency.dependentId) ?? [];
		current.push(dependency);
		dependencyByRun.set(dependency.dependentId, current);
	}

	const factIds = [
		...new Set(
			runs.flatMap((run) => {
				const snapshot = run.inputSnapshotJson as FactLockInputSnapshot;
				return snapshot.productFacts.map((fact) => fact.id);
			}),
		),
	];
	const facts =
		factIds.length === 0
			? []
			: await db
					.select()
					.from(productFact)
					.where(
						and(
							eq(productFact.workspaceId, actor.workspaceId),
							eq(productFact.productId, productId),
							inArray(productFact.id, factIds),
						),
					);

	return {
		currentScriptVersion,
		runs: runs.map((run) => ({
			id: run.id,
			scriptVersionId: run.scriptVersionId,
			sourceScriptRevision: run.sourceScriptRevision,
			status: run.status as FactLockRunStatus,
			dependenciesCurrent: dependenciesAreCurrent(
				run,
				dependencyByRun.get(run.id) ?? [],
				facts,
				productId,
			),
			createdAt: run.createdAt,
		})),
	};
}

export const FactLockGate = {
	async evaluate(
		actor: WorkspaceActor,
		projectId: string,
	): Promise<FactLockGateResult> {
		const input = await loadGateInput(actor, projectId);
		return evaluateFactLockGate(input);
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
