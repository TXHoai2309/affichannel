import { createHash } from "node:crypto";
import type { VoiceSegmentFingerprint } from "@affichannel/core";
import { canonicalizeJson } from "@affichannel/core/script-generation/canonical-json";

export function sha256Hex(value: string) {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Bytes(value: Uint8Array) {
	return createHash("sha256")
		.update(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
		.digest("hex");
}

export function hashVoiceSegmentText(segmentTextSnapshot: string) {
	return sha256Hex(segmentTextSnapshot);
}

export function hashVoiceSegmentRequest(fingerprint: VoiceSegmentFingerprint) {
	return sha256Hex(
		canonicalizeJson({
			operation: "voice-segment-generation",
			fingerprint,
		}),
	);
}
