import { MediaAssetError } from "@affichannel/core";
import { env } from "@affichannel/env/server";
import { createRenderArtifactDownloadGrant } from "../media/render-artifact-grants";
import {
	findRenderArtifactById,
	type RenderArtifactReadModel,
} from "./render-artifact-repository";
import type { WorkspaceActor } from "./workspace";

export type RenderArtifactAccessDescriptor = Readonly<{
	artifactId: string;
	token: string;
	expiresAt: Date;
	mimeType: "video/mp4";
	byteSize: number;
	validatedMetadata: RenderArtifactReadModel["validatedMetadata"];
}>;

export async function getRenderArtifactAccessDescriptor(
	actor: WorkspaceActor,
	artifactId: string,
): Promise<RenderArtifactAccessDescriptor> {
	const artifact = await findRenderArtifactById(actor, artifactId);
	if (!artifact || artifact.id !== artifactId)
		throw new MediaAssetError("MEDIA_ASSET_DOWNLOAD_NOT_ALLOWED");
	const expiresAt = new Date(Date.now() + env.RENDER_ARTIFACT_DOWNLOAD_TTL_MS);
	const token = createRenderArtifactDownloadGrant({
		workspaceId: artifact.workspaceId,
		projectId: artifact.projectId,
		renderArtifactId: artifact.id,
		checksumSha256: artifact.checksumSha256,
		byteSize: artifact.byteSize,
		expiresAt,
	});
	return {
		artifactId: artifact.id,
		token,
		expiresAt,
		mimeType: artifact.mimeType,
		byteSize: artifact.byteSize,
		validatedMetadata: artifact.validatedMetadata,
	};
}
