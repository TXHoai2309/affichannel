import {
	createQuickImageRenderPlan,
	type QuickImageRenderPlan,
} from "@affichannel/core";
import {
	preflightQuickImageRender,
	type QuickImageRenderPreflightDependencies,
	type QuickImageRenderPreflightResult,
	type QuickImageRenderPreflightValue,
} from "./quick-image-render-preflight";
import type { WorkspaceActor } from "./workspace";

/** Builds only from the already validated persisted V2 authority. */
export async function buildQuickImageRenderPlan(
	validated: QuickImageRenderPreflightValue,
): Promise<QuickImageRenderPlan> {
	return createQuickImageRenderPlan({
		compositionVersionId: validated.version.id,
		compositionFingerprint: validated.version.compositionFingerprint,
		compositionInput: validated.input,
		outputProfile: validated.outputProfile,
		outputProfileFingerprint: validated.outputProfileFingerprint,
	});
}

export type QuickImageRenderPlanPreflightResult =
	| { ok: true; value: QuickImageRenderPlan }
	| Exclude<QuickImageRenderPreflightResult, { ok: true }>;

export async function preflightAndBuildQuickImageRenderPlan(
	actor: WorkspaceActor,
	projectId: string,
	compositionVersionId: string,
	dependencies: QuickImageRenderPreflightDependencies = {},
): Promise<QuickImageRenderPlanPreflightResult> {
	const preflight = await preflightQuickImageRender(
		actor,
		projectId,
		compositionVersionId,
		dependencies,
	);
	if (!preflight.ok) return preflight;
	return {
		ok: true,
		value: await buildQuickImageRenderPlan(preflight.value),
	};
}
