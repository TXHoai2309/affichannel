import { MediaAssetError } from "./errors";

const STORAGE_KEY_PREFIX = "media/v1";
const SAFE_TOKEN = /^[A-Za-z0-9_-]+$/;
const SAFE_OBJECT_NAME = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/;

function assertToken(value: string, field: string) {
	if (!SAFE_TOKEN.test(value) || value === "." || value === "..") {
		throw new MediaAssetError(
			"MEDIA_ASSET_STORAGE_KEY_INVALID",
			`${field} cannot be used in a media storage key.`,
		);
	}
}

function assertObjectName(value: string) {
	if (!SAFE_OBJECT_NAME.test(value) || value === "." || value === "..") {
		throw new MediaAssetError(
			"MEDIA_ASSET_STORAGE_KEY_INVALID",
			"objectName cannot be used in a media storage key.",
		);
	}
}

export function createMediaAssetStorageKey(input: {
	workspaceId: string;
	assetId: string;
	objectName: string;
}) {
	assertToken(input.workspaceId, "workspaceId");
	assertToken(input.assetId, "assetId");
	assertObjectName(input.objectName);
	return `${STORAGE_KEY_PREFIX}/${input.workspaceId}/${input.assetId}/${input.objectName}`;
}

export function assertSafeMediaAssetStorageKey(value: string) {
	if (typeof value !== "string") {
		throw new MediaAssetError(
			"MEDIA_ASSET_STORAGE_KEY_INVALID",
			"Media storage key must be a string.",
		);
	}
	const parts = value.split("/");
	if (
		parts.length !== 5 ||
		parts[0] !== "media" ||
		parts[1] !== "v1" ||
		value.includes("\\") ||
		parts.some((part) => part === "" || part === "." || part === "..")
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_STORAGE_KEY_INVALID",
			"Media storage key is invalid.",
		);
	}
	for (const [index, part] of parts.entries()) {
		if (index === 2 || index === 3)
			assertToken(part, index === 2 ? "workspaceId" : "assetId");
		if (index === 4) assertObjectName(part);
	}
	return value;
}
