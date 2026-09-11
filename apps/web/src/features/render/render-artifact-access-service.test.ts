import { MediaAssetError } from "@affichannel/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findArtifact: vi.fn(),
	createGrant: vi.fn(),
}));

vi.mock("@affichannel/api/services/render-artifact-repository", () => ({
	findRenderArtifactById: mocks.findArtifact,
}));
vi.mock("@affichannel/api/media/render-artifact-grants", () => ({
	createRenderArtifactDownloadGrant: mocks.createGrant,
}));
vi.mock("@affichannel/env/server", () => ({
	env: { RENDER_ARTIFACT_DOWNLOAD_TTL_MS: 300_000 },
}));

import { getRenderArtifactAccessDescriptor } from "@affichannel/api/services/render-artifact-access-service";

const actor = { workspaceId: "workspace-1", userId: "user-1" };
const artifact = {
	id: "artifact-1",
	workspaceId: "workspace-1",
	projectId: "project-1",
	mimeType: "video/mp4" as const,
	byteSize: 977,
	checksumSha256: "a".repeat(64),
	validatedMetadata: {
		schemaVersion: "render-output-metadata.v1" as const,
		container: "MP4" as const,
		mimeType: "video/mp4" as const,
		videoCodec: "H.264/AVC" as const,
		width: 1080,
		height: 1920,
		frameRate: { numerator: 30, denominator: 1 },
		totalFrames: "1",
		duration: { timescale: 30, value: "1" },
		audio: null,
	},
};

describe("AFF-US-021 EN001 21D artifact access boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findArtifact.mockResolvedValue(artifact);
		mocks.createGrant.mockReturnValue("signed-token");
	});

	it("re-reads workspace/project access and returns no storage locator", async () => {
		const descriptor = await getRenderArtifactAccessDescriptor(
			actor,
			artifact.id,
		);
		expect(mocks.findArtifact).toHaveBeenCalledWith(actor, artifact.id);
		expect(mocks.createGrant).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: artifact.workspaceId,
				projectId: artifact.projectId,
				renderArtifactId: artifact.id,
			}),
		);
		expect(descriptor).toMatchObject({
			artifactId: artifact.id,
			token: "signed-token",
			mimeType: "video/mp4",
			byteSize: 977,
		});
		expect(descriptor).not.toHaveProperty("storageKey");
		expect(descriptor).not.toHaveProperty("storageProvider");
		expect(descriptor).not.toHaveProperty("outputReservationId");
	});

	it("denies missing, out-of-scope, or substituted artifacts", async () => {
		mocks.findArtifact.mockResolvedValueOnce(undefined);
		await expect(
			getRenderArtifactAccessDescriptor(actor, artifact.id),
		).rejects.toBeInstanceOf(MediaAssetError);
		mocks.findArtifact.mockResolvedValueOnce({
			...artifact,
			id: "different-artifact",
		});
		await expect(
			getRenderArtifactAccessDescriptor(actor, artifact.id),
		).rejects.toBeInstanceOf(MediaAssetError);
	});
});
