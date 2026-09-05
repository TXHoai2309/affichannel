import type { MediaAssetDto } from "@affichannel/api/services/media-asset-service";

export type MediaListItem = MediaAssetDto;
export type MediaAssetDetail = MediaAssetDto & {
	linkCount: number;
};

export type MediaFilterType = "all" | MediaListItem["mediaType"];
export type MediaFilterStatus = "ready" | "failed" | "archived";
