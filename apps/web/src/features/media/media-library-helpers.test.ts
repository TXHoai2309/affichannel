import { describe, expect, it } from "vitest";

import {
	formatMediaBytes,
	formatMediaDimensions,
	formatMediaDuration,
	getMediaErrorMessage,
	getMediaFileDetails,
	getMediaFilenameWithoutExtension,
	getMediaRightsLabel,
	getMediaStatusLabel,
	getMediaTypeLabel,
	MEDIA_FILE_ACCEPT,
	mediaAssetPreviewUrl,
	mediaAssetUploadUrl,
	parseMediaTags,
} from "./media-library-helpers";

describe("media library UI helpers", () => {
	it("accepts only the 20C media MIME contract", () => {
		expect(MEDIA_FILE_ACCEPT).toBe(
			"image/jpeg,image/png,image/webp,video/mp4,audio/mpeg",
		);
		expect(
			getMediaFileDetails({ type: "image/png", name: "hero.png" }),
		).toEqual({
			mediaType: "image",
			mime: "image/png",
		});
		expect(getMediaFileDetails({ type: "", name: "clip.MP4" })).toEqual({
			mediaType: "video",
			mime: "video/mp4",
		});
		expect(
			getMediaFileDetails({ type: "image/svg+xml", name: "icon.svg" }),
		).toBeUndefined();
		expect(
			getMediaFileDetails({ type: "image/jpeg", name: "icon.svg" }),
		).toBeUndefined();
		expect(
			getMediaFileDetails({ type: "audio/wav", name: "voice.wav" }),
		).toBeUndefined();
	});

	it("formats card/detail metadata without exposing storage details", () => {
		expect(formatMediaBytes(1024)).toBe("1.0 KB");
		expect(formatMediaBytes(1_048_576)).toBe("1.0 MB");
		expect(formatMediaDuration(1045)).toBe("0:01");
		expect(formatMediaDimensions(1920, 1080)).toBe("1920 × 1080px");
		expect(formatMediaDimensions(null, null)).toBeNull();
		expect(getMediaFilenameWithoutExtension("hero.png")).toBe("hero");
	});

	it("maps canonical labels and sanitized error copy", () => {
		expect(getMediaTypeLabel("image")).toBe("Hình ảnh");
		expect(getMediaStatusLabel("pending_upload")).toBe("Đang chờ tải lên");
		expect(getMediaRightsLabel("unknown")).toBe("Chưa xác minh");
		expect(getMediaRightsLabel("restricted")).toBe("Hạn chế");
		expect(
			getMediaErrorMessage({ data: { code: "MEDIA_ASSET_UPLOAD_EXPIRED" } }),
		).toBe("Phiên tải lên đã hết hạn. Hãy bắt đầu lại.");
		expect(getMediaErrorMessage({ message: "SQL password leaked" })).toBe(
			"Không thể xử lý media. Hãy thử lại.",
		);
	});

	it("normalizes tags and discriminates protected grant URLs", () => {
		expect(parseMediaTags("Campaign, launch, campaign\n")).toEqual([
			"Campaign",
			"launch",
		]);
		expect(
			mediaAssetUploadUrl({
				provider: "local",
				urlOrToken: "token.with+chars",
			}),
		).toBe("/api/media/upload/token.with%2Bchars");
		expect(
			mediaAssetPreviewUrl({
				provider: "r2",
				urlOrToken: "https://r2.example/signed",
			}),
		).toBe("https://r2.example/signed");
	});
});
