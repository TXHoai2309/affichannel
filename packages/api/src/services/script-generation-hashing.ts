import { createHash } from "node:crypto";
import { canonicalizeJson } from "@affichannel/core/script-generation/canonical-json";

export function sha256Hex(value: string | unknown) {
	const input = typeof value === "string" ? value : canonicalizeJson(value);
	return createHash("sha256").update(input, "utf8").digest("hex");
}
