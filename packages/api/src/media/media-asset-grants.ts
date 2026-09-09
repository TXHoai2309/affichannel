import {
	MediaAssetError,
	type MediaAssetStorageProvider,
} from "@affichannel/core";
import { createProtectedGrant, verifyProtectedGrant } from "./protected-grants";

type GrantPurpose = "upload" | "download";

export type MediaAssetGrantPayload = Readonly<{
	purpose: GrantPurpose;
	provider: "local";
	workspaceId: string;
	assetId: string;
	storageKey: string;
	uploadSessionId?: string;
	contentType: string;
	byteSize?: number;
	strictByteSize?: boolean;
	expiresAt: number;
	nonce: string;
}>;

export function createLocalMediaAssetGrant(
	payload: Omit<MediaAssetGrantPayload, "provider" | "nonce">,
) {
	return createProtectedGrant({ ...payload, provider: "local" });
}

export function verifyLocalMediaAssetGrant(
	token: string,
	purpose: GrantPurpose,
): MediaAssetGrantPayload {
	if (typeof token !== "string") {
		throw new MediaAssetError(
			"MEDIA_ASSET_GRANT_INVALID",
			"Media grant is invalid.",
		);
	}
	const parts = token.split(".");
	const version = parts[0];
	const ivPart = parts[1];
	const ciphertextPart = parts[2];
	const tagPart = parts[3];
	if (
		parts.length !== 4 ||
		version !== "m2" ||
		!ivPart ||
		!ciphertextPart ||
		!tagPart
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_GRANT_INVALID",
			"Media grant is invalid.",
		);
	}
	const parsed = verifyProtectedGrant(token);
	const value = parsed as Partial<MediaAssetGrantPayload>;
	if (
		value.purpose !== purpose ||
		value.provider !== "local" ||
		typeof value.workspaceId !== "string" ||
		typeof value.assetId !== "string" ||
		typeof value.storageKey !== "string" ||
		typeof value.contentType !== "string" ||
		typeof value.expiresAt !== "number" ||
		!Number.isSafeInteger(value.expiresAt) ||
		typeof value.nonce !== "string" ||
		(purpose === "upload" &&
			(typeof value.uploadSessionId !== "string" ||
				typeof value.byteSize !== "number" ||
				!Number.isSafeInteger(value.byteSize) ||
				value.byteSize <= 0 ||
				(value.strictByteSize !== undefined &&
					typeof value.strictByteSize !== "boolean")))
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_GRANT_INVALID",
			"Media grant is invalid.",
		);
	}
	return value as MediaAssetGrantPayload;
}

export function grantProviderMatches(
	provider: MediaAssetStorageProvider,
	token: MediaAssetGrantPayload,
) {
	return provider === "local" && token.provider === "local";
}
