import { env } from "@affichannel/env/server";

import type { MediaAssetSizeLimits } from "./media-asset-validation";

export function getMediaAssetSizeLimits(): MediaAssetSizeLimits {
	return {
		image: env.MEDIA_IMAGE_MAX_BYTES,
		video: env.MEDIA_VIDEO_MAX_BYTES,
		audio: env.MEDIA_AUDIO_MAX_BYTES,
	};
}

export function getMediaAssetUploadExpiry(now = Date.now()) {
	return new Date(now + env.MEDIA_UPLOAD_TTL_MS);
}

export function getMediaAssetDownloadExpiry(now = Date.now()) {
	return new Date(now + env.MEDIA_DOWNLOAD_TTL_MS);
}
