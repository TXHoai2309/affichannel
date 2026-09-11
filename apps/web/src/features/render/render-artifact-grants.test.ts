import { createProtectedGrant } from "@affichannel/api/media/protected-grants";
import {
	createRenderArtifactDownloadGrant,
	verifyRenderArtifactDownloadGrant,
} from "@affichannel/api/media/render-artifact-grants";
import { describe, expect, it } from "vitest";

describe("protected RenderArtifact grants", () => {
	it("binds artifact scope and keeps private storage identity out of the token", () => {
		const token = createRenderArtifactDownloadGrant({
			workspaceId: "workspace-1",
			projectId: "project-1",
			renderArtifactId: "artifact-1",
			checksumSha256: "a".repeat(64),
			byteSize: 977,
			expiresAt: new Date(Date.now() + 60_000),
		});
		const verified = verifyRenderArtifactDownloadGrant(token);
		expect(verified).toMatchObject({
			workspaceId: "workspace-1",
			projectId: "project-1",
			renderArtifactId: "artifact-1",
			checksumSha256: "a".repeat(64),
			byteSize: 977,
		});
		expect(token).not.toContain("render-artifacts/v1/");
		expect(token).not.toContain("reservation-1");
	});

	it("rejects tampering, wrong purpose, and expiry", () => {
		const token = createRenderArtifactDownloadGrant({
			workspaceId: "workspace-1",
			projectId: "project-1",
			renderArtifactId: "artifact-1",
			checksumSha256: "b".repeat(64),
			byteSize: 10,
			expiresAt: new Date(Date.now() + 60_000),
		});
		expect(() => verifyRenderArtifactDownloadGrant(`${token}x`)).toThrowError(
			expect.objectContaining({ code: "MEDIA_ASSET_GRANT_INVALID" }),
		);
		const wrongPurpose = createProtectedGrant({
			purpose: "media-download",
			schemaVersion: "render-artifact-grant.v1",
			workspaceId: "workspace-1",
			projectId: "project-1",
			renderArtifactId: "artifact-1",
			checksumSha256: "b".repeat(64),
			byteSize: 10,
			expiresAt: Date.now() + 60_000,
		});
		expect(() => verifyRenderArtifactDownloadGrant(wrongPurpose)).toThrowError(
			expect.objectContaining({ code: "MEDIA_ASSET_GRANT_INVALID" }),
		);
		const expired = createProtectedGrant({
			purpose: "render-artifact-download",
			schemaVersion: "render-artifact-grant.v1",
			workspaceId: "workspace-1",
			projectId: "project-1",
			renderArtifactId: "artifact-1",
			checksumSha256: "b".repeat(64),
			byteSize: 10,
			expiresAt: Date.now() - 1,
		});
		expect(() => verifyRenderArtifactDownloadGrant(expired)).toThrowError(
			expect.objectContaining({ code: "MEDIA_ASSET_GRANT_EXPIRED" }),
		);
	});
});
