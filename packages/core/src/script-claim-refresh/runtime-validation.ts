import { canonicalizeJson } from "../script-generation/canonical-json";
import { scriptVersionEditableSnapshotSchema } from "../script-version/schema";
import type { ScriptVersionEditableSnapshot } from "../script-version/types";
import { scriptClaimRefreshProviderOutputSchema } from "./runtime-schema";
import type {
	ScriptClaimRefreshCandidateClaim,
	ScriptClaimRefreshSourceProjection,
} from "./runtime-types";

export function buildScriptClaimRefreshSourceProjection(
	rawSnapshot: unknown,
): ScriptClaimRefreshSourceProjection {
	const parsed = scriptVersionEditableSnapshotSchema.safeParse(rawSnapshot);
	if (!parsed.success || parsed.data.selectedHookKey === null) {
		throw new TypeError("Script Claim Refresh source is not usable.");
	}
	const selectedHook = parsed.data.hookVariants.find(
		(hook) => hook.key === parsed.data.selectedHookKey,
	);
	if (!selectedHook) {
		throw new TypeError("Script Claim Refresh selected hook is not usable.");
	}
	return {
		selectedHook: { key: selectedHook.key, text: selectedHook.text },
		voiceover: parsed.data.voiceoverSegments.map((segment) => ({
			key: segment.key,
			text: segment.text,
		})),
		scenes: parsed.data.scenes.map((scene) => ({
			order: scene.order,
			onScreenText: scene.onScreenText,
		})),
		cta: { text: parsed.data.cta.text },
		caption: parsed.data.caption,
	};
}

function comparisonText(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase("vi-VN")
		.replace(/\s+/g, " ")
		.trim();
}

function sourceTextForOccurrence(
	source: ScriptClaimRefreshSourceProjection,
	occurrence: ScriptClaimRefreshCandidateClaim["occurrence"],
): string | null {
	if (occurrence.section === "hook") {
		return occurrence.hookKey === source.selectedHook.key
			? source.selectedHook.text
			: null;
	}
	if (occurrence.section === "voiceover") {
		return (
			source.voiceover.find((segment) => segment.key === occurrence.segmentKey)
				?.text ?? null
		);
	}
	if (occurrence.section === "scene") {
		return (
			source.scenes.find((scene) => scene.order === occurrence.sceneOrder)
				?.onScreenText ?? null
		);
	}
	return occurrence.section === "cta" ? source.cta.text : source.caption;
}

export const scriptClaimRefreshProviderOutputIssueCodes = [
	"MALFORMED_OUTPUT",
	"INVALID_LOCATOR",
	"CLAIM_NOT_GROUNDED",
] as const;

export type ScriptClaimRefreshProviderOutputIssueCode =
	(typeof scriptClaimRefreshProviderOutputIssueCodes)[number];

export type ScriptClaimRefreshProviderOutputValidation =
	| {
			success: true;
			claims: readonly ScriptClaimRefreshCandidateClaim[];
	  }
	| {
			success: false;
			issueCodes: readonly ScriptClaimRefreshProviderOutputIssueCode[];
	  };

export function validateScriptClaimRefreshProviderOutput(
	rawOutput: unknown,
	source: ScriptClaimRefreshSourceProjection,
): ScriptClaimRefreshProviderOutputValidation {
	const parsed = scriptClaimRefreshProviderOutputSchema.safeParse(rawOutput);
	if (!parsed.success) {
		return { success: false, issueCodes: ["MALFORMED_OUTPUT"] };
	}
	const issueCodes = new Set<ScriptClaimRefreshProviderOutputIssueCode>();
	for (const claim of parsed.data.claims) {
		const sourceText = sourceTextForOccurrence(source, claim.occurrence);
		if (!sourceText) {
			issueCodes.add("INVALID_LOCATOR");
			continue;
		}
		if (!comparisonText(sourceText).includes(comparisonText(claim.text))) {
			issueCodes.add("CLAIM_NOT_GROUNDED");
		}
	}
	return issueCodes.size > 0
		? { success: false, issueCodes: [...issueCodes] }
		: {
				success: true,
				claims: orderScriptClaimRefreshCandidates(parsed.data.claims, source),
			};
}

function occurrenceRank(
	source: ScriptClaimRefreshSourceProjection,
	occurrence: ScriptClaimRefreshCandidateClaim["occurrence"],
): number {
	if (occurrence.section === "hook") return 0;
	if (occurrence.section === "voiceover") {
		return (
			1 +
			source.voiceover.findIndex(
				(segment) => segment.key === occurrence.segmentKey,
			)
		);
	}
	if (occurrence.section === "scene") {
		return 1 + source.voiceover.length + occurrence.sceneOrder;
	}
	if (occurrence.section === "cta")
		return 2 + source.voiceover.length + source.scenes.length;
	return 3 + source.voiceover.length + source.scenes.length;
}

export function orderScriptClaimRefreshCandidates(
	claims: readonly ScriptClaimRefreshCandidateClaim[],
	source: ScriptClaimRefreshSourceProjection,
): readonly ScriptClaimRefreshCandidateClaim[] {
	return [...claims].sort((left, right) => {
		const rankDifference =
			occurrenceRank(source, left.occurrence) -
			occurrenceRank(source, right.occurrence);
		if (rankDifference !== 0) return rankDifference;
		return comparisonText(left.text).localeCompare(
			comparisonText(right.text),
			"vi",
		);
	});
}

export function scriptClaimRefreshSourceProjectionJson(
	snapshot: ScriptVersionEditableSnapshot,
): string {
	return canonicalizeJson(buildScriptClaimRefreshSourceProjection(snapshot));
}
