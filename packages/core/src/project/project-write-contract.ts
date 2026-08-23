import { z } from "zod";
import type { ContentFormatRegistry } from "../content-format/registry";
import {
	getContentFormatDefinition,
	INITIAL_CONTENT_FORMAT_REGISTRY,
} from "../content-format/registry";
import { resolveContentFormatRef } from "../content-format/resolver";
import {
	CONTENT_TYPES,
	type ContentType,
	CREATION_PATHS,
	type CreationPath,
} from "./channel-first-types";
import {
	classifyLegacyProject,
	LEGACY_AFFILIATE_IDENTITY,
	type LegacyProjectExceptionReason,
} from "./legacy-affiliate-compatibility";

export const projectWriteIdentityInputSchema = z.object({
	contentType: z.string().nullable().optional(),
	creationPath: z.string().nullable().optional(),
	contentFormat: z
		.object({
			key: z.string().nullable().optional(),
			version: z.number().nullable().optional(),
		})
		.strict()
		.nullable()
		.optional(),
});

export type ProjectWriteIdentityInput = z.infer<
	typeof projectWriteIdentityInputSchema
>;

export type ProjectWriteIdentity = {
	contentType: ContentType;
	creationPath: CreationPath;
	contentFormat: {
		key: string;
		version: number;
	};
};

export type PersistedProjectIdentityState = {
	productId: string | null;
	contentType: string | null;
	creationPath: string | null;
	contentFormatKey: string | null;
	contentFormatVersion: number | null;
};

export type PersistedProjectIdentityClassification =
	| {
			kind: "legacy";
			effectiveIdentity: typeof LEGACY_AFFILIATE_IDENTITY;
	  }
	| {
			kind: "canonical";
			identity: ProjectWriteIdentity;
	  }
	| {
			kind: "rejected";
			reasonCode: LegacyProjectExceptionReason;
	  };

export const PROJECT_WRITE_IDENTITY_REJECTION_REASONS = [
	"PARTIAL_CHANNEL_FIRST_IDENTITY",
	"PARTIAL_CONTENT_FORMAT_REF",
	"INVALID_CONTENT_TYPE",
	"INVALID_CREATION_PATH",
	"INVALID_CONTENT_FORMAT_REF",
	"UNKNOWN_CONTENT_FORMAT_REF",
	"INVALID_CONTENT_FORMAT_VERSION",
	"DEPRECATED_CONTENT_FORMAT",
	"CONTENT_FORMAT_PATH_MISMATCH",
	"CHANNEL_FIRST_IDENTITY_NOT_ACTIVE",
] as const;

export type ProjectWriteIdentityRejectionReason =
	(typeof PROJECT_WRITE_IDENTITY_REJECTION_REASONS)[number];

export type ProjectWriteIdentityClassification =
	| {
			kind: "legacy";
			effectiveIdentity: typeof LEGACY_AFFILIATE_IDENTITY;
	  }
	| {
			kind: "canonical";
			identity: ProjectWriteIdentity;
			writableDuringM3: true;
	  }
	| {
			kind: "rejected";
			reasonCode: ProjectWriteIdentityRejectionReason;
	  };

const CONTENT_TYPE_SET = new Set<string>(CONTENT_TYPES);
const CREATION_PATH_SET = new Set<string>(CREATION_PATHS);

function isCompleteContentFormatRef(
	contentFormat: ProjectWriteIdentityInput["contentFormat"],
): contentFormat is { key?: string | null; version?: number | null } {
	return typeof contentFormat === "object" && contentFormat !== null;
}

function classifyRegistryReason(
	reasonCode: string | undefined,
): ProjectWriteIdentityRejectionReason {
	if (
		reasonCode === "UNKNOWN_CONTENT_FORMAT_REF" ||
		reasonCode === "INVALID_CONTENT_FORMAT_VERSION"
	) {
		return reasonCode;
	}
	return "INVALID_CONTENT_FORMAT_REF";
}

/**
 * Classifies the write-side identity without touching persistence or rollout
 * state. Legacy omission is intentionally exact: all three identity values
 * must be undefined.
 */
export function classifyProjectWriteIdentity(
	input: ProjectWriteIdentityInput,
	registry: ContentFormatRegistry = INITIAL_CONTENT_FORMAT_REGISTRY,
): ProjectWriteIdentityClassification {
	const contentFormatWasSent = input.contentFormat !== undefined;

	// A supplied but incomplete ContentFormatRef has the specific reason code,
	// even when the top-level identity is incomplete as well.
	if (contentFormatWasSent) {
		if (!isCompleteContentFormatRef(input.contentFormat)) {
			return {
				kind: "rejected",
				reasonCode: "PARTIAL_CONTENT_FORMAT_REF",
			};
		}
		if (
			input.contentFormat.key === undefined ||
			input.contentFormat.key === null ||
			input.contentFormat.version === undefined ||
			input.contentFormat.version === null
		) {
			return {
				kind: "rejected",
				reasonCode: "PARTIAL_CONTENT_FORMAT_REF",
			};
		}
	}

	if (
		input.contentType !== undefined &&
		input.contentType !== null &&
		!CONTENT_TYPE_SET.has(input.contentType)
	) {
		return { kind: "rejected", reasonCode: "INVALID_CONTENT_TYPE" };
	}
	if (
		input.creationPath !== undefined &&
		input.creationPath !== null &&
		!CREATION_PATH_SET.has(input.creationPath)
	) {
		return { kind: "rejected", reasonCode: "INVALID_CREATION_PATH" };
	}

	if (
		input.contentType === undefined &&
		input.creationPath === undefined &&
		input.contentFormat === undefined
	) {
		return {
			kind: "legacy",
			effectiveIdentity: LEGACY_AFFILIATE_IDENTITY,
		};
	}

	if (
		input.contentType === undefined ||
		input.contentType === null ||
		input.creationPath === undefined ||
		input.creationPath === null ||
		!isCompleteContentFormatRef(input.contentFormat)
	) {
		return {
			kind: "rejected",
			reasonCode: "PARTIAL_CHANNEL_FIRST_IDENTITY",
		};
	}

	const { key, version } = input.contentFormat;
	if (typeof key !== "string" || key.trim().length === 0) {
		return { kind: "rejected", reasonCode: "INVALID_CONTENT_FORMAT_REF" };
	}
	if (
		typeof version !== "number" ||
		!Number.isFinite(version) ||
		!Number.isInteger(version) ||
		version <= 0
	) {
		return {
			kind: "rejected",
			reasonCode: "INVALID_CONTENT_FORMAT_VERSION",
		};
	}

	const resolved = resolveContentFormatRef(key, version, registry);
	if (!resolved) {
		return { kind: "rejected", reasonCode: "INVALID_CONTENT_FORMAT_REF" };
	}
	if (resolved.resolution === "unsupported") {
		return {
			kind: "rejected",
			reasonCode: classifyRegistryReason(resolved.reasonCode),
		};
	}
	if (resolved.resolution === "deprecated") {
		return { kind: "rejected", reasonCode: "DEPRECATED_CONTENT_FORMAT" };
	}

	const contentType = input.contentType as ContentType;
	const creationPath = input.creationPath as CreationPath;
	const definition = getContentFormatDefinition({ key, version }, registry);
	if (!definition?.supportedCreationPaths.includes(creationPath)) {
		return { kind: "rejected", reasonCode: "CONTENT_FORMAT_PATH_MISMATCH" };
	}

	const identity: ProjectWriteIdentity = {
		contentType,
		creationPath,
		contentFormat: { key, version },
	};
	if (
		contentType === "AFFILIATE" &&
		creationPath === "SCRIPTED" &&
		key === LEGACY_AFFILIATE_IDENTITY.contentFormat.key &&
		version === LEGACY_AFFILIATE_IDENTITY.contentFormat.version
	) {
		return { kind: "canonical", identity, writableDuringM3: true };
	}

	return { kind: "rejected", reasonCode: "CHANNEL_FIRST_IDENTITY_NOT_ACTIVE" };
}

/**
 * Resolves an already-persisted Project identity for update compatibility.
 * This intentionally reuses the legacy classifier's locked precedence and
 * never infers identity from Script, Fact Lock, Voice, or other artifacts.
 */
export function classifyPersistedProjectIdentity(
	state: PersistedProjectIdentityState,
): PersistedProjectIdentityClassification {
	const classification = classifyLegacyProject({
		contentType: state.contentType,
		creationPath: state.creationPath,
		contentFormatKey: state.contentFormatKey,
		contentFormatVersion: state.contentFormatVersion,
		hasProduct: state.productId !== null,
	});

	if (classification.kind === "candidate") {
		return {
			kind: "legacy",
			effectiveIdentity: LEGACY_AFFILIATE_IDENTITY,
		};
	}

	if (classification.kind === "exception") {
		return {
			kind: "rejected",
			reasonCode: classification.reasonCode,
		};
	}

	return {
		kind: "canonical",
		identity: {
			contentType: state.contentType as ContentType,
			creationPath: state.creationPath as CreationPath,
			contentFormat: {
				key: state.contentFormatKey as string,
				version: state.contentFormatVersion as number,
			},
		},
	};
}
