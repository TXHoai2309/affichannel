import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	class MockCompositionPreviewAccessError extends Error {
		readonly code: string;
		constructor(code: string) {
			super(code);
			this.code = code;
		}
	}
	return {
		createContext: vi.fn(),
		requireWorkspaceActor: vi.fn(),
		readDependency: vi.fn(),
		CompositionPreviewAccessError: MockCompositionPreviewAccessError,
	};
});

vi.mock("@affichannel/api/context", () => ({
	createContext: mocks.createContext,
}));
vi.mock("@affichannel/api/services/workspace", () => ({
	requireWorkspaceActor: mocks.requireWorkspaceActor,
}));
vi.mock("@affichannel/api/services/composition-preview-grants", () => ({
	CompositionPreviewAccessError: mocks.CompositionPreviewAccessError,
	readCompositionPreviewDependency: mocks.readDependency,
}));

const { GET } = await import(
	"@/app/api/compositions/preview/dependencies/[token]/route"
);

describe("protected composition preview dependency route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createContext.mockResolvedValue({
			session: { user: { id: "user-1" } },
		});
		mocks.requireWorkspaceActor.mockResolvedValue({
			workspaceId: "workspace-1",
			userId: "user-1",
		});
	});

	it("requires an authenticated workspace actor", async () => {
		mocks.createContext.mockResolvedValue({ session: null });
		const response = await GET(new Request("http://localhost"), {
			params: Promise.resolve({ token: "opaque" }),
		});
		expect(response.status).toBe(401);
		expect(mocks.readDependency).not.toHaveBeenCalled();
	});

	it("streams exact protected bytes without returning a locator", async () => {
		mocks.readDependency.mockResolvedValue({
			bytes: new Uint8Array([1, 2, 3]),
			contentType: "image/png",
			byteSize: 3,
			checksum: "a".repeat(64),
		});
		const response = await GET(new Request("http://localhost"), {
			params: Promise.resolve({ token: "opaque" }),
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("content-type")).toContain("image/png");
		expect(response.headers.get("content-length")).toBe("3");
		expect(response.headers.get("etag")).toBe(`"${"a".repeat(64)}"`);
		expect(await response.arrayBuffer()).toEqual(
			new Uint8Array([1, 2, 3]).buffer,
		);
		expect(mocks.readDependency).toHaveBeenCalledWith(
			{ workspaceId: "workspace-1", userId: "user-1" },
			"opaque",
		);
	});

	it.each([
		["PREVIEW_ACCESS_DENIED", 403],
		["PREVIEW_GRANT_EXPIRED", 400],
		["PREVIEW_DEPENDENCY_MISSING", 404],
		["PREVIEW_DEPENDENCY_UNAVAILABLE", 503],
	] as const)(
		"maps %s without leaking storage details",
		async (code, status) => {
			mocks.readDependency.mockRejectedValue(
				new mocks.CompositionPreviewAccessError(code),
			);
			const response = await GET(new Request("http://localhost"), {
				params: Promise.resolve({ token: "opaque" }),
			});
			expect(response.status).toBe(status);
			expect(await response.json()).toEqual({ code, message: code });
		},
	);
});
