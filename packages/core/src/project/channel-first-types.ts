export const CONTENT_TYPES = ["ORGANIC", "AFFILIATE"] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const CREATION_PATHS = [
	"QUICK_IMAGE",
	"SCRIPTED",
	"MEDIA_FIRST",
] as const;

export type CreationPath = (typeof CREATION_PATHS)[number];

export function isContentType(value: string): value is ContentType {
	return CONTENT_TYPES.some((contentType) => contentType === value);
}

export function isCreationPath(value: string): value is CreationPath {
	return CREATION_PATHS.some((creationPath) => creationPath === value);
}
