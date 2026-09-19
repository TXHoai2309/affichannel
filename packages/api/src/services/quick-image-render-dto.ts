import type { RenderJobStatus } from "@affichannel/core";
import { renderJobStatuses } from "@affichannel/core";
import type { QuickImageRenderStatus } from "./quick-image-render-status-service";
import { getRenderArtifactAccessDescriptor } from "./render-artifact-access-service";
import type { RenderJobReadModel } from "./render-job-repository";
import type { WorkspaceActor } from "./workspace";

export type QuickImageRenderJobDto = Readonly<{
	renderJobId: string;
	compositionVersionId: string;
	status: RenderJobStatus;
}>;

export type QuickImageRenderStatusDto = QuickImageRenderJobDto &
	Readonly<{
		attemptStatus: string | null;
		attemptNumber: number | null;
		reasonCode:
			| "RENDER_BLOCKED"
			| "RENDER_FAILED"
			| "RENDER_INDETERMINATE"
			| null;
		artifact: Readonly<{
			artifactId: string;
			downloadUrl: string;
			mimeType: "video/mp4";
			byteSize: number;
		}> | null;
	}>;

function safeStatus(value: string): RenderJobStatus {
	return renderJobStatuses.includes(value as RenderJobStatus)
		? (value as RenderJobStatus)
		: "INDETERMINATE";
}

function safeReason(status: RenderJobStatus) {
	if (status === "BLOCKED") return "RENDER_BLOCKED" as const;
	if (status === "FAILED") return "RENDER_FAILED" as const;
	if (status === "INDETERMINATE") return "RENDER_INDETERMINATE" as const;
	return null;
}

export function toQuickImageRenderJobDto(
	job: RenderJobReadModel,
): QuickImageRenderJobDto {
	return {
		renderJobId: job.id,
		compositionVersionId: job.compositionVersionId,
		status: safeStatus(job.status),
	};
}

export async function toQuickImageRenderStatusDto(
	actor: WorkspaceActor,
	status: QuickImageRenderStatus,
): Promise<QuickImageRenderStatusDto> {
	const job = toQuickImageRenderJobDto(status.job);
	const access = status.artifact
		? await getRenderArtifactAccessDescriptor(actor, status.artifact.id)
		: null;
	return {
		...job,
		attemptStatus: status.attempt?.status ?? null,
		attemptNumber: status.attempt?.attemptNumber ?? null,
		reasonCode: safeReason(job.status),
		artifact: access
			? {
					artifactId: access.artifactId,
					downloadUrl: `/api/render-artifacts/download/${encodeURIComponent(access.token)}`,
					mimeType: access.mimeType,
					byteSize: access.byteSize,
				}
			: null,
	};
}
