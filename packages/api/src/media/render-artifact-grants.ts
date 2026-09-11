import { MediaAssetError } from "@affichannel/core";
import { createProtectedGrant, verifyProtectedGrant } from "./protected-grants";

export type RenderArtifactDownloadGrantPayload = Readonly<{
	purpose: "render-artifact-download";
	schemaVersion: "render-artifact-grant.v1";
	workspaceId: string;
	projectId: string;
	renderArtifactId: string;
	checksumSha256: string;
	byteSize: number;
	expiresAt: number;
	nonce: string;
}>;

export function createRenderArtifactDownloadGrant(input: {
	workspaceId: string;
	projectId: string;
	renderArtifactId: string;
	checksumSha256: string;
	byteSize: number;
	expiresAt: Date;
}) {
	if (
		!input.workspaceId ||
		!input.projectId ||
		!input.renderArtifactId ||
		!/^[a-f0-9]{64}$/u.test(input.checksumSha256) ||
		!Number.isSafeInteger(input.byteSize) ||
		input.byteSize <= 0 ||
		!Number.isSafeInteger(input.expiresAt.getTime()) ||
		input.expiresAt.getTime() <= Date.now()
	)
		throw new MediaAssetError(
			"MEDIA_ASSET_INVALID_METADATA",
			"Render artifact download grant parameters are invalid.",
		);
	return createProtectedGrant({
		purpose: "render-artifact-download",
		schemaVersion: "render-artifact-grant.v1",
		workspaceId: input.workspaceId,
		projectId: input.projectId,
		renderArtifactId: input.renderArtifactId,
		checksumSha256: input.checksumSha256,
		byteSize: input.byteSize,
		expiresAt: input.expiresAt.getTime(),
	});
}

export function verifyRenderArtifactDownloadGrant(token: string) {
	const parsed = verifyProtectedGrant(token);
	if (
		parsed.purpose !== "render-artifact-download" ||
		parsed.schemaVersion !== "render-artifact-grant.v1" ||
		typeof parsed.workspaceId !== "string" ||
		typeof parsed.projectId !== "string" ||
		typeof parsed.renderArtifactId !== "string" ||
		typeof parsed.checksumSha256 !== "string" ||
		!/^[a-f0-9]{64}$/u.test(parsed.checksumSha256) ||
		typeof parsed.byteSize !== "number" ||
		!Number.isSafeInteger(parsed.byteSize) ||
		parsed.byteSize <= 0 ||
		typeof parsed.nonce !== "string"
	)
		throw new MediaAssetError(
			"MEDIA_ASSET_GRANT_INVALID",
			"Render artifact download grant is invalid.",
		);
	return parsed as unknown as RenderArtifactDownloadGrantPayload;
}
