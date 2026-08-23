import {
	CREATION_PATHS,
	type CreationPath,
} from "../project/channel-first-types";
import type { ContentFormatDefinition, ContentFormatRef } from "./types";

export const INITIAL_CONTENT_FORMAT_REGISTRY = [
	Object.freeze({
		ref: Object.freeze({ key: "SCRIPTED_STANDARD", version: 1 }),
		label: "Scripted Standard",
		description: "Định dạng nội dung scripted tiêu chuẩn.",
		supportedCreationPaths: Object.freeze(["SCRIPTED"] as const),
		availability: "active",
	}),
	Object.freeze({
		ref: Object.freeze({ key: "QUICK_IMAGE_STANDARD", version: 1 }),
		label: "Quick Image Standard",
		description: "Định dạng video cơ bản tạo từ một ảnh.",
		supportedCreationPaths: Object.freeze(["QUICK_IMAGE"] as const),
		availability: "active",
	}),
	Object.freeze({
		ref: Object.freeze({ key: "MEDIA_FIRST_STANDARD", version: 1 }),
		label: "Media First Standard",
		description: "Định dạng nội dung bắt đầu từ media.",
		supportedCreationPaths: Object.freeze(["MEDIA_FIRST"] as const),
		availability: "active",
	}),
] as const satisfies readonly ContentFormatDefinition[];

Object.freeze(INITIAL_CONTENT_FORMAT_REGISTRY);

export type ContentFormatRegistry = readonly ContentFormatDefinition[];

export const CONTENT_FORMAT_DEFAULTS: Readonly<
	Record<CreationPath, ContentFormatRef>
> = Object.freeze({
	QUICK_IMAGE: INITIAL_CONTENT_FORMAT_REGISTRY[1].ref,
	SCRIPTED: INITIAL_CONTENT_FORMAT_REGISTRY[0].ref,
	MEDIA_FIRST: INITIAL_CONTENT_FORMAT_REGISTRY[2].ref,
});

export type RegistryValidationIssue =
	| "DUPLICATE_CONTENT_FORMAT_REF"
	| "INVALID_CONTENT_FORMAT_VERSION"
	| "MISSING_DEFAULT_CONTENT_FORMAT"
	| "DEFAULT_CONTENT_FORMAT_NOT_ACTIVE"
	| "DEFAULT_CONTENT_FORMAT_PATH_MISMATCH";

export type RegistryValidationResult =
	| { success: true }
	| { success: false; issues: RegistryValidationIssue[] };

function refIdentity(ref: ContentFormatRef) {
	return `${ref.key}\u0000${ref.version}`;
}

export function validateContentFormatRegistry(
	registry: ContentFormatRegistry,
	defaults: Readonly<Record<CreationPath, ContentFormatRef>>,
): RegistryValidationResult {
	const issues: RegistryValidationIssue[] = [];
	const identities = new Set<string>();

	for (const definition of registry) {
		if (
			!Number.isInteger(definition.ref.version) ||
			definition.ref.version <= 0
		) {
			issues.push("INVALID_CONTENT_FORMAT_VERSION");
		}

		const identity = refIdentity(definition.ref);
		if (identities.has(identity)) {
			issues.push("DUPLICATE_CONTENT_FORMAT_REF");
		}
		identities.add(identity);
	}

	for (const creationPath of CREATION_PATHS) {
		const defaultRef = defaults[creationPath];
		if (!defaultRef) {
			issues.push("MISSING_DEFAULT_CONTENT_FORMAT");
			continue;
		}

		const definition = registry.find(
			(candidate) => refIdentity(candidate.ref) === refIdentity(defaultRef),
		);
		if (!definition) {
			issues.push("MISSING_DEFAULT_CONTENT_FORMAT");
			continue;
		}
		if (definition.availability !== "active") {
			issues.push("DEFAULT_CONTENT_FORMAT_NOT_ACTIVE");
		}
		if (!definition.supportedCreationPaths.includes(creationPath)) {
			issues.push("DEFAULT_CONTENT_FORMAT_PATH_MISMATCH");
		}
	}

	return issues.length === 0 ? { success: true } : { success: false, issues };
}

const initialRegistryValidation = validateContentFormatRegistry(
	INITIAL_CONTENT_FORMAT_REGISTRY,
	CONTENT_FORMAT_DEFAULTS,
);
if (!initialRegistryValidation.success) {
	throw new Error(
		`Invalid initial ContentFormat registry: ${initialRegistryValidation.issues.join(", ")}`,
	);
}

export function getContentFormatDefinition(
	ref: ContentFormatRef,
	registry: ContentFormatRegistry = INITIAL_CONTENT_FORMAT_REGISTRY,
) {
	return registry.find(
		(definition) => refIdentity(definition.ref) === refIdentity(ref),
	);
}

export type ContentFormatAssignmentResult =
	| { success: true; definition: ContentFormatDefinition }
	| {
			success: false;
			reason:
				| "UNKNOWN_CONTENT_FORMAT_REF"
				| "DEPRECATED_CONTENT_FORMAT"
				| "CONTENT_FORMAT_PATH_MISMATCH";
	  };

export function validateContentFormatAssignment(
	ref: ContentFormatRef,
	creationPath: CreationPath,
	registry: ContentFormatRegistry = INITIAL_CONTENT_FORMAT_REGISTRY,
): ContentFormatAssignmentResult {
	const definition = getContentFormatDefinition(ref, registry);
	if (!definition) {
		return { success: false, reason: "UNKNOWN_CONTENT_FORMAT_REF" };
	}
	if (definition.availability !== "active") {
		return { success: false, reason: "DEPRECATED_CONTENT_FORMAT" };
	}
	if (!definition.supportedCreationPaths.includes(creationPath)) {
		return { success: false, reason: "CONTENT_FORMAT_PATH_MISMATCH" };
	}
	return { success: true, definition };
}

export function getDefaultContentFormatRef(
	creationPath: CreationPath,
): ContentFormatRef {
	return CONTENT_FORMAT_DEFAULTS[creationPath];
}
