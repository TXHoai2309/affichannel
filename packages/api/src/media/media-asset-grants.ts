import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	randomUUID,
} from "node:crypto";
import {
	MediaAssetError,
	type MediaAssetStorageProvider,
} from "@affichannel/core";
import { env } from "@affichannel/env/server";

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

function grantKey() {
	return createHash("sha256")
		.update(env.MEDIA_GRANT_SIGNING_SECRET ?? env.BETTER_AUTH_SECRET)
		.digest();
}

function encode(value: string | Uint8Array) {
	return Buffer.from(value).toString("base64url");
}

function decode(value: string) {
	return Buffer.from(value, "base64url");
}

export function createLocalMediaAssetGrant(
	payload: Omit<MediaAssetGrantPayload, "provider" | "nonce">,
) {
	const fullPayload: MediaAssetGrantPayload = {
		...payload,
		provider: "local",
		nonce: randomUUID(),
	};
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", grantKey(), iv);
	const ciphertext = Buffer.concat([
		cipher.update(JSON.stringify(fullPayload), "utf8"),
		cipher.final(),
	]);
	return `m2.${encode(iv)}.${encode(ciphertext)}.${encode(cipher.getAuthTag())}`;
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
	let parsed: unknown;
	try {
		const decipher = createDecipheriv(
			"aes-256-gcm",
			grantKey(),
			decode(ivPart),
		);
		decipher.setAuthTag(decode(tagPart));
		const plaintext = Buffer.concat([
			decipher.update(decode(ciphertextPart)),
			decipher.final(),
		]);
		parsed = JSON.parse(plaintext.toString("utf8"));
	} catch {
		throw new MediaAssetError(
			"MEDIA_ASSET_GRANT_INVALID",
			"Media grant is invalid.",
		);
	}
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
	if (value.expiresAt <= Date.now()) {
		throw new MediaAssetError(
			"MEDIA_ASSET_GRANT_EXPIRED",
			"Media grant has expired.",
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
