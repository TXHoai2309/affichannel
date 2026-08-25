import type { ContentFormatRegistry } from "../content-format/registry";
import { INITIAL_CONTENT_FORMAT_REGISTRY } from "../content-format/registry";
import { resolveContentFormatRef } from "../content-format/resolver";
import {
	classifyLegacyProject,
	type LegacyProjectState,
} from "./legacy-affiliate-compatibility";

export const M5_PREFLIGHT_BLOCKER_CATEGORIES = [
	"legacyAllNullIdentities",
	"partialIdentities",
	"invalidContentType",
	"invalidCreationPath",
	"invalidContentFormatVersion",
	"unknownUnsupportedContentFormat",
	"contentFormatCreationPathMismatch",
	"affiliateMissingProduct",
	"unclassifiedRows",
] as const;

export type M5PreflightBlockerCategory =
	(typeof M5_PREFLIGHT_BLOCKER_CATEGORIES)[number];

export type M5PreflightProject = LegacyProjectState & { id?: string };

export type M5PreflightSummary = {
	totalProjects: number;
	canonicalCompleteIdentities: number;
	legacyAllNullIdentities: number;
	partialIdentities: number;
	invalidContentType: number;
	invalidCreationPath: number;
	invalidContentFormatVersion: number;
	unknownUnsupportedContentFormat: number;
	deprecatedKnownContentFormat: number;
	contentFormatCreationPathMismatch: number;
	affiliateMissingProduct: number;
	unclassifiedRows: number;
};

export type M5PreflightResult = {
	summary: M5PreflightSummary;
	blockers: Readonly<Partial<Record<M5PreflightBlockerCategory, number>>>;
	diagnostics: Readonly<
		Partial<
			Record<
				M5PreflightBlockerCategory | "deprecatedKnownContentFormat",
				readonly string[]
			>
		>
	>;
	readyForM5: boolean;
};

const EMPTY_SUMMARY: M5PreflightSummary = {
	totalProjects: 0,
	canonicalCompleteIdentities: 0,
	legacyAllNullIdentities: 0,
	partialIdentities: 0,
	invalidContentType: 0,
	invalidCreationPath: 0,
	invalidContentFormatVersion: 0,
	unknownUnsupportedContentFormat: 0,
	deprecatedKnownContentFormat: 0,
	contentFormatCreationPathMismatch: 0,
	affiliateMissingProduct: 0,
	unclassifiedRows: 0,
};

type DiagnosticCategory = keyof Omit<
	M5PreflightSummary,
	"totalProjects" | "canonicalCompleteIdentities"
>;

export function createM5PreflightAccumulator(
	options: { registry?: ContentFormatRegistry; maxDiagnosticIds?: number } = {},
) {
	const registry = options.registry ?? INITIAL_CONTENT_FORMAT_REGISTRY;
	const maxDiagnosticIds = options.maxDiagnosticIds ?? 25;
	if (!Number.isInteger(maxDiagnosticIds) || maxDiagnosticIds < 0) {
		throw new Error("maxDiagnosticIds must be a non-negative integer.");
	}
	const summary = { ...EMPTY_SUMMARY };
	const diagnostics: Partial<Record<DiagnosticCategory, string[]>> = {};

	function record(category: DiagnosticCategory, projectId?: string) {
		summary[category] += 1;
		if (!projectId || maxDiagnosticIds === 0) return;
		const ids = diagnostics[category] ?? [];
		if (ids.length < maxDiagnosticIds) ids.push(projectId);
		diagnostics[category] = ids;
	}

	return {
		add(project: M5PreflightProject) {
			summary.totalProjects += 1;
			const classification = classifyLegacyProject(project, registry);

			if (classification.kind === "candidate") {
				record("legacyAllNullIdentities", project.id);
				return;
			}
			if (classification.kind === "exception") {
				switch (classification.reasonCode) {
					case "LEGACY_PROJECT_WITHOUT_PRODUCT":
						record("legacyAllNullIdentities", project.id);
						return;
					case "INVALID_CONTENT_TYPE":
						record("invalidContentType", project.id);
						return;
					case "INVALID_CREATION_PATH":
						record("invalidCreationPath", project.id);
						return;
					case "PARTIAL_CHANNEL_FIRST_FIELDS":
						record("partialIdentities", project.id);
						return;
					case "INVALID_CONTENT_FORMAT_REF": {
						const resolved = resolveContentFormatRef(
							project.contentFormatKey,
							project.contentFormatVersion,
							registry,
						);
						if (resolved?.reasonCode === "INVALID_CONTENT_FORMAT_VERSION") {
							record("invalidContentFormatVersion", project.id);
						} else {
							record("unknownUnsupportedContentFormat", project.id);
						}
						return;
					}
					case "CONTENT_FORMAT_CREATION_PATH_MISMATCH":
						record("contentFormatCreationPathMismatch", project.id);
						return;
					case "AFFILIATE_PRODUCT_MISSING":
						record("affiliateMissingProduct", project.id);
						return;
					case "CONFLICTING_CANONICAL_STATE":
						record("unclassifiedRows", project.id);
						return;
				}
			}

			summary.canonicalCompleteIdentities += 1;
			const resolved = resolveContentFormatRef(
				project.contentFormatKey,
				project.contentFormatVersion,
				registry,
			);
			if (resolved?.resolution === "deprecated") {
				record("deprecatedKnownContentFormat", project.id);
			}
		},
		finish(): M5PreflightResult {
			const blockers: Partial<Record<M5PreflightBlockerCategory, number>> = {};
			for (const category of M5_PREFLIGHT_BLOCKER_CATEGORIES) {
				if (summary[category] > 0) blockers[category] = summary[category];
			}
			return {
				summary: { ...summary },
				blockers,
				diagnostics,
				readyForM5: Object.keys(blockers).length === 0,
			};
		},
	};
}

export function runM5Preflight(
	projects: readonly M5PreflightProject[],
	options: Parameters<typeof createM5PreflightAccumulator>[0] = {},
): M5PreflightResult {
	const accumulator = createM5PreflightAccumulator(options);
	for (const project of projects) accumulator.add(project);
	return accumulator.finish();
}
