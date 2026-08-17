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
	findScriptVersion,
	hasInvalidatedSourceDependency,
	insertScriptVersionDraft,
	isUniqueViolation,
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
