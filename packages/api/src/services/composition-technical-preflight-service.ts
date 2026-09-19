import type { TechnicalPreflightResult } from "@affichannel/core";
import {
	canonicalCompositionSemanticJsonV2,
	compositionInputV2Schema,
	QUICK_IMAGE_MEDIA_DEPENDENCY_KEY,
	sha256Hex,
	VERTICAL_STANDARD_PROFILE,
} from "@affichannel/core";
import {
	CompositionTechnicalLoader,
	technicalPreflightCompositionInput,
} from "./composition-technical-loader";
import { findCompositionVersionTechnicalRecord } from "./composition-version-repository";
import type { WorkspaceActor } from "./workspace";

type CompositionTechnicalVersionRecord = {
	id: string;
	workspaceId: string;
	projectId: string;
	schemaVersion: string;
	sourceKind?: string;
	compositionInputJson: unknown;
	compositionFingerprint: string;
};

export type CompositionTechnicalPreflightDependencies = {
	findVersion?: (
		actor: WorkspaceActor,
		compositionVersionId: string,
	) => Promise<CompositionTechnicalVersionRecord | null>;
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

function quickImageTechnicalPreflight(
	compositionVersionId: string,
	value: unknown,
	compositionFingerprint: string,
): TechnicalPreflightResult {
	const parsed = compositionInputV2Schema.safeParse(value);
	if (!parsed.success)
		return {
			status: "INVALID",
			retryable: false,
			reasonCode: "INVALID_COMPOSITION_STRUCTURE",
			compositionVersionId,
			compositionFingerprint,
			issues: ["Persisted CompositionInput V2 is invalid."],
		};
	const input = parsed.data;
	if (
		JSON.stringify(input.profile) !== JSON.stringify(VERTICAL_STANDARD_PROFILE)
	)
		return {
			status: "INVALID",
			retryable: false,
			reasonCode: "INVALID_COMPOSITION_STRUCTURE",
			compositionVersionId,
			compositionFingerprint,
			issues: ["Quick Image profile is not the frozen vertical profile."],
		};
	return {
		status: "VALID",
		retryable: false,
		reasonCode: null,
		compositionVersionId,
		compositionFingerprint,
		issues: [],
		technicalManifest: {
			schemaVersion: "composition-technical-manifest.v1",
			compositionFingerprint,
			media: [
				{
					dependencyKey: QUICK_IMAGE_MEDIA_DEPENDENCY_KEY,
					mediaAssetId: input.source.mediaAssetId,
					byteSize: input.source.byteSize,
					checksumSha256: input.source.checksumSha256,
					mimeType: input.source.mimeType,
					width: input.source.width,
					height: input.source.height,
				},
			],
			voice: [],
			fonts: [],
			timing: [],
		},
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
	let record: CompositionTechnicalVersionRecord | null;
	try {
		record =
			(await (
				dependencies.findVersion ?? findCompositionVersionTechnicalRecord
			)(actor, compositionVersionId)) ?? null;
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
	if (
		record.schemaVersion === "composition-input.v2" &&
		record.sourceKind === "QUICK_IMAGE"
	) {
		try {
			if (
				(await sha256Hex(
					canonicalCompositionSemanticJsonV2(
						compositionInputV2Schema.parse(record.compositionInputJson),
					),
				)) !== record.compositionFingerprint
			)
				return invalidResult(
					compositionVersionId,
					"INVALID_COMPOSITION_STRUCTURE",
					"Persisted CompositionInput V2 fingerprint is invalid.",
				);
		} catch {
			return invalidResult(
				compositionVersionId,
				"INVALID_COMPOSITION_STRUCTURE",
				"Persisted CompositionInput V2 is invalid.",
			);
		}
		return quickImageTechnicalPreflight(
			compositionVersionId,
			record.compositionInputJson,
			record.compositionFingerprint,
		);
	}
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
