import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	randomUUID,
} from "node:crypto";
import { MediaAssetError } from "@affichannel/core";
import { env } from "@affichannel/env/server";

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

/** Shared authenticated-encryption primitive for US020 and preview grants. */
export function createProtectedGrant(payload: Record<string, unknown>) {
	const fullPayload = {
		...payload,
		nonce: payload.nonce ?? randomUUID(),
	};
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", grantKey(), iv);
	const ciphertext = Buffer.concat([
		cipher.update(JSON.stringify(fullPayload), "utf8"),
		cipher.final(),
	]);
	return `m2.${encode(iv)}.${encode(ciphertext)}.${encode(cipher.getAuthTag())}`;
}

export function verifyProtectedGrant(token: string, nowMs = Date.now()) {
	if (typeof token !== "string") {
		throw new MediaAssetError(
			"MEDIA_ASSET_GRANT_INVALID",
			"Media grant is invalid.",
		);
	}
	const parts = token.split(".");
	if (
		parts.length !== 4 ||
		parts[0] !== "m2" ||
		!parts[1] ||
		!parts[2] ||
		!parts[3]
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
			decode(parts[1]),
		);
		decipher.setAuthTag(decode(parts[3]));
		const plaintext = Buffer.concat([
			decipher.update(decode(parts[2])),
			decipher.final(),
		]);
		parsed = JSON.parse(plaintext.toString("utf8"));
	} catch {
		throw new MediaAssetError(
			"MEDIA_ASSET_GRANT_INVALID",
			"Media grant is invalid.",
		);
	}
	if (
		!parsed ||
		typeof parsed !== "object" ||
		Array.isArray(parsed) ||
		typeof (parsed as { expiresAt?: unknown }).expiresAt !== "number" ||
		!Number.isSafeInteger((parsed as { expiresAt: number }).expiresAt)
	) {
		throw new MediaAssetError(
			"MEDIA_ASSET_GRANT_INVALID",
			"Media grant is invalid.",
		);
	}
	if ((parsed as { expiresAt: number }).expiresAt <= nowMs) {
		throw new MediaAssetError(
			"MEDIA_ASSET_GRANT_EXPIRED",
			"Media grant has expired.",
		);
	}
	return parsed as Record<string, unknown>;
}
