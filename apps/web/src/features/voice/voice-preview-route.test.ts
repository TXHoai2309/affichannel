import { FactLockError, VoiceConfigError } from "@affichannel/core";
import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createContext: vi.fn(),
	requireWorkspaceActor: vi.fn(),
	previewVoice: vi.fn(),
}));

vi.mock("@affichannel/api/context", () => ({
	createContext: mocks.createContext,
}));
vi.mock("@affichannel/api/services/workspace", () => ({
	requireWorkspaceActor: mocks.requireWorkspaceActor,
}));
vi.mock("@affichannel/api/services/voice-preview-service", () => ({
	previewVoice: mocks.previewVoice,
}));

const { POST } = await import(
	"@/app/api/projects/[projectId]/voice/preview/route"
);

const params = Promise.resolve({ projectId: "project-1" });

describe("protected voice preview binary route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects unauthenticated requests before workspace lookup", async () => {
		mocks.createContext.mockResolvedValue({ session: null });
		const response = await POST(new Request("http://localhost"), { params });

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			code: "UNAUTHORIZED",
			message: "UNAUTHORIZED",
		});
		expect(mocks.requireWorkspaceActor).not.toHaveBeenCalled();
	});

	it("rejects a client body so preview text cannot be supplied by the caller", async () => {
		mocks.createContext.mockResolvedValue({
			session: { user: { id: "user-1" } },
		});
		mocks.requireWorkspaceActor.mockResolvedValue({
			workspaceId: "workspace-1",
			userId: "user-1",
		});
		const response = await POST(
			new Request("http://localhost", { method: "POST", body: "client text" }),
			{ params },
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			code: "BAD_REQUEST",
			message: "BAD_REQUEST",
		});
		expect(mocks.previewVoice).not.toHaveBeenCalled();
	});

	it("maps workspace authorization and domain errors without leaking details", async () => {
		mocks.createContext.mockResolvedValue({
			session: { user: { id: "user-1" } },
		});
		mocks.requireWorkspaceActor.mockRejectedValue(
			new ORPCError("FORBIDDEN", { message: "internal membership detail" }),
		);
		const forbidden = await POST(new Request("http://localhost"), { params });
		expect(forbidden.status).toBe(403);
		expect(await forbidden.json()).toEqual({
			code: "FORBIDDEN",
			message: "FORBIDDEN",
		});

		mocks.requireWorkspaceActor.mockResolvedValue({
			workspaceId: "workspace-1",
			userId: "user-1",
		});
		mocks.previewVoice.mockRejectedValue(
			new VoiceConfigError("TTS_PROVIDER_UNAVAILABLE", "provider secret"),
		);
		const unavailable = await POST(new Request("http://localhost"), { params });
		expect(unavailable.status).toBe(503);
		expect(await unavailable.json()).toEqual({
			code: "TTS_PROVIDER_UNAVAILABLE",
			message: "TTS_PROVIDER_UNAVAILABLE",
		});

		mocks.previewVoice.mockRejectedValue(
			new FactLockError("FACT_LOCK_REQUIRED", "internal gate detail", {
				reason: "PRODUCT_REQUIRED_FOR_PRODUCT_CLAIMS",
			}),
		);
		const blocked = await POST(new Request("http://localhost"), { params });
		expect(blocked.status).toBe(409);
		expect(await blocked.json()).toEqual({
			code: "FACT_LOCK_REQUIRED",
			message: "FACT_LOCK_REQUIRED",
			reason: "PRODUCT_REQUIRED_FOR_PRODUCT_CLAIMS",
		});
	});

	it("returns protected audio/mpeg bytes and no JSON envelope", async () => {
		mocks.createContext.mockResolvedValue({
			session: { user: { id: "user-1" } },
		});
		mocks.requireWorkspaceActor.mockResolvedValue({
			workspaceId: "workspace-1",
			userId: "user-1",
		});
		mocks.previewVoice.mockResolvedValue({
			audio: new Uint8Array([0xff, 0xfb, 0x90]),
			contentType: "audio/mpeg",
			providerRequestId: "provider-id",
			latencyMs: 3,
			sourceScriptVersionId: "script-1",
			sourceScriptRevision: 1,
			configRevision: 1,
		});

		const response = await POST(new Request("http://localhost"), { params });
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("audio/mpeg");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
			0xff, 0xfb, 0x90,
		]);
		expect(mocks.previewVoice).toHaveBeenCalledWith(
			{ workspaceId: "workspace-1", userId: "user-1" },
			"project-1",
		);
	});
});
