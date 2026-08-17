import { canonicalizeJson } from "../script-generation/canonical-json";
import { scriptDraftSchema } from "../script-generation/schema";
import { scriptVersionEditableSnapshotSchema } from "./schema";
import type { ScriptVersionEditableSnapshot } from "./types";

export function validateScriptVersionDraft(raw: unknown) {
	return scriptVersionEditableSnapshotSchema.safeParse(raw);
}

export function validateScriptVersionForFactLock(
	snapshot: ScriptVersionEditableSnapshot,
) {
	const result = scriptVersionEditableSnapshotSchema.safeParse(snapshot);
	if (!result.success) return result;

	const strictDraft = scriptDraftSchema.safeParse({
		schemaVersion: result.data.schemaVersion,
		language: result.data.language,
		hookVariants: result.data.hookVariants,
		voiceoverSegments: result.data.voiceoverSegments,
		scenes: result.data.scenes,
		cta: result.data.cta,
		caption: result.data.caption,
		hashtags: result.data.hashtags,
		disclosure: result.data.disclosure,
		claims: result.data.claims,
	});
	const issues = [...(strictDraft.success ? [] : strictDraft.error.issues)];
	if (result.data.selectedHookKey === null) {
		issues.push({
			code: "custom",
			path: ["selectedHookKey"],
			message: "A hook must be selected before Fact Lock.",
		});
	}
	if (result.data.claimsStatus !== "current") {
		issues.push({
			code: "custom",
			path: ["claimsStatus"],
			message: "Claims must be current before Fact Lock.",
		});
	}
	if (issues.length > 0) {
		return {
			success: false as const,
			error: { issues },
		};
	}
	return result;
}

function claimRelevantContent(snapshot: ScriptVersionEditableSnapshot) {
	return {
		selectedHookKey: snapshot.selectedHookKey,
		hookVariants: snapshot.hookVariants,
		voiceoverSegments: snapshot.voiceoverSegments,
		cta: snapshot.cta,
		disclosure: snapshot.disclosure,
		caption: snapshot.caption,
		scenes: snapshot.scenes.map((scene) => scene.onScreenText),
	};
}

export function hasClaimRelevantScriptVersionChanges(
	previous: ScriptVersionEditableSnapshot,
	next: ScriptVersionEditableSnapshot,
) {
	return (
		canonicalizeJson(claimRelevantContent(previous)) !==
		canonicalizeJson(claimRelevantContent(next))
	);
}

export function mergeScriptVersionAutosave(
	previous: ScriptVersionEditableSnapshot,
	submitted: ScriptVersionEditableSnapshot,
) {
	const claimsStale = hasClaimRelevantScriptVersionChanges(previous, submitted);
	return {
		...submitted,
		schemaVersion: previous.schemaVersion,
		language: previous.language,
		claims: previous.claims,
		claimsSourceRevision: previous.claimsSourceRevision,
		claimsStatus: claimsStale ? "stale" : previous.claimsStatus,
	} satisfies ScriptVersionEditableSnapshot;
}
