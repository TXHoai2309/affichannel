import {
	type ContentFormatRegistry,
	INITIAL_CONTENT_FORMAT_REGISTRY,
} from "../content-format/registry";
import { resolveContentFormatRef } from "../content-format/resolver";
import { isContentType, isCreationPath } from "./channel-first-types";

export const LEGACY_AFFILIATE_IDENTITY = Object.freeze({
	contentType: "AFFILIATE" as const,
	creationPath: "SCRIPTED" as const,
	contentFormat: Object.freeze({
		key: "SCRIPTED_STANDARD",
		version: 1,
	}),
});

export const LEGACY_PROJECT_EXCEPTION_REASONS = [
	"LEGACY_PROJECT_WITHOUT_PRODUCT",
	"INVALID_CONTENT_TYPE",
	"INVALID_CREATION_PATH",
	"PARTIAL_CHANNEL_FIRST_FIELDS",
	"INVALID_CONTENT_FORMAT_REF",
	"AFFILIATE_PRODUCT_MISSING",
	"CONTENT_FORMAT_CREATION_PATH_MISMATCH",
	"CONFLICTING_CANONICAL_STATE",
] as const;

export type LegacyProjectExceptionReason =
	(typeof LEGACY_PROJECT_EXCEPTION_REASONS)[number];

export type LegacyProjectState = {
	contentType: string | null;
	creationPath: string | null;
	contentFormatKey: string | null;
	contentFormatVersion: number | null;
	hasProduct: boolean;
};

export type LegacyProjectClassification =
	| {
			kind: "candidate";
			reasonCode: "LEGACY_COMPATIBLE_CANDIDATE";
	  }
	| { kind: "canonical" }
	| {
			kind: "exception";
			reasonCode: LegacyProjectExceptionReason;
	  };

function isAllNull(state: LegacyProjectState): boolean {
	return (
		state.contentType === null &&
		state.creationPath === null &&
		state.contentFormatKey === null &&
		state.contentFormatVersion === null
	);
}

function isStructurallyPartial(state: LegacyProjectState): boolean {
	const fields = [
		state.contentType,
		state.creationPath,
		state.contentFormatKey,
		state.contentFormatVersion,
	];
	const present = fields.filter((value) => value !== null).length;
	return present > 0 && present < fields.length;
}

/**
 * Classify persisted Project identity without consulting workflow or artifact
 * state. Branch order is the canonical AFF-US-016 AC-016-03B precedence.
 */
export function classifyLegacyProject(
	state: LegacyProjectState,
	registry: ContentFormatRegistry = INITIAL_CONTENT_FORMAT_REGISTRY,
): LegacyProjectClassification {
	if (isAllNull(state)) {
		return state.hasProduct
			? {
					kind: "candidate",
					reasonCode: "LEGACY_COMPATIBLE_CANDIDATE",
				}
			: {
					kind: "exception",
					reasonCode: "LEGACY_PROJECT_WITHOUT_PRODUCT",
				};
	}

	if (state.contentType !== null && !isContentType(state.contentType)) {
		return { kind: "exception", reasonCode: "INVALID_CONTENT_TYPE" };
	}

	if (state.creationPath !== null && !isCreationPath(state.creationPath)) {
		return { kind: "exception", reasonCode: "INVALID_CREATION_PATH" };
	}

	if (isStructurallyPartial(state)) {
		return {
			kind: "exception",
			reasonCode: "PARTIAL_CHANNEL_FIRST_FIELDS",
		};
	}

	const contentFormat = resolveContentFormatRef(
		state.contentFormatKey,
		state.contentFormatVersion,
		registry,
	);
	if (!contentFormat || contentFormat.resolution === "unsupported") {
		return { kind: "exception", reasonCode: "INVALID_CONTENT_FORMAT_REF" };
	}

	if (state.contentType === "AFFILIATE" && !state.hasProduct) {
		return { kind: "exception", reasonCode: "AFFILIATE_PRODUCT_MISSING" };
	}

	if (
		state.creationPath !== null &&
		!contentFormat.definition?.supportedCreationPaths.includes(
			state.creationPath,
		)
	) {
		return {
			kind: "exception",
			reasonCode: "CONTENT_FORMAT_CREATION_PATH_MISMATCH",
		};
	}

	return { kind: "canonical" };
}
