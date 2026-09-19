import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getAccess: vi.fn(),
}));

vi.mock("@affichannel/api/services/render-artifact-access-service", () => ({
	getRenderArtifactAccessDescriptor: mocks.getAccess,
}));

const { toQuickImageRenderJobDto, toQuickImageRenderStatusDto } = await import(
	"@affichannel/api/services/quick-image-render-dto"
);

const job = {
	id: "job-1",
	workspaceId: "workspace-1",
	projectId: "project-1",
	compositionVersionId: "composition-1",
	compositionFingerprint: "a".repeat(64),
	canonicalRequestHash: "b".repeat(64),
	requestSpec: { schemaVersion: "render-request.quick-image.v1" },
	outputEncodingProfileFingerprint: "c".repeat(64),
	outputContractVersion: "quick-image-output.v1",
	operation: "START_RENDER" as const,
	sourceRenderJobId: null,
	idempotencyKey: "idempotency-1",
	status: "FAILED",
	attemptCount: 1,
	reasonCode: "INTERNAL_REASON",
	errorCode: "INTERNAL_ERROR",
	errorMessage: "private detail",
	createdAt: new Date(),
	finishedAt: new Date(),
} as never;

describe("Quick Image render safe DTO", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getAccess.mockResolvedValue({
			artifactId: "artifact-1",
			token: "opaque-token",
			expiresAt: new Date(),
			mimeType: "video/mp4",
			byteSize: 42,
			validatedMetadata: {},
		});
	});

	it("returns only safe job identity and status", () => {
		const result = toQuickImageRenderJobDto(job);
		expect(result).toEqual({
			renderJobId: "job-1",
			compositionVersionId: "composition-1",
			status: "FAILED",
		});
		expect(result).not.toHaveProperty("workspaceId");
		expect(result).not.toHaveProperty("requestSpec");
	});

	it("maps failure and artifact access without leaking internals", async () => {
		const result = await toQuickImageRenderStatusDto(
			{ workspaceId: "workspace-1", userId: "user-1" },
			{
				job,
				attempt: {
					status: "FAILED",
					attemptNumber: 1,
				} as never,
				artifact: { id: "artifact-1" } as never,
			},
		);
		expect(result).toMatchObject({
			status: "FAILED",
			reasonCode: "RENDER_FAILED",
			artifact: {
				artifactId: "artifact-1",
				downloadUrl: "/api/render-artifacts/download/opaque-token",
				mimeType: "video/mp4",
				byteSize: 42,
			},
		});
		expect(result).not.toHaveProperty("errorMessage");
		expect(result).not.toHaveProperty("storageKey");
	});
});
