import { quickImageRenderRequestSchema } from "@affichannel/core";
import {
	findRenderArtifactForJob,
	type RenderArtifactReadModel,
} from "./render-artifact-repository";
import {
	findLatestQuickImageRenderForComposition,
	findLatestRenderAttempt,
	findRenderJob,
	type RenderAttemptReadModel,
	RenderJobError,
	type RenderJobReadModel,
} from "./render-job-repository";
import type { WorkspaceActor } from "./workspace";

export type QuickImageRenderStatus = Readonly<{
	job: RenderJobReadModel;
	attempt: RenderAttemptReadModel | undefined;
	artifact: RenderArtifactReadModel | undefined;
}>;

/** Persisted, read-only status authority. Reads never start or rerun work. */
export async function getQuickImageRenderStatus(
	actor: WorkspaceActor,
	input: { projectId: string; renderJobId: string },
): Promise<QuickImageRenderStatus | undefined> {
	const job = await findRenderJob(actor, input.renderJobId);
	if (!job || job.projectId !== input.projectId) return undefined;
	if (!quickImageRenderRequestSchema.safeParse(job.requestSpec).success)
		throw new RenderJobError("QUICK_IMAGE_STATUS_NOT_QUICK_IMAGE");
	const [attempt, artifact] = await Promise.all([
		findLatestRenderAttempt(actor, {
			projectId: input.projectId,
			jobId: input.renderJobId,
		}),
		findRenderArtifactForJob(actor, input),
	]);
	return { job, attempt, artifact };
}

/** Read-only reload discovery for the exact persisted CompositionVersion. */
export async function getQuickImageRenderStatusForComposition(
	actor: WorkspaceActor,
	input: { projectId: string; compositionVersionId: string },
): Promise<QuickImageRenderStatus | undefined> {
	const job = await findLatestQuickImageRenderForComposition(actor, input);
	if (!job) return undefined;
	return getQuickImageRenderStatus(actor, {
		projectId: input.projectId,
		renderJobId: job.id,
	});
}
