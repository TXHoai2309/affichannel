import type { MediaListItem } from "./media-types";

export type ProjectMediaContentType = "ORGANIC" | "AFFILIATE";

export function mergeProjectMediaPage<T extends Pick<MediaListItem, "id">>(
	current: readonly T[],
	page: readonly T[],
	cursor: string | null,
) {
	if (cursor === null) return [...page];
	const existing = new Set(current.map((asset) => asset.id));
	return [...current, ...page.filter((asset) => !existing.has(asset.id))];
}

export function isProjectMediaLinkEligible(
	asset: Pick<MediaListItem, "status" | "archivedAt" | "usageRights">,
	contentType: ProjectMediaContentType,
) {
	if (asset.status !== "ready" || asset.archivedAt) return false;
	return (
		contentType !== "AFFILIATE" ||
		["owned", "licensed"].includes(asset.usageRights)
	);
}

export function getProjectMediaEligibilityMessage(
	asset: Pick<MediaListItem, "status" | "archivedAt" | "usageRights">,
	contentType: ProjectMediaContentType,
) {
	if (asset.status === "archived" || asset.archivedAt) {
		return "Media đã lưu trữ và không thể thêm vào dự án mới.";
	}
	if (asset.status !== "ready") {
		return "Media chưa sẵn sàng để thêm vào dự án.";
	}
	if (
		contentType === "AFFILIATE" &&
		!["owned", "licensed"].includes(asset.usageRights)
	) {
		return "Không đủ quyền sử dụng cho nội dung Affiliate.";
	}
	return null;
}
