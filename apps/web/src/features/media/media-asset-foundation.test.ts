import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Bytes } from "@affichannel/api/media/media-asset-checksum";
import {
	LocalMediaAssetStorage,
	R2MediaAssetStorage,
} from "@affichannel/api/media/media-asset-storage";
import { createMediaAssetStorage } from "@affichannel/api/media/media-asset-storage-factory";
import { validateMediaAssetBytes } from "@affichannel/api/media/media-asset-validation";
import {
	assertMediaAssetStatusTransition,
	assertReadyMetadata,
	canTransitionMediaAssetStatus,
	createMediaAssetStorageKey,
	MediaAssetError,
	normalizeMediaTags,
	sanitizeOriginalFilename,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

function pngFixture(width = 3, height = 2) {
	const bytes = new Uint8Array(33);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
	bytes.set([0, 0, 0, 13], 8);
	bytes.set([73, 72, 68, 82], 12);
	bytes.set(
		[
			(width >>> 24) & 255,
			(width >>> 16) & 255,
			(width >>> 8) & 255,
			width & 255,
		],
		16,
	);
	bytes.set(
		[
			(height >>> 24) & 255,
			(height >>> 16) & 255,
			(height >>> 8) & 255,
			height & 255,
		],
		20,
	);
	return bytes;
}

function jpegFixture(width = 3, height = 2) {
	return Uint8Array.from([
		0xff,
		0xd8,
		0xff,
		0xc0,
		0,
		8,
		8,
		(height >>> 8) & 255,
		height & 255,
		(width >>> 8) & 255,
		width & 255,
		0,
	]);
}

function mp3Fixture(frameCount = 40) {
	const frame = Uint8Array.from({ length: 417 }, (_, index) =>
		index === 0
			? 0xff
			: index === 1
				? 0xfb
				: index === 2
					? 0x90
					: index === 3
						? 0x64
						: 0,
	);
	const fixture = new Uint8Array(frame.length * frameCount);
	for (let index = 0; index < frameCount; index += 1)
		fixture.set(frame, index * frame.length);
	return fixture;
}

describe("AFF-US-020 MediaAsset domain and validation foundation", () => {
	it("locks lifecycle transitions, immutable-ready requirements, and tag rules", () => {
		expect(canTransitionMediaAssetStatus("pending_upload", "validating")).toBe(
			true,
		);
		expect(canTransitionMediaAssetStatus("ready", "validating")).toBe(false);
		expect(() =>
			assertMediaAssetStatusTransition("ready", "pending_upload"),
		).toThrowError(
			expect.objectContaining({ code: "MEDIA_ASSET_INVALID_STATUS" }),
		);
		expect(() =>
			assertReadyMetadata({
				mediaType: "image",
				mimeType: "image/png",
				byteSize: 33,
				checksumSha256: "0".repeat(64),
				width: null,
				height: 2,
				durationMs: null,
			}),
		).toThrowError(MediaAssetError);
		expect(normalizeMediaTags([" Campaign ", "Organic"])).toEqual([
			"Campaign",
			"Organic",
		]);
		expect(() => normalizeMediaTags(["A", "a"])).toThrowError(MediaAssetError);
	});

	it("creates scoped keys and rejects traversal while allowing an opaque extension", () => {
		expect(
			createMediaAssetStorageKey({
				workspaceId: "ws-a",
				assetId: "asset-a",
				objectName: "payload.png",
			}),
		).toBe("media/v1/ws-a/asset-a/payload.png");
		expect(() =>
			createMediaAssetStorageKey({
				workspaceId: "../ws",
				assetId: "asset-a",
				objectName: "payload",
			}),
		).toThrowError(
			expect.objectContaining({ code: "MEDIA_ASSET_STORAGE_KEY_INVALID" }),
		);
		expect(sanitizeOriginalFilename("../../secret.png")).toBe(
			".._.._secret.png",
		);
		expect(sanitizeOriginalFilename("C:\\file.png\u0000")).toBe("C:_file.png");
	});

	it("detects PNG magic, authoritative dimensions, MIME, and exact-byte checksum", async () => {
		const bytes = pngFixture();
		await expect(
			validateMediaAssetBytes({
				mediaType: "image",
				bytes,
				originalFilename: "hero.png",
				declaredMimeType: "image/png",
			}),
		).resolves.toMatchObject({
			detectedMediaType: "image",
			mimeType: "image/png",
			byteSize: 33,
			checksumSha256: sha256Bytes(bytes),
			width: 3,
			height: 2,
		});
		await expect(
			validateMediaAssetBytes({
				mediaType: "image",
				bytes,
				originalFilename: "hero.svg",
				declaredMimeType: "image/png",
			}),
		).rejects.toMatchObject({ code: "MEDIA_ASSET_INVALID_MEDIA" });
		await expect(
			validateMediaAssetBytes({
				mediaType: "image",
				bytes: jpegFixture(),
				originalFilename: "hero.png",
				declaredMimeType: "image/jpeg",
			}),
		).rejects.toMatchObject({ code: "MEDIA_ASSET_INVALID_MEDIA" });
		await expect(
			validateMediaAssetBytes({
				mediaType: "image",
				bytes: new Uint8Array([1, 2, 3]),
				originalFilename: "hero.jpg",
				declaredMimeType: "image/jpeg",
			}),
		).rejects.toMatchObject({ code: "MEDIA_ASSET_INVALID_MEDIA" });
		await expect(
			validateMediaAssetBytes({
				mediaType: "image",
				bytes,
				originalFilename: "hero.jpg",
				declaredMimeType: "image/png",
			}),
		).rejects.toMatchObject({ code: "MEDIA_ASSET_INVALID_MEDIA" });
	});

	it("requires a valid MP3 duration and validates MP4 container magic", async () => {
		await expect(
			validateMediaAssetBytes({
				mediaType: "audio",
				bytes: mp3Fixture(),
				originalFilename: "voice.mp3",
				declaredMimeType: "audio/mpeg",
			}),
		).resolves.toMatchObject({ mimeType: "audio/mpeg", durationMs: 1_045 });
		await expect(
			validateMediaAssetBytes({
				mediaType: "audio",
				bytes: new Uint8Array([1, 2, 3]),
				originalFilename: "voice.mp3",
				declaredMimeType: "audio/mpeg",
			}),
		).rejects.toMatchObject({ code: "MEDIA_ASSET_INVALID_MEDIA" });
		await expect(
			validateMediaAssetBytes({
				mediaType: "video",
				bytes: new Uint8Array([1, 2, 3]),
				originalFilename: "clip.mp4",
				declaredMimeType: "video/mp4",
			}),
		).rejects.toMatchObject({ code: "MEDIA_ASSET_INVALID_MEDIA" });
		const mp4 = new Uint8Array(16);
		mp4.set([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
		await expect(
			validateMediaAssetBytes({
				mediaType: "video",
				bytes: mp4,
				originalFilename: "clip.mp4",
				declaredMimeType: "video/mp4",
			}),
		).resolves.toMatchObject({
			mimeType: "video/mp4",
			width: null,
			height: null,
			durationMs: null,
		});
	});

	it("stores local bytes under a private deterministic root and uses a mocked R2 adapter", async () => {
		const root = await mkdtemp(join(tmpdir(), "affichannel-media-"));
		const bytes = pngFixture();
		const storageKey = "media/v1/ws-a/asset-a/payload.png";
		const checksumSha256 = sha256Bytes(bytes);
		try {
			const local = new LocalMediaAssetStorage({ rootDir: root });
			expect(
				await local.put({
					storageKey,
					body: bytes,
					contentType: "image/png",
					checksumSha256,
				}),
			).toEqual({ byteSize: bytes.byteLength, checksumSha256 });
			expect(await local.get(storageKey)).toEqual(bytes);
			expect(
				new Uint8Array(
					await new Response(await local.open(storageKey)).arrayBuffer(),
				),
			).toEqual(bytes);
			expect((await local.head(storageKey))?.byteSize).toBe(bytes.byteLength);
			await expect(
				local.get("media/v1/ws-a/asset-a/../secret.png"),
			).rejects.toMatchObject({
				code: "MEDIA_ASSET_STORAGE_KEY_INVALID",
			});
			await expect(
				local.put({
					storageKey,
					body: bytes,
					contentType: "image/png",
					checksumSha256: "f".repeat(64),
				}),
			).rejects.toMatchObject({ code: "MEDIA_ASSET_CHECKSUM_INVALID" });
			await local.cleanup(storageKey);
			expect(await local.head(storageKey)).toBeNull();
			await expect(local.get(storageKey)).rejects.toMatchObject({
				code: "MEDIA_ASSET_STORAGE_NOT_FOUND",
			});

			const calls: string[] = [];
			const objects = new Map<string, Uint8Array>();
			const r2 = new R2MediaAssetStorage({
				async putObject(input) {
					calls.push(`put:${input.key}`);
					objects.set(input.key, input.body);
				},
				async getObject(key) {
					calls.push(`get:${key}`);
					return objects.get(key) ?? null;
				},
				async headObject(key) {
					return objects.has(key)
						? {
								byteSize: objects.get(key)?.byteLength ?? 0,
								contentType: "image/png",
								etag: null,
							}
						: null;
				},
				async deleteObject(key) {
					calls.push(`delete:${key}`);
					objects.delete(key);
				},
				async createPresignedUploadUrl(input) {
					return `upload:${input.key}`;
				},
				async createPresignedDownloadUrl(input) {
					return `download:${input.key}`;
				},
			});
			expect(
				await r2.createUploadGrant({
					storageKey,
					contentType: "image/png",
					byteSize: bytes.byteLength,
					expiresAt: new Date(Date.now() + 60_000),
				}),
			).toMatchObject({ urlOrToken: `upload:${storageKey}` });
			await r2.put({
				storageKey,
				body: bytes,
				contentType: "image/png",
				checksumSha256,
			});
			expect(await r2.get(storageKey)).toEqual(bytes);
			expect(
				await r2.createDownloadGrant({
					storageKey,
					contentType: "image/png",
					expiresAt: new Date(Date.now() + 60_000),
				}),
			).toMatchObject({ urlOrToken: `download:${storageKey}` });
			await r2.delete(storageKey);
			await expect(r2.get(storageKey)).rejects.toMatchObject({
				code: "MEDIA_ASSET_STORAGE_NOT_FOUND",
			});
			expect(calls).toEqual([
				`put:${storageKey}`,
				`get:${storageKey}`,
				`delete:${storageKey}`,
				`get:${storageKey}`,
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not construct R2 without its dedicated server configuration", () => {
		expect(() => createMediaAssetStorage("r2")).toThrowError(
			expect.objectContaining({ code: "MEDIA_ASSET_CONFIGURATION_INVALID" }),
		);
	});
});
