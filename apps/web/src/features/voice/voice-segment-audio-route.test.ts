import { VoiceSegmentError } from "@affichannel/core";
import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createContext: vi.fn(),
	requireWorkspaceActor: vi.fn(),
	findArtifact: vi.fn(),
	createStorage: vi.fn(),
}));

vi.mock("@affichannel/api/context", () => ({
	createContext: mocks.createContext,
}));
vi.mock("@affichannel/api/services/workspace", () => ({
	requireWorkspaceActor: mocks.requireWorkspaceActor,
}));
vi.mock("@affichannel/api/services/voice-segment-repository", () => ({
	findVoiceSegmentArtifactById: mocks.findArtifact,
}));
vi.mock("@affichannel/api/storage/voice-audio-storage-factory", () => ({
	createVoiceAudioStorage: mocks.createStorage,
}));

const { GET } = await import(
	"@/app/api/projects/[projectId]/voice/segments/[artifactId]/audio/route"
);

const params = Promise.resolve({
	projectId: "project-1",
	artifactId: "artifact-1",
});
const artifact = {
	projectId: "project-1",
	status: "completed",
	storageKey: "voice/v1/workspace-1/project-1/artifact-1.mp3",
	checksum: "a".repeat(64),
	mimeType: "audio/mpeg",
	byteSize: 3,
};

describe("protected voice segment audio route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createContext.mockResolvedValue({
			session: { user: { id: "user-1" } },
		});
		mocks.requireWorkspaceActor.mockResolvedValue({
			workspaceId: "workspace-1",
			userId: "user-1",
		});
		mocks.findArtifact.mockResolvedValue(artifact);
		mocks.createStorage.mockReturnValue({
			open: vi.fn(
				async () =>
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array([0xff, 0xfb, 0x90]));
							controller.close();
						},
					}),
			),
		});
	});

	it("requires an authenticated workspace actor", async () => {
		mocks.createContext.mockResolvedValue({ session: null });
		const response = await GET(new Request("http://localhost"), { params });
		expect(response.status).toBe(401);
		expect(mocks.findArtifact).not.toHaveBeenCalled();
	});

	it("does not disclose artifacts from another project", async () => {
		mocks.findArtifact.mockResolvedValue({
			...artifact,
			projectId: "project-2",
		});
		const response = await GET(new Request("http://localhost"), { params });
		expect(response.status).toBe(404);
		expect(mocks.createStorage).not.toHaveBeenCalled();
	});

	it("streams only authorized completed audio with immutable private cache headers", async () => {
		const response = await GET(new Request("http://localhost"), { params });
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("audio/mpeg");
		expect(response.headers.get("etag")).toBe(`"${"a".repeat(64)}"`);
		expect(response.headers.get("cache-control")).toBe(
			"private, max-age=31536000, immutable",
		);
		expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
			0xff, 0xfb, 0x90,
		]);
	});

	it("supports If-None-Match without reopening storage", async () => {
		const response = await GET(
			new Request("http://localhost", {
				headers: { "if-none-match": `"${"a".repeat(64)}"` },
			}),
			{ params },
		);
		expect(response.status).toBe(304);
		expect((await response.arrayBuffer()).byteLength).toBe(0);
		expect(mocks.createStorage).not.toHaveBeenCalled();
	});

	it("normalizes missing storage into a controlled HTTP error", async () => {
		mocks.createStorage.mockReturnValue({
			open: vi.fn(async () => {
				throw new VoiceSegmentError("TTS_STORAGE_FAILED");
			}),
		});
		const response = await GET(new Request("http://localhost"), { params });
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			code: "TTS_STORAGE_FAILED",
			message: "TTS_STORAGE_FAILED",
		});
	});

	it("maps workspace membership failure without leaking details", async () => {
		mocks.requireWorkspaceActor.mockRejectedValue(
			new ORPCError("FORBIDDEN", { message: "private membership detail" }),
		);
		const response = await GET(new Request("http://localhost"), { params });
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			code: "FORBIDDEN",
			message: "FORBIDDEN",
		});
	});
});
