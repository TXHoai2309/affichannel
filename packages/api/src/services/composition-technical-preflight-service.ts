import type { TechnicalPreflightResult } from "@affichannel/core";

import {
	CompositionTechnicalLoader,
	technicalPreflightCompositionInput,
} from "./composition-technical-loader";
import { findCompositionVersionTechnicalRecord } from "./composition-version-repository";
import type { WorkspaceActor } from "./workspace";

export type CompositionTechnicalPreflightDependencies = {
	findVersion?: typeof findCompositionVersionTechnicalRecord;
	preflightInput?: typeof technicalPreflightCompositionInput;
};

function invalidResult(
	compositionVersionId: string,
	reasonCode:
		| "INVALID_COMPOSITION_STRUCTURE"
		| "UNSUPPORTED_COMPOSITION_SCHEMA",
	issue: string,
): TechnicalPreflightResult {
	return {
		status:
			reasonCode === "UNSUPPORTED_COMPOSITION_SCHEMA"
				? "UNSUPPORTED"
				: "INVALID",
		retryable: false,
		reasonCode,
		compositionVersionId,
		compositionFingerprint: null,
		issues: [issue],
	};
}

/**
 * Read-only technical preflight for one exact, workspace-scoped version. This
 * deliberately does not call business currentness or execution authorization.
 */
export async function technicalPreflightCompositionVersion(
	actor: WorkspaceActor,
	compositionVersionId: string,
	loader?: CompositionTechnicalLoader,
	dependencies: CompositionTechnicalPreflightDependencies = {},
): Promise<TechnicalPreflightResult> {
	let record: Awaited<ReturnType<typeof findCompositionVersionTechnicalRecord>>;
	try {
		record = await (
			dependencies.findVersion ?? findCompositionVersionTechnicalRecord
		)(actor, compositionVersionId);
	} catch {
		return invalidResult(
			compositionVersionId,
			"INVALID_COMPOSITION_STRUCTURE",
			"CompositionVersion could not be loaded in the requested workspace.",
		);
	}
	if (!record)
		return invalidResult(
			compositionVersionId,
			"INVALID_COMPOSITION_STRUCTURE",
			"CompositionVersion is missing in the requested workspace.",
		);
	if (record.schemaVersion !== "composition-input.v1")
		return invalidResult(
			compositionVersionId,
			"UNSUPPORTED_COMPOSITION_SCHEMA",
			"Composition schema version is not supported by the technical loader.",
		);
	const scopedLoader =
		loader ??
		new CompositionTechnicalLoader({ actor, projectId: record.projectId });
	return (dependencies.preflightInput ?? technicalPreflightCompositionInput)(
		scopedLoader,
		compositionVersionId,
		record.compositionInputJson,
		record.compositionFingerprint,
	);
}
