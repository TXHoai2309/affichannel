import type { CreationPath } from "../project/channel-first-types";

export type ContentFormatRef = {
	readonly key: string;
	readonly version: number;
};

export type ContentFormatRawRef = {
	readonly key: string | null;
	readonly version: number | null;
};

export type ContentFormatAvailability = "active" | "deprecated";

export type ContentFormatDefinition = {
	readonly ref: ContentFormatRef;
	readonly label: string;
	readonly description?: string;
	readonly supportedCreationPaths: readonly CreationPath[];
	readonly availability: ContentFormatAvailability;
};

export const CONTENT_FORMAT_RESOLUTIONS = [
	"resolved",
	"deprecated",
	"unsupported",
] as const;

export type ContentFormatResolution =
	(typeof CONTENT_FORMAT_RESOLUTIONS)[number];

export const CONTENT_FORMAT_UNSUPPORTED_REASON_CODES = [
	"UNKNOWN_CONTENT_FORMAT_REF",
	"PARTIAL_CONTENT_FORMAT_REF",
	"INVALID_CONTENT_FORMAT_VERSION",
] as const;

export type ContentFormatUnsupportedReasonCode =
	(typeof CONTENT_FORMAT_UNSUPPORTED_REASON_CODES)[number];

export type ContentFormatReadModel = {
	ref: ContentFormatRawRef;
	resolution: ContentFormatResolution;
	definition: ContentFormatDefinition | null;
	reasonCode?: ContentFormatUnsupportedReasonCode;
};
