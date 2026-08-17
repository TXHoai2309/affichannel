import type { ScriptVersionEditableSnapshot } from "@affichannel/core";
import {
	mergeScriptVersionAutosave,
	ScriptVersionError,
	scriptDraftSchema,
	validateScriptVersionDraft,
} from "@affichannel/core";
import {
	findCurrentScriptVersion,
	findInitializeSource,
	findSavedScriptVersion,
	findScriptVersion,
	hasAccessibleProject,
	hasInvalidatedSourceDependency,
	insertScriptVersionDraft,
	isUniqueViolation,
	listScriptVersionHistory,
	restoreScriptVersionRecord,
	saveScriptVersionRecord,
	updateDraftScriptVersion,
} from "./script-version-repository";
import type { WorkspaceActor } from "./workspace";

function createInitialSnapshot(
	outputJson: unknown,
): ScriptVersionEditableSnapshot {
	const parsed = scriptDraftSchema.safeParse(outputJson);
	if (!parsed.success) {
		throw new ScriptVersionError(
			"SCRIPT_GENERATION_NOT_EDITABLE",
			"The completed generation output is not a valid ScriptDraft.",
		);
	}
	return {
		...parsed.data,
		selectedHookKey: null,
		claimsSourceRevision: 1,
		claimsStatus: "current",
	};
}

export async function initializeScriptVersion(
	actor: WorkspaceActor,
	input: { projectId: string; sourceGenerationId: string },
) {
	const source = await findInitializeSource(
		actor,
		input.projectId,
		input.sourceGenerationId,
	);
	if (!source) {
		throw new ScriptVersionError("SCRIPT_GENERATION_NOT_FOUND");
	}
	if (source.status !== "completed" || !source.outputJson) {
		throw new ScriptVersionError("SCRIPT_GENERATION_NOT_EDITABLE");
	}
	if (await hasInvalidatedSourceDependency(actor, source.id)) {
		throw new ScriptVersionError("SCRIPT_GENERATION_INVALIDATED");
	}

	const existing = await findCurrentScriptVersion(actor, input.projectId);
	if (existing) {
		if (existing.sourceGenerationId === input.sourceGenerationId)
			return existing;
		throw new ScriptVersionError("SCRIPT_VERSION_DRAFT_ALREADY_EXISTS");
	}

	const editableSnapshot = createInitialSnapshot(source.outputJson);
	try {
		return await insertScriptVersionDraft({
			actor,
			projectId: input.projectId,
			sourceGenerationId: input.sourceGenerationId,
			editableSnapshot,
		});
	} catch (error) {
		if (!isUniqueViolation(error)) throw error;
		const concurrentDraft = await findCurrentScriptVersion(
			actor,
			input.projectId,
		);
		if (
			concurrentDraft &&
			concurrentDraft.sourceGenerationId === input.sourceGenerationId
		) {
			return concurrentDraft;
		}
		throw new ScriptVersionError("SCRIPT_VERSION_DRAFT_ALREADY_EXISTS");
	}
}

export async function getCurrentScriptVersion(
	actor: WorkspaceActor,
	projectId: string,
) {
	return (await findCurrentScriptVersion(actor, projectId)) ?? null;
}

export async function autosaveScriptVersion(
	actor: WorkspaceActor,
	input: {
		scriptVersionId: string;
		baseRevision: number;
		editableSnapshot: unknown;
	},
) {
	const current = await findScriptVersion(actor, input.scriptVersionId);
	if (!current) throw new ScriptVersionError("SCRIPT_VERSION_NOT_FOUND");
	if (current.status !== "draft") {
		throw new ScriptVersionError("SCRIPT_VERSION_IMMUTABLE");
	}
	if (current.revision !== input.baseRevision) {
		throw new ScriptVersionError(
			"SCRIPT_VERSION_CONFLICT",
			"SCRIPT_VERSION_CONFLICT",
			{
				latestRevision: current.revision,
			},
		);
	}

	const parsed = validateScriptVersionDraft(input.editableSnapshot);
	if (!parsed.success) {
		throw new ScriptVersionError("INVALID_SCRIPT_VERSION_SNAPSHOT");
	}
	const nextSnapshot = mergeScriptVersionAutosave(
		current.editableSnapshot,
		parsed.data as ScriptVersionEditableSnapshot,
	);
	if (!nextSnapshot) {
		throw new ScriptVersionError("INVALID_SCRIPT_VERSION_SNAPSHOT");
	}
	const finalValidation = validateScriptVersionDraft(nextSnapshot);
	if (!finalValidation.success) {
		throw new ScriptVersionError("INVALID_SCRIPT_VERSION_SNAPSHOT");
	}
	const updated = await updateDraftScriptVersion({
		actor,
		scriptVersionId: input.scriptVersionId,
		baseRevision: input.baseRevision,
		editableSnapshot: nextSnapshot,
	});
	if (updated) return updated;

	const latest = await findScriptVersion(actor, input.scriptVersionId);
	if (!latest) throw new ScriptVersionError("SCRIPT_VERSION_NOT_FOUND");
	if (latest.status !== "draft") {
		throw new ScriptVersionError("SCRIPT_VERSION_IMMUTABLE");
	}
	throw new ScriptVersionError(
		"SCRIPT_VERSION_CONFLICT",
		"SCRIPT_VERSION_CONFLICT",
		{
			latestRevision: latest.revision,
		},
	);
}

function throwScriptVersionMutationError(
	result:
		| { kind: "not_found" }
		| { kind: "immutable" }
		| { kind: "invalid_snapshot" }
		| { kind: "conflict"; latestRevision: number },
): never {
	if (result.kind === "not_found") {
		throw new ScriptVersionError("SCRIPT_VERSION_NOT_FOUND");
	}
	if (result.kind === "immutable") {
		throw new ScriptVersionError("SCRIPT_VERSION_IMMUTABLE");
	}
	if (result.kind === "invalid_snapshot") {
		throw new ScriptVersionError("INVALID_SCRIPT_VERSION_SNAPSHOT");
	}
	throw new ScriptVersionError(
		"SCRIPT_VERSION_CONFLICT",
		"SCRIPT_VERSION_CONFLICT",
		{ latestRevision: result.latestRevision },
	);
}

export async function saveScriptVersion(
	actor: WorkspaceActor,
	input: { scriptVersionId: string; baseRevision: number },
) {
	const result = await saveScriptVersionRecord({ actor, ...input });
	if (result.kind !== "success") throwScriptVersionMutationError(result);
	return result.record;
}

export async function listScriptVersionHistoryForProject(
	actor: WorkspaceActor,
	projectId: string,
) {
	if (!(await hasAccessibleProject(actor, projectId))) {
		throw new ScriptVersionError("SCRIPT_VERSION_NOT_FOUND");
	}
	return listScriptVersionHistory(actor, projectId);
}

export async function getSavedScriptVersion(
	actor: WorkspaceActor,
	input: { projectId: string; versionId: string },
) {
	const record = await findSavedScriptVersion(
		actor,
		input.projectId,
		input.versionId,
	);
	if (!record) throw new ScriptVersionError("SCRIPT_VERSION_NOT_FOUND");
	return record;
}

export async function restoreScriptVersion(
	actor: WorkspaceActor,
	input: { scriptVersionId: string; versionId: string; baseRevision: number },
) {
	const result = await restoreScriptVersionRecord({
		actor,
		draftId: input.scriptVersionId,
		savedVersionId: input.versionId,
		baseRevision: input.baseRevision,
	});
	if (result.kind !== "success") throwScriptVersionMutationError(result);
	return result.record;
}
