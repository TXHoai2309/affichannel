import {
	type CompositionPreviewDescriptorV1,
	type CompositionPreviewDescriptorV2,
	canonicalizeCompositionJson,
	sha256Hex,
	type TechnicalPreflightResult,
} from "@affichannel/core";
import {
	createQuickImagePreviewDependencyGrantFromValidated,
	type PreviewGrantDependencies,
} from "./composition-preview-grants";
import { preflightQuickImageCompositionVersion } from "./quick-image-preview-preflight";
import type { WorkspaceActor } from "./workspace";

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

/**
 * Creates the protected V2 Quick Image preview descriptor from one explicit
 * project/version pair. No current source or settings are consulted.
 */
export async function createQuickImageCompositionPreviewDescriptor(
	actor: WorkspaceActor,
	projectId: string,
	compositionVersionId: string,
	options: PreviewGrantDependencies = {},
): Promise<CompositionPreviewDescriptorV2> {
	const preflight = await preflightQuickImageCompositionVersion(
		actor,
		projectId,
		compositionVersionId,
		{
			findVersion: options.findVersion,
			findMediaAsset: options.findMediaAsset,
		},
	);
	if (!preflight.ok) {
		throw new CompositionPreviewDescriptorAccessError(
			preflight.code,
			preflight.message,
		);
	}
	const validated = preflight.value;
	const grant = await createQuickImagePreviewDependencyGrantFromValidated(
		actor,
		validated,
		{ now: options.now?.(), ttlMs: options.ttlMs },
	);
	const { input } = validated;
	return {
		schemaVersion: "composition-preview-descriptor.v2",
		access: "protected",
		compositionVersionId,
		compositionFingerprint: validated.version.compositionFingerprint,
		sourceKind: "QUICK_IMAGE",
		profile: {
			id: input.profile.id,
			logicalWidth: input.profile.logicalWidth,
			logicalHeight: input.profile.logicalHeight,
			aspectRatio: input.profile.aspectRatio,
		},
		timeline: {
			durationSeconds: input.source.durationSeconds,
			fps: input.timeline.fps,
			totalFrames: Number(input.timeline.totalFrames) as 150 | 300 | 450,
		},
		motion: input.motion,
		source: {
			width: input.source.width,
			height: input.source.height,
			mimeType: input.source.mimeType,
		},
		dependency: {
			dependencyKey: grant.dependencyKey,
			token: grant.token,
			contentType: grant.contentType as
				| "image/jpeg"
				| "image/png"
				| "image/webp",
			byteSize: grant.byteSize,
			checksum: grant.checksum,
			expiresAt: grant.expiresAt,
		},
	};
}

export class CompositionPreviewDescriptorAccessError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "CompositionPreviewDescriptorAccessError";
		this.code = code;
	}
}
