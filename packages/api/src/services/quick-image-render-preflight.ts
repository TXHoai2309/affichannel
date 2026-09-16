import type { VideoOnlyOutputProfile } from "@affichannel/core";
import {
	fingerprintVideoOnlyOutputProfile,
	MP4_H264_VIDEO_ONLY_V1,
	videoOnlyOutputProfileSchema,
} from "@affichannel/core";
import {
	preflightQuickImageCompositionVersion,
	type QuickImagePreviewPreflightDependencies,
	type QuickImagePreviewPreflightResult,
	type QuickImagePreviewValidated,
} from "./quick-image-preview-preflight";
import type { WorkspaceActor } from "./workspace";

export const QUICK_IMAGE_RENDER_PREFLIGHT_VERSION =
	"quick-image-render-preflight.v1" as const;

export type QuickImageRenderPreflightFailureCode =
	| "RENDER_COMPOSITION_MISSING"
	| "RENDER_PROJECT_MISMATCH"
	| "RENDER_UNSUPPORTED_SCHEMA"
	| "RENDER_COMPOSITION_INVALID"
	| "RENDER_DEPENDENCY_MISSING"
	| "RENDER_DEPENDENCY_UNAVAILABLE"
	| "RENDER_OUTPUT_PROFILE_INVALID";

export type QuickImageRenderPreflightValue = Readonly<
	QuickImagePreviewValidated & {
		preflightVersion: typeof QUICK_IMAGE_RENDER_PREFLIGHT_VERSION;
		outputProfile: VideoOnlyOutputProfile;
		outputProfileFingerprint: string;
		outputContractVersion: "quick-image-output.v1";
	}
>;

export type QuickImageRenderPreflightResult =
	| { ok: true; value: QuickImageRenderPreflightValue }
	| {
			ok: false;
			code: QuickImageRenderPreflightFailureCode;
			message: string;
	  };

export type QuickImageRenderPreflightDependencies =
	QuickImagePreviewPreflightDependencies;

function mapPreviewFailure(
	result: Exclude<QuickImagePreviewPreflightResult, { ok: true }>,
): Exclude<QuickImageRenderPreflightResult, { ok: true }> {
	const codeMap: Record<
		Exclude<QuickImagePreviewPreflightResult, { ok: true }>["code"],
		QuickImageRenderPreflightFailureCode
	> = {
		PREVIEW_COMPOSITION_MISSING: "RENDER_COMPOSITION_MISSING",
		PREVIEW_PROJECT_MISMATCH: "RENDER_PROJECT_MISMATCH",
		PREVIEW_UNSUPPORTED_SCHEMA: "RENDER_UNSUPPORTED_SCHEMA",
		PREVIEW_COMPOSITION_INVALID: "RENDER_COMPOSITION_INVALID",
		PREVIEW_DEPENDENCY_MISSING: "RENDER_DEPENDENCY_MISSING",
		PREVIEW_DEPENDENCY_UNAVAILABLE: "RENDER_DEPENDENCY_UNAVAILABLE",
	};
	return { ok: false, code: codeMap[result.code], message: result.message };
}

/**
 * Render-specific V2 preflight. It reuses the frozen semantic boundary used
 * by preview and adds only the execution-output contract; it never invokes
 * the V1 currentness/business preflight or resolves a live Quick Image source.
 */
export async function preflightQuickImageRender(
	actor: WorkspaceActor,
	projectId: string,
	compositionVersionId: string,
	dependencies: QuickImageRenderPreflightDependencies = {},
): Promise<QuickImageRenderPreflightResult> {
	const preview = await preflightQuickImageCompositionVersion(
		actor,
		projectId,
		compositionVersionId,
		dependencies,
	);
	if (!preview.ok) return mapPreviewFailure(preview);

	const outputProfile = videoOnlyOutputProfileSchema.safeParse(
		MP4_H264_VIDEO_ONLY_V1,
	);
	if (!outputProfile.success)
		return {
			ok: false,
			code: "RENDER_OUTPUT_PROFILE_INVALID",
			message: "The production Quick Image output profile is invalid.",
		};

	return {
		ok: true,
		value: {
			...preview.value,
			preflightVersion: QUICK_IMAGE_RENDER_PREFLIGHT_VERSION,
			outputProfile: outputProfile.data,
			outputProfileFingerprint: await fingerprintVideoOnlyOutputProfile(
				outputProfile.data,
			),
			outputContractVersion: "quick-image-output.v1",
		},
	};
}
