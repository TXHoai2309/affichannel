import type { MediaAssetDto } from "@affichannel/api/services/media-asset-service";
import type {
	MediaAssetMimeType,
	MediaAssetStatus,
	MediaType,
	MediaUsageRights,
} from "@affichannel/core";

export const MEDIA_FILE_ACCEPT = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"video/mp4",
	"audio/mpeg",
].join(",");

const EXTENSION_TO_MEDIA: Record<
	string,
	{ mediaType: MediaType; mime: MediaAssetMimeType }
> = {
	jpg: { mediaType: "image", mime: "image/jpeg" },
	jpeg: { mediaType: "image", mime: "image/jpeg" },
	png: { mediaType: "image", mime: "image/png" },
	webp: { mediaType: "image", mime: "image/webp" },
	mp4: { mediaType: "video", mime: "video/mp4" },
	mp3: { mediaType: "audio", mime: "audio/mpeg" },
};

const MIME_TO_MEDIA: Record<
	string,
	{ mediaType: MediaType; mime: MediaAssetMimeType }
> = {
	"image/jpeg": { mediaType: "image", mime: "image/jpeg" },
	"image/png": { mediaType: "image", mime: "image/png" },
	"image/webp": { mediaType: "image", mime: "image/webp" },
	"video/mp4": { mediaType: "video", mime: "video/mp4" },
	"audio/mpeg": { mediaType: "audio", mime: "audio/mpeg" },
};

export function getMediaFileDetails(file: {
	type?: string | null;
	name?: string | null;
}) {
	const mime = file.type?.trim().toLowerCase();
	if (mime && MIME_TO_MEDIA[mime]) return MIME_TO_MEDIA[mime];
	const extension = file.name?.split(".").at(-1)?.toLowerCase();
	return extension ? EXTENSION_TO_MEDIA[extension] : undefined;
}

export function getMediaTypeLabel(mediaType: MediaType) {
	return mediaType === "image"
		? "Hình ảnh"
		: mediaType === "video"
			? "Video"
			: "Âm thanh";
}

export function getMediaStatusLabel(status: MediaAssetStatus) {
	switch (status) {
		case "pending_upload":
			return "Đang chờ tải lên";
		case "validating":
			return "Đang kiểm tra";
		case "ready":
			return "Sẵn sàng";
		case "failed":
			return "Tải lên lỗi";
		case "archived":
			return "Đã lưu trữ";
	}
}

export function getMediaRightsLabel(rights: MediaUsageRights) {
	switch (rights) {
		case "owned":
			return "Sở hữu";
		case "licensed":
			return "Đã cấp phép";
		case "restricted":
			return "Hạn chế";
		case "unknown":
			return "Chưa xác minh";
	}
}

export function formatMediaBytes(bytes: number | null | undefined) {
	if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
		return "Chưa có kích thước";
	}
	if (bytes < 1024) return `${String(bytes)} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes;
	let unitIndex = -1;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatMediaDuration(durationMs: number | null | undefined) {
	if (durationMs === null || durationMs === undefined || durationMs < 0) {
		return null;
	}
	const totalSeconds = Math.round(durationMs / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

export function formatMediaDimensions(
	width: number | null | undefined,
	height: number | null | undefined,
) {
	return width && height ? `${String(width)} × ${String(height)}px` : null;
}

export function getMediaFilenameWithoutExtension(filename: string) {
	const lastDot = filename.lastIndexOf(".");
	return (
		(lastDot > 0 ? filename.slice(0, lastDot) : filename).trim() || "Media"
	);
}

export function parseMediaTags(value: string) {
	const seen = new Set<string>();
	return value
		.split(/[\n,]/)
		.map((tag) => tag.trim())
		.filter((tag) => {
			if (!tag) return false;
			const key = tag.toLocaleLowerCase("vi-VN");
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

export function mediaAssetPreviewUrl(grant: {
	provider: "local" | "r2";
	urlOrToken: string;
}) {
	return grant.provider === "local"
		? `/api/media/download/${encodeURIComponent(grant.urlOrToken)}`
		: grant.urlOrToken;
}

export function mediaAssetUploadUrl(grant: {
	provider: "local" | "r2";
	urlOrToken: string;
}) {
	return grant.provider === "local"
		? `/api/media/upload/${encodeURIComponent(grant.urlOrToken)}`
		: grant.urlOrToken;
}

export function getMediaErrorMessage(
	error: unknown,
	fallback = "Không thể xử lý media. Hãy thử lại.",
) {
	let code: string | undefined;
	if (error && typeof error === "object") {
		const candidate = error as {
			code?: unknown;
			message?: unknown;
			data?: { code?: unknown };
		};
		if (typeof candidate.data?.code === "string") code = candidate.data.code;
		else if (typeof candidate.code === "string") code = candidate.code;
		else if (typeof candidate.message === "string") code = candidate.message;
	}
	if (!code) return fallback;
	switch (code) {
		case "MEDIA_ASSET_INVALID_MEDIA":
			return "Tệp không đúng định dạng hoặc bị lỗi.";
		case "MEDIA_ASSET_SIZE_LIMIT_EXCEEDED":
			return "Tệp vượt quá dung lượng cho phép.";
		case "MEDIA_ASSET_UPLOAD_EXPIRED":
			return "Phiên tải lên đã hết hạn. Hãy bắt đầu lại.";
		case "MEDIA_ASSET_STORAGE_UNAVAILABLE":
		case "MEDIA_ASSET_STORAGE_ERROR":
			return "Kho lưu trữ hiện không sẵn sàng. Hãy thử lại sau.";
		case "MEDIA_ASSET_UPLOAD_NOT_ALLOWED":
			return "Phiên tải lên không còn hợp lệ. Hãy bắt đầu lại.";
		case "MEDIA_ASSET_NOT_READY":
			return "Media chưa sẵn sàng cho thao tác này.";
		case "MEDIA_ASSET_DOWNLOAD_NOT_ALLOWED":
			return "Không thể tải media này xuống.";
		case "MEDIA_ASSET_INVALID_CURSOR":
			return "Danh sách đã thay đổi. Hãy tải lại trang.";
		default:
			return fallback;
	}
}

export function getMediaFailureMessage(
	asset: Pick<MediaAssetDto, "failureCode">,
) {
	return asset.failureCode
		? getMediaErrorMessage(
				{ code: asset.failureCode },
				"Tải lên không hoàn tất.",
			)
		: "Tải lên không hoàn tất.";
}
