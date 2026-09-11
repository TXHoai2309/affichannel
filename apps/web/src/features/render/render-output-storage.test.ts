import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	LocalRenderOutputStorage,
	R2RenderOutputStorage,
	RenderOutputStorageError,
} from "@affichannel/api/storage/render-output-storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deterministicRenderOutputFixture } from "./render-output-fixture";

const KEY = "render-artifacts/v1/w1/p1/job1/attempt1/reservation1.mp4";

function body(bytes: Uint8Array) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

describe("AFF-US-021 EN001 21D local output storage", () => {
	let root = "";
	let storage: LocalRenderOutputStorage;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "affichannel-render-output-"));
		storage = new LocalRenderOutputStorage({ rootDir: root });
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("creates once, accepts exact duplicate, and never overwrites", async () => {
		const first = await storage.createOnce({
			storageKey: KEY,
			body: body(deterministicRenderOutputFixture),
		});
		expect(first.kind).toBe("CREATED");
		const duplicate = await storage.createOnce({
			storageKey: KEY,
			body: body(deterministicRenderOutputFixture),
		});
		expect(duplicate.kind).toBe("ALREADY_EXISTS");
		await expect(
			storage.createOnce({
				storageKey: KEY,
				body: body(new Uint8Array([1, 2, 3])),
			}),
		).rejects.toMatchObject({ code: "RENDER_OUTPUT_STORAGE_CONFLICT" });
	});

	it("streams full and single-range reads", async () => {
		const created = await storage.createOnce({
			storageKey: KEY,
			body: body(deterministicRenderOutputFixture),
		});
		const full = await new Response(await storage.open(KEY)).arrayBuffer();
		expect(new Uint8Array(full)).toEqual(deterministicRenderOutputFixture);
		const range = await storage.openRange({
			storageKey: KEY,
			start: 0,
			end: 15,
		});
		const ranged = await new Response(range.stream).arrayBuffer();
		expect(new Uint8Array(ranged)).toEqual(
			deterministicRenderOutputFixture.slice(0, 16),
		);
		expect(created.proof.byteSize).toBe(
			deterministicRenderOutputFixture.byteLength,
		);
	});

	it("rejects traversal and failed streams without publishing an object", async () => {
		await expect(
			storage.createOnce({
				storageKey: "render-artifacts/v1/../p1/job1/attempt1/reservation1.mp4",
				body: body(deterministicRenderOutputFixture),
			}),
		).rejects.toBeInstanceOf(RenderOutputStorageError);
		const failingBody: AsyncIterable<Uint8Array> = {
			async *[Symbol.asyncIterator]() {
				yield deterministicRenderOutputFixture.slice(0, 10);
				throw new Error("simulated stream failure");
			},
		};
		await expect(
			storage.createOnce({ storageKey: KEY, body: failingBody }),
		).rejects.toBeInstanceOf(Error);
		expect(await storage.head(KEY)).toBeNull();
	});

	it("publishes concurrent local writers atomically without overwrite", async () => {
		const [left, right] = await Promise.all([
			storage.createOnce({
				storageKey: KEY,
				body: body(deterministicRenderOutputFixture),
			}),
			storage.createOnce({
				storageKey: KEY,
				body: body(deterministicRenderOutputFixture),
			}),
		]);
		expect(new Set([left.kind, right.kind])).toEqual(
			new Set(["CREATED", "ALREADY_EXISTS"]),
		);
		expect(
			new Uint8Array(await new Response(await storage.open(KEY)).arrayBuffer()),
		).toEqual(deterministicRenderOutputFixture);

		const differentKey = `${KEY.replace("reservation1", "reservation2")}`;
		const results = await Promise.allSettled([
			storage.createOnce({
				storageKey: differentKey,
				body: body(new Uint8Array([11, 12])),
			}),
			storage.createOnce({
				storageKey: differentKey,
				body: body(new Uint8Array([13, 14])),
			}),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			results.filter((result) => result.status === "rejected"),
		).toHaveLength(1);
		const finalBytes = new Uint8Array(
			await new Response(await storage.open(differentKey)).arrayBuffer(),
		);
		expect([
			[11, 12],
			[13, 14],
		]).toContainEqual([...finalBytes]);
	});

	it("uses conditional creation for R2 and inspects exact 412 duplicates", async () => {
		const objects = new Map<string, Uint8Array>();
		const r2 = new R2RenderOutputStorage(
			{
				async putObject(input) {
					if (objects.has(input.key)) throw { status: 412 };
					const chunks: Uint8Array[] = [];
					for await (const chunk of input.body) chunks.push(chunk);
					objects.set(
						input.key,
						new Uint8Array(
							chunks.reduce((size, chunk) => size + chunk.byteLength, 0),
						),
					);
					let offset = 0;
					for (const chunk of chunks) {
						objects.get(input.key)?.set(chunk, offset);
						offset += chunk.byteLength;
					}
				},
				async headObject(key) {
					const value = objects.get(key);
					return value
						? {
								byteSize: value.byteLength,
								contentType: "video/mp4",
								etag: null,
								checksumSha256: null,
							}
						: null;
				},
				async getObject(key, range) {
					const value = objects.get(key);
					if (!value) return null;
					const selected = range
						? value.slice(range.start, range.end + 1)
						: value;
					return {
						stream: body(selected),
						byteSize: selected.byteLength,
						contentType: "video/mp4" as const,
					};
				},
				async deleteObject(key) {
					objects.delete(key);
				},
			},
			{ tempRoot: root },
		);
		const first = await r2.createOnce({
			storageKey: KEY,
			body: body(deterministicRenderOutputFixture),
		});
		const duplicate = await r2.createOnce({
			storageKey: KEY,
			body: body(deterministicRenderOutputFixture),
		});
		expect(first.kind).toBe("CREATED");
		expect(duplicate.kind).toBe("ALREADY_EXISTS");
		await expect(
			r2.createOnce({ storageKey: KEY, body: body(new Uint8Array([7])) }),
		).rejects.toMatchObject({ code: "RENDER_OUTPUT_STORAGE_CONFLICT" });
	});

	it("proves R2 HEAD MIME, size, and optional checksum metadata before bytes", async () => {
		const checksum = createHash("sha256")
			.update(deterministicRenderOutputFixture)
			.digest("hex");
		const makeStorage = (
			stat: {
				byteSize: number;
				contentType: string | null;
				etag?: string | null;
				checksumSha256: string | null;
			} | null,
		) =>
			new R2RenderOutputStorage(
				{
					async putObject() {},
					async headObject() {
						return stat ? { ...stat, etag: stat.etag ?? null } : null;
					},
					async getObject() {
						return {
							stream: body(deterministicRenderOutputFixture),
							byteSize: deterministicRenderOutputFixture.byteLength,
							contentType: "video/mp4",
						};
					},
					async deleteObject() {},
				},
				{ tempRoot: root },
			);

		await expect(
			makeStorage({
				byteSize: deterministicRenderOutputFixture.byteLength,
				contentType: "video/mp4",
				checksumSha256: checksum,
			}).verifyExact({
				storageKey: KEY,
				byteSize: deterministicRenderOutputFixture.byteLength,
				checksumSha256: checksum,
			}),
		).resolves.toMatchObject({ checksumSha256: checksum });
		await expect(
			makeStorage({
				byteSize: deterministicRenderOutputFixture.byteLength,
				contentType: "application/octet-stream",
				checksumSha256: checksum,
			}).verifyExact({
				storageKey: KEY,
				byteSize: deterministicRenderOutputFixture.byteLength,
				checksumSha256: checksum,
			}),
		).rejects.toMatchObject({ code: "RENDER_OUTPUT_STORAGE_CONFLICT" });
		await expect(
			makeStorage({
				byteSize: deterministicRenderOutputFixture.byteLength,
				contentType: "video/mp4",
				checksumSha256: "0".repeat(64),
			}).verifyExact({
				storageKey: KEY,
				byteSize: deterministicRenderOutputFixture.byteLength,
				checksumSha256: checksum,
			}),
		).rejects.toMatchObject({ code: "RENDER_OUTPUT_STORAGE_CONFLICT" });
		await expect(
			makeStorage({
				byteSize: deterministicRenderOutputFixture.byteLength - 1,
				contentType: "video/mp4",
				checksumSha256: null,
			}).verifyExact({
				storageKey: KEY,
				byteSize: deterministicRenderOutputFixture.byteLength,
				checksumSha256: checksum,
			}),
		).rejects.toMatchObject({ code: "RENDER_OUTPUT_STORAGE_CONFLICT" });
		await expect(
			makeStorage(null).verifyExact({
				storageKey: KEY,
				byteSize: deterministicRenderOutputFixture.byteLength,
				checksumSha256: checksum,
			}),
		).rejects.toMatchObject({ code: "RENDER_OUTPUT_STORAGE_NOT_FOUND" });
	});

	it("fails closed when an R2 range response is not the requested MP4 length", async () => {
		const makeStorage = (
			result: {
				byteSize: number;
				contentType: string;
			} | null,
		) =>
			new R2RenderOutputStorage(
				{
					async putObject() {},
					async headObject() {
						return null;
					},
					async getObject() {
						return result
							? { ...result, stream: body(deterministicRenderOutputFixture) }
							: null;
					},
					async deleteObject() {},
				},
				{ tempRoot: root },
			);
		await expect(
			makeStorage({ byteSize: 3, contentType: "video/mp4" }).openRange({
				storageKey: KEY,
				start: 0,
				end: 2,
			}),
		).resolves.toMatchObject({ byteSize: 3 });
		for (const result of [
			{
				byteSize: deterministicRenderOutputFixture.byteLength,
				contentType: "video/mp4",
			},
			{ byteSize: 2, contentType: "video/mp4" },
			{ byteSize: 3, contentType: "application/octet-stream" },
			{ byteSize: 0, contentType: "video/mp4" },
		]) {
			await expect(
				makeStorage(result).openRange({
					storageKey: KEY,
					start: 0,
					end: 2,
				}),
			).rejects.toMatchObject({ code: "RENDER_OUTPUT_STORAGE_ERROR" });
		}
	});

	it("marks an R2 write error with unknown outcome", async () => {
		const r2 = new R2RenderOutputStorage(
			{
				async putObject() {
					throw new Error("provider timeout");
				},
				async headObject() {
					return null;
				},
				async getObject() {
					return null;
				},
				async deleteObject() {},
			},
			{ tempRoot: root },
		);
		await expect(
			r2.createOnce({
				storageKey: KEY,
				body: body(deterministicRenderOutputFixture),
			}),
		).rejects.toMatchObject({
			code: "RENDER_OUTPUT_STORAGE_ERROR",
			unknownOutcome: true,
		});
	});
});
