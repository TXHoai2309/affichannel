import {
	type ContentFormatRegistry,
	getContentFormatDefinition,
	INITIAL_CONTENT_FORMAT_REGISTRY,
} from "./registry";
import type {
	ContentFormatDefinition,
	ContentFormatRawRef,
	ContentFormatReadModel,
	ContentFormatRef,
} from "./types";

function unsupported(
	ref: ContentFormatRawRef,
	reasonCode: ContentFormatReadModel["reasonCode"],
): ContentFormatReadModel {
	return {
		ref,
		resolution: "unsupported",
		definition: null,
		...(reasonCode ? { reasonCode } : {}),
	};
}

export function resolveContentFormatRef(
	key: string | null,
	version: number | null,
	registry: ContentFormatRegistry = INITIAL_CONTENT_FORMAT_REGISTRY,
): ContentFormatReadModel | null {
	if (key === null && version === null) return null;

	const rawRef: ContentFormatRawRef = { key, version };
	if (key === null || version === null) {
		return unsupported(rawRef, "PARTIAL_CONTENT_FORMAT_REF");
	}
	if (!Number.isInteger(version) || version <= 0) {
		return unsupported(rawRef, "INVALID_CONTENT_FORMAT_VERSION");
	}

	const ref: ContentFormatRef = { key, version };
	const definition = getContentFormatDefinition(ref, registry);
	if (!definition) {
		return unsupported(rawRef, "UNKNOWN_CONTENT_FORMAT_REF");
	}

	return {
		ref: { ...ref },
		resolution:
			definition.availability === "deprecated" ? "deprecated" : "resolved",
		definition,
	};
}

export function resolveContentFormatDefinition(
	ref: ContentFormatRef,
	registry: ContentFormatRegistry = INITIAL_CONTENT_FORMAT_REGISTRY,
): ContentFormatDefinition | undefined {
	return getContentFormatDefinition(ref, registry);
}
