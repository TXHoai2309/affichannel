import {
	evaluateQuickImageEligibility,
	type QuickImageEligibilityMediaAsset,
	resolveQuickImageCurrentSourceRows,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

function asset(
	overrides: Partial<QuickImageEligibilityMediaAsset> = {},
): QuickImageEligibilityMediaAsset {
	return {
		id: "asset-a",
		workspaceId: "workspace-a",
		status: "ready",
		archivedAt: null,
		mediaType: "image",
		storageProvider: "local",
		storageKey: "media/v1/workspace-a/asset-a/image.png",
		mimeType: "image/png",
		byteSize: 33,
		checksumSha256: "a".repeat(64),
		width: 3,
		height: 2,
		imageAnalysisVersion: "static-raster-v1",
		imageFrameCount: 1,
		imageExifOrientation: 1,
		imageHasTransparency: false,
		...overrides,
	};
}

describe("AFF-US-022 US22-A Slice 3 Quick Image eligibility", () => {
	it.each(["image/jpeg", "image/png", "image/webp"] as const)(
		"accepts canonical ready static raster MIME %s",
		(mimeType) => {
			const result = evaluateQuickImageEligibility(asset({ mimeType }));
			expect(result).toEqual({
				kind: "ELIGIBLE",
				source: {
					id: "asset-a",
					workspaceId: "workspace-a",
					checksumSha256: "a".repeat(64),
					storageProvider: "local",
					storageKey: "media/v1/workspace-a/asset-a/image.png",
					mimeType,
					byteSize: 33,
					width: 3,
					height: 2,
				},
			});
		},
	);

	it.each([
		["image/svg+xml", "UNSUPPORTED_MIME"],
		["image/gif", "UNSUPPORTED_MIME"],
		["video/mp4", "UNSUPPORTED_MIME"],
		["application/octet-stream", "UNSUPPORTED_MIME"],
	] as const)("rejects non-v1 MIME %s", (mimeType, reasonCode) => {
		expect(evaluateQuickImageEligibility(asset({ mimeType }))).toEqual({
			kind: "INELIGIBLE",
			reasonCode,
		});
	});

	it.each([
		["pending_upload", "MEDIA_NOT_READY"],
		["validating", "MEDIA_NOT_READY"],
		["archived", "MEDIA_NOT_READY"],
	] as const)("rejects unusable status %s", (status, reasonCode) => {
		expect(evaluateQuickImageEligibility(asset({ status }))).toEqual({
			kind: "INELIGIBLE",
			reasonCode,
		});
	});

	it.each([
		["imageAnalysisVersion", null, "IMAGE_PROOF_MISSING"],
		["imageFrameCount", null, "IMAGE_PROOF_MISSING"],
		["imageExifOrientation", null, "IMAGE_PROOF_MISSING"],
		["imageHasTransparency", null, "IMAGE_PROOF_MISSING"],
		[
			"imageAnalysisVersion",
			"static-raster-v0",
			"UNSUPPORTED_ANALYSIS_VERSION",
		],
		["imageFrameCount", 0, "NOT_SINGLE_FRAME"],
		["imageFrameCount", 2, "NOT_SINGLE_FRAME"],
		["imageExifOrientation", 2, "NON_CANONICAL_ORIENTATION"],
		["imageHasTransparency", true, "TRANSPARENCY_NOT_ALLOWED"],
	] as const)(
		"fails closed for proof field %s=%s",
		(field, value, reasonCode) => {
			expect(evaluateQuickImageEligibility(asset({ [field]: value }))).toEqual({
				kind: "INELIGIBLE",
				reasonCode,
			});
		},
	);

	it.each([
		["byteSize", 0],
		["width", 0],
		["height", -1],
		["checksumSha256", "A".repeat(64)],
		["storageKey", "   "],
	] as const)("rejects invalid frozen metadata %s=%s", (field, value) => {
		expect(evaluateQuickImageEligibility(asset({ [field]: value }))).toEqual({
			kind: "INELIGIBLE",
			reasonCode: "INVALID_MEDIA_METADATA",
		});
	});

	it("resolves zero, eligible, ineligible, and duplicate source rows fail-closed", () => {
		expect(resolveQuickImageCurrentSourceRows([])).toEqual({
			status: "MISSING",
		});
		expect(
			resolveQuickImageCurrentSourceRows([
				{ linkId: "link-a", asset: asset() },
			]),
		).toMatchObject({ status: "READY", linkId: "link-a" });
		expect(
			resolveQuickImageCurrentSourceRows([
				{
					linkId: "link-b",
					asset: asset({ imageFrameCount: 2 }),
				},
			]),
		).toEqual({
			status: "INELIGIBLE",
			linkId: "link-b",
			mediaAssetId: "asset-a",
			reasonCode: "NOT_SINGLE_FRAME",
		});
		expect(
			resolveQuickImageCurrentSourceRows([
				{ linkId: "link-a", asset: asset() },
				{ linkId: "link-b", asset: asset({ id: "asset-b" }) },
			]),
		).toEqual({ status: "CORRUPT_MULTIPLE" });
	});
});
