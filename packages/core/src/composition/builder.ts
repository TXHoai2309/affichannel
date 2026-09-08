import type { z } from "zod";
import { sha256Hex } from "../claim-manifest/canonicalization";
import { scriptVersionEditableSnapshotSchema } from "../script-version/schema";
import {
	canonicalizeCompositionJson,
	compositionSemanticProjection,
} from "./canonicalization";
import { fontBundleManifestSchema, VERTICAL_STANDARD_PROFILE } from "./profile";
import {
	type CompositionInputV1,
	type CompositionInputV1Result,
	compositionInputV1Schema,
} from "./types";

export type CompositionInputBuilderSource = Omit<
	CompositionInputV1,
	"schemaVersion" | "profile"
> & {
	profile?: CompositionInputV1["profile"];
};

function issueLooksMissing(issue: z.ZodIssue) {
	return (
		issue.code === "invalid_type" &&
		/received (undefined|null)$/.test(issue.message)
	);
}

function classifyIssues(issues: readonly z.ZodIssue[]) {
	return issues.some(issueLooksMissing)
		? ("COMPOSITION_INPUT_INCOMPLETE" as const)
		: ("COMPOSITION_INPUT_INVALID" as const);
}

export async function buildCompositionInputV1(
	source: CompositionInputBuilderSource,
): Promise<CompositionInputV1Result> {
	const candidate = {
		...source,
		schemaVersion: "composition-input.v1" as const,
		profile: source.profile ?? VERTICAL_STANDARD_PROFILE,
	};
	if (candidate.script.semantic.selectedHookKey === null) {
		return {
			ok: false,
			code: "COMPOSITION_INPUT_INCOMPLETE",
			issues: ["script.semantic.selectedHookKey"],
		};
	}
	const parsed = compositionInputV1Schema.safeParse(candidate);
	if (!parsed.success) {
		return {
			ok: false,
			code: classifyIssues(parsed.error.issues),
			issues: parsed.error.issues.map((issue) => issue.path.join(".")),
		};
	}
	const script = scriptVersionEditableSnapshotSchema.safeParse(
		parsed.data.script.semantic,
	);
	const fonts = fontBundleManifestSchema.safeParse(parsed.data.fonts);
	if (!script.success || !fonts.success)
		return { ok: false, code: "COMPOSITION_INPUT_INVALID" };
	const projection = compositionSemanticProjection(parsed.data);
	return {
		ok: true,
		input: parsed.data,
		fingerprint: await sha256Hex(canonicalizeCompositionJson(projection)),
	};
}
