import { createHash } from "node:crypto";

export function sha256Bytes(value: Uint8Array) {
	return createHash("sha256")
		.update(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
		.digest("hex");
}
