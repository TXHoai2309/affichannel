import {
	type CompositionPreviewDescriptorV1,
	canonicalizeCompositionJson,
	sha256Hex,
	type TechnicalPreflightResult,
} from "@affichannel/core";

const DEFAULT_PREVIEW_DESCRIPTOR_TTL_MS = 5 * 60_000;

/**
 * Creates only the protected, hash-bound handoff foundation. It does not
 * render, persist output, issue a public URL, or expose storage internals.
 */
export async function createCompositionPreviewDescriptor(
	result: TechnicalPreflightResult,
	options: {
		now?: Date;
		ttlMs?: number;
	} = {},
): Promise<CompositionPreviewDescriptorV1 | undefined> {
	if (
		result.status !== "VALID" ||
		!result.technicalManifest ||
		!result.compositionVersionId ||
		!result.compositionFingerprint
	)
		return undefined;
	const now = options.now ?? new Date();
	const ttlMs = options.ttlMs ?? DEFAULT_PREVIEW_DESCRIPTOR_TTL_MS;
	if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) return undefined;
	return {
		schemaVersion: "composition-preview-descriptor.v1",
		access: "protected",
		compositionVersionId: result.compositionVersionId,
		compositionFingerprint: result.compositionFingerprint,
		technicalManifestFingerprint: await sha256Hex(
			canonicalizeCompositionJson(result.technicalManifest),
		),
		expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
	};
}
