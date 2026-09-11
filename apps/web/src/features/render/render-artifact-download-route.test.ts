import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createContext: vi.fn(),
	requireWorkspaceActor: vi.fn(),
	verifyGrant: vi.fn(),
	findArtifact: vi.fn(),
	createStorage: vi.fn(),
	open: vi.fn(),
	openRange: vi.fn(),
	verifyExact: vi.fn(),
	head: vi.fn(),
}));

vi.mock("@affichannel/api/context", () => ({
	createContext: mocks.createContext,
}));
vi.mock("@affichannel/api/services/workspace", () => ({
	requireWorkspaceActor: mocks.requireWorkspaceActor,
}));
vi.mock("@affichannel/api/media/render-artifact-grants", () => ({
	verifyRenderArtifactDownloadGrant: mocks.verifyGrant,
}));
vi.mock("@affichannel/api/services/render-artifact-repository", () => ({
	findRenderArtifactById: mocks.findArtifact,
}));
vi.mock("@affichannel/api/storage/render-output-storage-factory", () => ({
	createRenderOutputStorage: mocks.createStorage,
}));

const { GET } = await import(
	"@/app/api/render-artifacts/download/[token]/route"
);

const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
const artifact = {
	id: "artifact-1",
	workspaceId: "workspace-1",
	projectId: "project-1",
	mimeType: "video/mp4" as const,
	byteSize: bytes.byteLength,
	checksumSha256: "a".repeat(64),
	storageProvider: "local" as const,
	storageKey: "private-key",
};

function body(value: Uint8Array) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(value);
			controller.close();
		},
	});
}

async function request(range?: string) {
	return GET(
		new Request("http://localhost", {
			headers: range ? { Range: range } : undefined,
		}),
		{ params: Promise.resolve({ token: "opaque" }) },
	);
}

describe("protected RenderArtifact download route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createContext.mockResolvedValue({
			session: { user: { id: "user-1" } },
		});
		mocks.requireWorkspaceActor.mockResolvedValue({
			workspaceId: "workspace-1",
			userId: "user-1",
		});
		mocks.verifyGrant.mockReturnValue({
			workspaceId: "workspace-1",
			projectId: "project-1",
			renderArtifactId: "artifact-1",
			checksumSha256: artifact.checksumSha256,
			byteSize: artifact.byteSize,
		});
		mocks.findArtifact.mockResolvedValue(artifact);
		mocks.head.mockResolvedValue({
			byteSize: artifact.byteSize,
			contentType: artifact.mimeType,
			checksumSha256: artifact.checksumSha256,
			etag: null,
		});
		mocks.verifyExact.mockResolvedValue({});
		mocks.open.mockResolvedValue(body(bytes));
		mocks.openRange.mockImplementation(async ({ start, end }) => ({
			start,
			end,
			byteSize: end - start + 1,
			contentType: "video/mp4" as const,
			stream: body(bytes.slice(start, end + 1)),
		}));
		mocks.createStorage.mockReturnValue({
			head: mocks.head,
			verifyExact: mocks.verifyExact,
			open: mocks.open,
			openRange: mocks.openRange,
		});
	});

	it("authenticates and serves a full immutable artifact", async () => {
		const response = await request();
		expect(response.status).toBe(200);
		expect(response.headers.get("accept-ranges")).toBe("bytes");
		expect(response.headers.get("content-length")).toBe("8");
		expect(response.headers.get("content-type")).toContain("video/mp4");
		expect(await response.arrayBuffer()).toEqual(bytes.buffer);
		expect(mocks.verifyExact).toHaveBeenCalledWith({
			storageKey: artifact.storageKey,
			byteSize: artifact.byteSize,
			checksumSha256: artifact.checksumSha256,
		});
	});

	it.each([
		["bytes=1-3", 1, 3],
		["bytes=4-", 4, 7],
		["bytes=-2", 6, 7],
	] as const)("serves valid single range %s", async (header, start, end) => {
		const response = await request(header);
		expect(response.status).toBe(206);
		expect(response.headers.get("content-range")).toBe(
			`bytes ${start}-${end}/8`,
		);
		expect(response.headers.get("content-length")).toBe(
			String(end - start + 1),
		);
		expect(await response.arrayBuffer()).toEqual(
			bytes.slice(start, end + 1).buffer,
		);
		expect(mocks.openRange).toHaveBeenCalledWith({
			storageKey: artifact.storageKey,
			start,
			end,
		});
	});

	it.each(["bytes=0-1,4-5", "bytes=99-100", "bytes=3-2"] as const)(
		"rejects invalid or multi-range %s before range access",
		async (header) => {
			const response = await request(header);
			expect(response.status).toBe(416);
			expect(response.headers.get("content-range")).toBe("bytes */8");
			expect(response.headers.get("content-length")).toBe("0");
			expect(mocks.open).not.toHaveBeenCalled();
			expect(mocks.openRange).not.toHaveBeenCalled();
		},
	);

	it("denies unauthenticated access before artifact lookup", async () => {
		mocks.createContext.mockResolvedValue({ session: null });
		const response = await request();
		expect(response.status).toBe(401);
		expect(mocks.findArtifact).not.toHaveBeenCalled();
		expect(mocks.createStorage).not.toHaveBeenCalled();
	});

	it("rejects artifact substitution before storage access", async () => {
		mocks.findArtifact.mockResolvedValue({ ...artifact, id: "other-artifact" });
		const response = await request();
		expect(response.status).toBe(403);
		expect(mocks.createStorage).not.toHaveBeenCalled();
	});

	it("rejects checksum substitution before storage access", async () => {
		mocks.verifyGrant.mockReturnValue({
			workspaceId: artifact.workspaceId,
			projectId: artifact.projectId,
			renderArtifactId: artifact.id,
			checksumSha256: "c".repeat(64),
			byteSize: artifact.byteSize,
		});
		const response = await request();
		expect(response.status).toBe(403);
		expect(mocks.createStorage).not.toHaveBeenCalled();
	});
});
