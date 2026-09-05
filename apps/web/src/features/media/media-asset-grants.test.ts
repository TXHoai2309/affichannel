import {
	createLocalMediaAssetGrant,
	verifyLocalMediaAssetGrant,
} from "@affichannel/api/media/media-asset-grants";
import { toAssetDto } from "@affichannel/api/services/media-asset-service";
import type { MediaAsset } from "@affichannel/core";
import { describe, expect, it } from "vitest";

describe("AFF-US-020 protected local media grants", () => {
	it("is stateless, purpose-bound, expiry-bound, and tamper-evident", () => {
		const token = createLocalMediaAssetGrant({
			purpose: "upload",
			workspaceId: "ws-a",
			assetId: "asset-a",
			storageKey: "media/v1/ws-a/asset-a/payload.png",
			uploadSessionId: "session-a",
			contentType: "image/png",
			byteSize: 32,
			expiresAt: Date.now() + 60_000,
		});
		expect(verifyLocalMediaAssetGrant(token, "upload")).toMatchObject({
			workspaceId: "ws-a",
			assetId: "asset-a",
			uploadSessionId: "session-a",
		});
		expect(() =>
			verifyLocalMediaAssetGrant(`${token}x`, "upload"),
		).toThrowError(
			expect.objectContaining({ code: "MEDIA_ASSET_GRANT_INVALID" }),
		);
		expect(() => verifyLocalMediaAssetGrant(token, "download")).toThrowError(
			expect.objectContaining({ code: "MEDIA_ASSET_GRANT_INVALID" }),
		);
	});

	it("keeps storage identity out of public asset DTOs", () => {
		const asset: MediaAsset = {
			id: "asset-a",
			workspaceId: "ws-a",
			createdByUserId: "user-a",
			origin: "user_upload",
			mediaType: "image",
			status: "pending_upload",
			storageProvider: "local",
			storageKey: "media/v1/ws-a/asset-a/private.png",
			uploadSessionId: "session-a",
			prepareIdempotencyKey: "prepare-a",
			uploadExpiresAt: new Date(Date.now() + 60_000),
			originalFilename: "private.png",
			displayName: "Private",
			declaredMimeType: "image/png",
			mimeType: null,
			byteSize: null,
			checksumSha256: null,
			width: null,
			height: null,
			durationMs: null,
			usageRights: "unknown",
			tags: [],
			failureCode: null,
			finalizedAt: null,
			archivedAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		const dto = toAssetDto(asset);
		expect(dto).not.toHaveProperty("storageKey");
		expect(dto).not.toHaveProperty("prepareIdempotencyKey");
	});
});
