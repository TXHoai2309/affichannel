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

export async function buildCompositionInputV1(
	source: CompositionInputBuilderSource,
): Promise<CompositionInputV1Result> {
	const script = scriptVersionEditableSnapshotSchema.safeParse(
		source.script.semantic,
	);
	const fonts = fontBundleManifestSchema.safeParse(source.fonts);
	if (!script.success || !fonts.success)
		return { ok: false, code: "COMPOSITION_INPUT_INCOMPLETE" };
	const candidate = {
		...source,
		schemaVersion: "composition-input.v1" as const,
		profile: source.profile ?? VERTICAL_STANDARD_PROFILE,
		script: { ...source.script, semantic: script.data },
	};
	const parsed = compositionInputV1Schema.safeParse(candidate);
	if (!parsed.success) {
		return {
			ok: false,
			code: "COMPOSITION_INPUT_INCOMPLETE",
			issues: parsed.error.issues.map((issue) => issue.path.join(".")),
		};
	}
	const projection = compositionSemanticProjection(parsed.data);
	return {
		ok: true,
		input: parsed.data,
		fingerprint: await sha256Hex(canonicalizeCompositionJson(projection)),
	};
}
