import { canonicalizeJson } from "../script-generation/canonical-json";
import type { ClaimManifestLocator } from "./types";

export function canonicalClaimSourceText(text: string): string {
	return text.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
}

export function canonicalClaimManifestLocator(
	locator: ClaimManifestLocator,
): string {
	return canonicalizeJson(locator);
}

export async function sha256Hex(value: string | unknown): Promise<string> {
	const input = typeof value === "string" ? value : canonicalizeJson(value);
	const digest = await globalThis.crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(input),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function claimManifestSourceTextHash(
	sourceText: string,
): Promise<string> {
	return sha256Hex(canonicalClaimSourceText(sourceText));
}
