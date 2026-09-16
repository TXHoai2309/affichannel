import {
	CENTER_ZOOM_IN_V1,
	type CompositionInputV2,
	canonicalCompositionSemanticJsonV2,
	compositionInputV2Schema,
	QUICK_IMAGE_MEDIA_DEPENDENCY_KEY,
	QUICK_IMAGE_MEDIA_DEPENDENCY_ROLE,
	resolveQuickImageDuration,
	sha256Hex,
	VERTICAL_STANDARD_PROFILE,
} from "@affichannel/core";
import type {
	CompositionVersionReadModel,
	QuickImageCompositionVersionReadModel,
} from "./composition-version-repository";
import { findCompositionVersionRecord } from "./composition-version-repository";
import type { MediaAssetRecord } from "./media-asset-repository";
import { findMediaAssetByIdForWorkspace } from "./media-asset-repository";
import type { WorkspaceActor } from "./workspace";

export type QuickImagePreviewPreflightFailureCode =
	| "PREVIEW_COMPOSITION_MISSING"
	| "PREVIEW_PROJECT_MISMATCH"
	| "PREVIEW_UNSUPPORTED_SCHEMA"
	| "PREVIEW_COMPOSITION_INVALID"
	| "PREVIEW_DEPENDENCY_MISSING"
	| "PREVIEW_DEPENDENCY_UNAVAILABLE";

export type QuickImagePreviewValidated = Readonly<{
	version: QuickImageCompositionVersionReadModel;
	input: CompositionInputV2;
	asset: MediaAssetRecord;
	dependency: CompositionInputV2["media"][number];
}>;

export type QuickImagePreviewPreflightResult =
	| { ok: true; value: QuickImagePreviewValidated }
	| {
			ok: false;
			code: QuickImagePreviewPreflightFailureCode;
			message: string;
	  };

export type QuickImagePreviewPreflightDependencies = {
	findVersion?: typeof findCompositionVersionRecord;
	findMediaAsset?: typeof findMediaAssetByIdForWorkspace;
};

function failure(
	code: QuickImagePreviewPreflightFailureCode,
	message: string,
): QuickImagePreviewPreflightResult {
	return { ok: false, code, message };
}

function sameJson(left: unknown, right: unknown) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function invalid(message: string) {
	return failure("PREVIEW_COMPOSITION_INVALID", message);
}

/**
 * Validates only the persisted Quick Image CompositionVersion and its frozen
 * media authority. It deliberately does not read current source links,
 * settings, scripts, products, claims, or render capability state.
 */
export async function preflightQuickImageCompositionVersion(
	actor: WorkspaceActor,
	projectId: string,
	compositionVersionId: string,
	dependencies: QuickImagePreviewPreflightDependencies = {},
): Promise<QuickImagePreviewPreflightResult> {
	let record: CompositionVersionReadModel | undefined;
	try {
		record = await (dependencies.findVersion ?? findCompositionVersionRecord)(
			actor,
			compositionVersionId,
		);
	} catch {
		return failure(
			"PREVIEW_DEPENDENCY_UNAVAILABLE",
			"CompositionVersion could not be loaded for preview.",
		);
	}
	if (!record)
		return failure(
			"PREVIEW_COMPOSITION_MISSING",
			"CompositionVersion is missing in the actor workspace.",
		);
	if (record.schemaVersion !== "composition-input.v2")
		return failure(
			"PREVIEW_UNSUPPORTED_SCHEMA",
			"Quick Image preview requires CompositionInput V2.",
		);
	if (
		record.projectId !== projectId ||
		record.workspaceId !== actor.workspaceId
	)
		return failure(
			"PREVIEW_PROJECT_MISMATCH",
			"CompositionVersion is not bound to the requested project.",
		);

	const parsed = compositionInputV2Schema.safeParse(record.compositionInput);
	if (!parsed.success)
		return invalid("Persisted CompositionInput V2 is invalid.");
	const input = parsed.data;
	if (
		input.workspaceId !== actor.workspaceId ||
		input.projectId !== projectId ||
		input.source.workspaceId !== actor.workspaceId
	)
		return failure(
			"PREVIEW_PROJECT_MISMATCH",
			"Frozen Quick Image provenance is outside the requested scope.",
		);

	if (
		(await sha256Hex(canonicalCompositionSemanticJsonV2(input))) !==
		record.compositionFingerprint
	)
		return invalid("CompositionVersion fingerprint does not match its input.");
	if (!sameJson(input.profile, VERTICAL_STANDARD_PROFILE))
		return invalid(
			"Quick Image preview requires the canonical vertical profile.",
		);
	const duration = resolveQuickImageDuration(input.source.durationSeconds);
	if (
		!duration ||
		input.timeline.totalFrames !== String(duration.totalFrames) ||
		!sameJson(input.timeline.fps, { numerator: 30, denominator: 1 }) ||
		!sameJson(input.motion, CENTER_ZOOM_IN_V1)
	)
		return invalid("Quick Image timeline or motion is not canonical.");
	if (
		record.sourceMediaAssetId !== input.source.mediaAssetId ||
		record.sourceMediaChecksumSha256 !== input.source.checksumSha256 ||
		record.sourceMediaStorageProvider !== input.source.storageProvider ||
		record.sourceMediaStorageKey !== input.source.storageKey ||
		record.sourceMediaMimeType !== input.source.mimeType ||
		record.sourceMediaByteSize !== input.source.byteSize ||
		record.sourceMediaWidth !== input.source.width ||
		record.sourceMediaHeight !== input.source.height
	)
		return invalid(
			"CompositionVersion lineage does not match its frozen source.",
		);

	const dependency = input.media[0];
	if (
		!dependency ||
		dependency.dependencyKey !== QUICK_IMAGE_MEDIA_DEPENDENCY_KEY ||
		dependency.role !== QUICK_IMAGE_MEDIA_DEPENDENCY_ROLE ||
		dependency.provenance.projectId !== projectId ||
		dependency.provenance.workspaceId !== actor.workspaceId ||
		dependency.provenance.mediaAssetId !== input.source.mediaAssetId
	)
		return invalid("Quick Image dependency is not the frozen source.");

	let asset: MediaAssetRecord | undefined;
	try {
		asset = await (
			dependencies.findMediaAsset ?? findMediaAssetByIdForWorkspace
		)(actor, input.source.mediaAssetId);
	} catch {
		return failure(
			"PREVIEW_DEPENDENCY_UNAVAILABLE",
			"Quick Image source could not be loaded for preview.",
		);
	}
	if (!asset)
		return failure(
			"PREVIEW_DEPENDENCY_MISSING",
			"Frozen Quick Image source is missing.",
		);
	if (
		(asset.status !== "ready" && asset.status !== "archived") ||
		asset.workspaceId !== actor.workspaceId ||
		asset.id !== input.source.mediaAssetId ||
		asset.mediaType !== "image" ||
		asset.storageProvider !== input.source.storageProvider ||
		asset.storageKey !== input.source.storageKey ||
		asset.checksumSha256 !== input.source.checksumSha256 ||
		asset.mimeType !== input.source.mimeType ||
		asset.byteSize !== input.source.byteSize ||
		asset.width !== input.source.width ||
		asset.height !== input.source.height
	)
		return failure(
			"PREVIEW_DEPENDENCY_UNAVAILABLE",
			"Quick Image source no longer matches its frozen authority.",
		);

	return {
		ok: true,
		value: {
			version: record,
			input,
			asset,
			dependency,
		},
	};
}
