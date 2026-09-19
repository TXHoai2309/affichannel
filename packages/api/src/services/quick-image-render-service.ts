import {
	createQuickImageRenderRequest,
	quickImageRenderRequestSchema,
} from "@affichannel/core";
import { buildQuickImageRenderPlan } from "./quick-image-render-plan";
import {
	preflightQuickImageRender,
	type QuickImageRenderPreflightDependencies,
} from "./quick-image-render-preflight";
import {
	createRenderJob,
	findRenderJob,
	RenderJobError,
	type RenderJobReadModel,
} from "./render-job-repository";
import type { WorkspaceActor } from "./workspace";

export type QuickImageRenderStartInput = Readonly<{
	projectId: string;
	compositionVersionId: string;
	idempotencyKey: string;
}>;

export type QuickImageRenderStartDependencies = Readonly<{
	preflight?: typeof preflightQuickImageRender;
	createJob?: typeof createRenderJob;
	findJob?: typeof findRenderJob;
	preflightDependencies?: QuickImageRenderPreflightDependencies;
}>;

/**
 * Internal-only Quick Image start authority. Every render semantic is derived
 * from the frozen CompositionVersion; callers cannot provide source, timing,
 * motion, output, or tool values.
 */
export async function startQuickImageRender(
	actor: WorkspaceActor,
	input: QuickImageRenderStartInput,
	dependencies: QuickImageRenderStartDependencies = {},
): Promise<RenderJobReadModel> {
	const preflight = await (dependencies.preflight ?? preflightQuickImageRender)(
		actor,
		input.projectId,
		input.compositionVersionId,
		dependencies.preflightDependencies,
	);
	if (!preflight.ok)
		throw new RenderJobError(preflight.code, preflight.message);
	const plan = await buildQuickImageRenderPlan(preflight.value);
	const request = await createQuickImageRenderRequest(plan);
	return (dependencies.createJob ?? createRenderJob)({
		actor,
		projectId: input.projectId,
		requestSpec: request,
		idempotencyKey: input.idempotencyKey,
		operation: "START_RENDER",
		sourceRenderJobId: null,
	});
}

export type QuickImageFailedRetryInput = Readonly<{
	projectId: string;
	failedRenderJobId: string;
	idempotencyKey: string;
}>;

/** Creates a new job from the old job's immutable Quick Image request. */
export async function retryFailedQuickImageRender(
	actor: WorkspaceActor,
	input: QuickImageFailedRetryInput,
	dependencies: Pick<
		QuickImageRenderStartDependencies,
		"createJob" | "findJob"
	> = {},
): Promise<RenderJobReadModel> {
	const source = await (dependencies.findJob ?? findRenderJob)(
		actor,
		input.failedRenderJobId,
	);
	if (!source || source.projectId !== input.projectId)
		throw new RenderJobError("RENDER_JOB_NOT_FOUND");
	if (source.status !== "FAILED")
		throw new RenderJobError("QUICK_IMAGE_RETRY_REQUIRES_FAILED_JOB");
	if (source.idempotencyKey === input.idempotencyKey.trim())
		throw new RenderJobError("QUICK_IMAGE_RETRY_NEW_IDEMPOTENCY_KEY_REQUIRED");
	const request = quickImageRenderRequestSchema.safeParse(source.requestSpec);
	if (!request.success)
		throw new RenderJobError("QUICK_IMAGE_RETRY_NOT_QUICK_IMAGE");
	return (dependencies.createJob ?? createRenderJob)({
		actor,
		projectId: input.projectId,
		requestSpec: request.data,
		idempotencyKey: input.idempotencyKey,
		operation: "START_RENDER",
		sourceRenderJobId: null,
	});
}
