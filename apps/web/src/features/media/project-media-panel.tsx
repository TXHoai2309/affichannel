"use client";

import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import {
	Dialog,
	DialogBackdrop,
	DialogDescription,
	DialogPopup,
	DialogPortal,
	DialogTitle,
} from "@affichannel/ui/components/dialog";
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Archive,
	Check,
	FileAudio,
	FileImage,
	FileVideo,
	Link2,
	Loader2,
	RefreshCw,
	Search,
	Unlink,
} from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import {
	formatMediaBytes,
	formatMediaDimensions,
	formatMediaDuration,
	getMediaErrorMessage,
	getMediaRightsLabel,
	getMediaStatusLabel,
	getMediaTypeLabel,
	mediaAssetPreviewUrl,
} from "./media-library-helpers";
import type { MediaListItem } from "./media-types";
import {
	getProjectMediaEligibilityMessage,
	isProjectMediaLinkEligible,
	mergeProjectMediaPage,
	type ProjectMediaContentType,
} from "./project-media-helpers";

type PickerMediaType = "all" | MediaListItem["mediaType"];

function MediaTypeIcon({
	mediaType,
}: {
	mediaType: MediaListItem["mediaType"];
}) {
	const Icon =
		mediaType === "image"
			? FileImage
			: mediaType === "video"
				? FileVideo
				: FileAudio;
	return <Icon aria-hidden="true" className="size-5" />;
}

function statusVariant(status: MediaListItem["status"]) {
	if (status === "ready") return "success" as const;
	if (status === "failed") return "destructive" as const;
	if (status === "archived") return "secondary" as const;
	return "warning" as const;
}

function mediaSummary(asset: MediaListItem) {
	return [
		getMediaTypeLabel(asset.mediaType),
		formatMediaBytes(asset.byteSize),
		formatMediaDimensions(asset.width, asset.height),
		formatMediaDuration(asset.durationMs),
	]
		.filter(Boolean)
		.join(" · ");
}

function ProjectMediaItem({
	asset,
	onUnlink,
}: {
	asset: MediaListItem;
	onUnlink: (asset: MediaListItem) => void;
}) {
	const getDownload = useMutation(
		orpc.media.getDownload.mutationOptions({ retry: false }),
	);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	async function openPreview() {
		try {
			const grant = await getDownload.mutateAsync({ assetId: asset.id });
			const url = mediaAssetPreviewUrl(grant);
			if (asset.mediaType === "image") {
				setPreviewUrl(url);
				return;
			}
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.target = "_blank";
			anchor.rel = "noreferrer";
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
		} catch (error) {
			toast.error(getMediaErrorMessage(error, "Không thể mở bản xem trước."));
		}
	}

	return (
		<div className="flex flex-col gap-3 rounded-xl border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 items-start gap-3">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-affi-blue-soft text-affi-blue">
					<MediaTypeIcon mediaType={asset.mediaType} />
				</div>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<p className="truncate font-medium text-sm">{asset.displayName}</p>
						<Badge variant={statusVariant(asset.status)}>
							{getMediaStatusLabel(asset.status)}
						</Badge>
					</div>
					<p className="mt-1 truncate text-muted-foreground text-xs">
						{mediaSummary(asset)} · {getMediaRightsLabel(asset.usageRights)}
					</p>
					{asset.status === "archived" ? (
						<p className="mt-1 flex items-center gap-1 text-muted-foreground text-xs">
							<Archive aria-hidden="true" className="size-3" />
							Đã lưu trữ — liên kết lịch sử vẫn được giữ.
						</p>
					) : asset.status !== "ready" ? (
						<p className="mt-1 text-muted-foreground text-xs">
							Media chưa sẵn sàng để sử dụng.
						</p>
					) : null}
					{previewUrl ? (
						<img
							alt={`Xem trước ${asset.displayName}`}
							className="mt-3 max-h-28 rounded-lg border object-contain"
							onError={() => setPreviewUrl(null)}
							src={previewUrl}
						/>
					) : null}
				</div>
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-2">
				{asset.status === "ready" || asset.status === "archived" ? (
					<Button
						disabled={getDownload.isPending}
						onClick={() => void openPreview()}
						size="sm"
						variant="ghost"
					>
						{getDownload.isPending ? (
							<Loader2 aria-hidden="true" className="animate-spin" />
						) : (
							<MediaTypeIcon mediaType={asset.mediaType} />
						)}
						Xem
					</Button>
				) : null}
				<Button
					aria-label={`Gỡ ${asset.displayName} khỏi dự án`}
					onClick={() => onUnlink(asset)}
					size="sm"
					variant="outline"
				>
					<Unlink aria-hidden="true" />
					Gỡ
				</Button>
			</div>
		</div>
	);
}

export function ProjectMediaPanel({
	projectId,
	contentType,
}: {
	projectId: string;
	contentType: ProjectMediaContentType;
}) {
	const queryClient = useQueryClient();
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pickerSearch, setPickerSearch] = useState("");
	const deferredSearch = useDeferredValue(pickerSearch.trim());
	const [pickerType, setPickerType] = useState<PickerMediaType>("all");
	const [pickerItems, setPickerItems] = useState<MediaListItem[]>([]);
	const [pickerCursor, setPickerCursor] = useState<string | null>(null);
	const [pickerNextCursor, setPickerNextCursor] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [unlinkTarget, setUnlinkTarget] = useState<MediaListItem | null>(null);

	const linkedMediaQuery = useQuery(
		orpc.media.list.queryOptions({
			input: { archiveScope: "all", limit: 100, projectId },
			meta: { suppressGlobalErrorToast: true },
			retry: false,
		}),
	);
	const pickerQuery = useQuery(
		orpc.media.list.queryOptions({
			input: {
				archiveScope: "activeOnly",
				cursor: pickerCursor ?? undefined,
				limit: 18,
				mediaType: pickerType === "all" ? undefined : pickerType,
				search: deferredSearch || undefined,
				status: "ready",
			},
			enabled: pickerOpen,
			meta: { suppressGlobalErrorToast: true },
			retry: false,
		}),
	);
	const linkMedia = useMutation(
		orpc.media.linkToProject.mutationOptions({ retry: false }),
	);
	const unlinkMedia = useMutation(
		orpc.media.unlinkFromProject.mutationOptions({ retry: false }),
	);

	const linkedItems = linkedMediaQuery.data?.items ?? [];
	const linkedAssetIds = new Set(linkedItems.map((asset) => asset.id));

	useEffect(() => {
		if (!pickerOpen || !pickerQuery.data) return;
		const pageItems = pickerQuery.data.items;
		setPickerItems((current) =>
			mergeProjectMediaPage(current, pageItems, pickerCursor),
		);
		setPickerNextCursor(pickerQuery.data.nextCursor);
	}, [pickerCursor, pickerOpen, pickerQuery.data]);

	async function refreshMediaQueries() {
		await linkedMediaQuery.refetch();
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: [["media", "list"]] }),
			queryClient.invalidateQueries({ queryKey: [["media", "get"]] }),
		]);
	}

	async function linkAsset(asset: MediaListItem) {
		if (linkedAssetIds.has(asset.id)) return;
		const eligibilityMessage = getProjectMediaEligibilityMessage(
			asset,
			contentType,
		);
		if (eligibilityMessage) {
			setActionError(eligibilityMessage);
			return;
		}
		setActionError(null);
		try {
			await linkMedia.mutateAsync({ assetId: asset.id, projectId });
			await refreshMediaQueries();
			toast.success("Đã thêm media vào dự án");
		} catch (error) {
			setActionError(
				getMediaErrorMessage(
					error,
					"Không thể thêm media. Trạng thái có thể đã thay đổi, hãy thử lại.",
				),
			);
			await Promise.all([linkedMediaQuery.refetch(), pickerQuery.refetch()]);
		}
	}

	async function confirmUnlink() {
		if (!unlinkTarget) return;
		setActionError(null);
		try {
			await unlinkMedia.mutateAsync({
				assetId: unlinkTarget.id,
				projectId,
			});
			setUnlinkTarget(null);
			await refreshMediaQueries();
			toast.success("Đã gỡ media khỏi dự án; file vẫn còn trong thư viện");
		} catch (error) {
			setActionError(
				getMediaErrorMessage(error, "Không thể gỡ media khỏi dự án."),
			);
		}
	}

	function openPicker() {
		setActionError(null);
		setPickerItems([]);
		setPickerCursor(null);
		setPickerNextCursor(null);
		setPickerOpen(true);
	}

	function resetPickerResults() {
		setPickerItems([]);
		setPickerCursor(null);
		setPickerNextCursor(null);
	}

	return (
		<>
			<Card className="rounded-2xl border-affi-blue-border/80 shadow-sm">
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<CardTitle>Tài nguyên media</CardTitle>
						<CardDescription>
							Liên kết asset READY từ thư viện chung; không tạo bản sao trong
							project.
						</CardDescription>
					</div>
					<Button onClick={openPicker} type="button">
						<Link2 aria-hidden="true" />
						Thêm từ thư viện
					</Button>
				</CardHeader>
				<CardContent className="space-y-3">
					{linkedMediaQuery.isPending ? (
						<div
							aria-label="Đang tải media đã liên kết"
							className="h-24 animate-pulse rounded-xl bg-muted"
							role="status"
						/>
					) : linkedMediaQuery.isError ? (
						<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-destructive text-sm">
							<span>Không thể tải media của dự án.</span>
							<Button
								onClick={() => void linkedMediaQuery.refetch()}
								size="sm"
								variant="outline"
							>
								<RefreshCw aria-hidden="true" />
								Thử lại
							</Button>
						</div>
					) : linkedItems.length === 0 ? (
						<div className="rounded-xl border border-dashed p-6 text-center">
							<p className="font-medium text-sm">
								Chưa có media nào được thêm vào dự án.
							</p>
							<p className="mt-1 text-muted-foreground text-xs">
								Chọn asset READY từ thư viện để dùng làm tài nguyên project.
							</p>
						</div>
					) : (
						linkedItems.map((asset) => (
							<ProjectMediaItem
								asset={asset}
								key={asset.id}
								onUnlink={setUnlinkTarget}
							/>
						))
					)}
					{actionError ? (
						<p className="text-destructive text-sm" role="alert">
							{actionError}
						</p>
					) : null}
				</CardContent>
			</Card>

			<Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
				<DialogPortal>
					<DialogBackdrop />
					<DialogPopup className="max-h-[calc(100svh-2rem)] max-w-2xl overflow-y-auto">
						<DialogTitle>Thêm media từ thư viện</DialogTitle>
						<DialogDescription>
							Chỉ liên kết asset hiện có; thao tác này không tải lên file mới.
						</DialogDescription>
						<div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
							<div className="space-y-2">
								<Label htmlFor="project-media-search">Tìm kiếm</Label>
								<div className="relative">
									<Search
										aria-hidden="true"
										className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
									/>
									<Input
										aria-label="Tìm media trong thư viện"
										className="pl-9"
										id="project-media-search"
										onChange={(event) => {
											setPickerSearch(event.target.value);
											resetPickerResults();
										}}
										placeholder="Tìm theo tên hoặc filename..."
										value={pickerSearch}
									/>
								</div>
							</div>
							<div className="space-y-2">
								<Label htmlFor="project-media-type">Loại media</Label>
								<select
									aria-label="Lọc loại media trong thư viện"
									className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
									id="project-media-type"
									onChange={(event) => {
										setPickerType(event.target.value as PickerMediaType);
										resetPickerResults();
									}}
									value={pickerType}
								>
									<option value="all">Tất cả loại</option>
									<option value="image">Hình ảnh</option>
									<option value="video">Video</option>
									<option value="audio">Âm thanh</option>
								</select>
							</div>
						</div>

						<div className="mt-5 space-y-2">
							{pickerQuery.isPending && pickerItems.length === 0 ? (
								<div
									aria-label="Đang tải media có thể liên kết"
									className="h-48 animate-pulse rounded-xl bg-muted"
									role="status"
								/>
							) : pickerQuery.isError ? (
								<div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-destructive text-sm">
									<p>Không thể tải danh sách media.</p>
									<Button
										className="mt-3"
										onClick={() => {
											void pickerQuery.refetch();
										}}
										size="sm"
										variant="outline"
									>
										<RefreshCw aria-hidden="true" />
										Thử lại
									</Button>
								</div>
							) : pickerItems.length === 0 ? (
								<div className="rounded-xl border border-dashed p-6 text-center">
									<p className="font-medium text-sm">Không có media phù hợp.</p>
									<p className="mt-1 text-muted-foreground text-xs">
										Chỉ asset READY chưa lưu trữ được đưa vào picker.
									</p>
								</div>
							) : (
								pickerItems.map((asset) => {
									const alreadyLinked = linkedAssetIds.has(asset.id);
									const eligibilityMessage = getProjectMediaEligibilityMessage(
										asset,
										contentType,
									);
									return (
										<div
											className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
											key={asset.id}
										>
											<div className="flex min-w-0 items-center gap-3">
												<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
													<MediaTypeIcon mediaType={asset.mediaType} />
												</div>
												<div className="min-w-0">
													<p className="truncate font-medium text-sm">
														{asset.displayName}
													</p>
													<p className="truncate text-muted-foreground text-xs">
														{mediaSummary(asset)} ·{" "}
														{getMediaRightsLabel(asset.usageRights)}
													</p>
													{eligibilityMessage && !alreadyLinked ? (
														<p className="mt-1 text-destructive text-xs">
															{eligibilityMessage}
														</p>
													) : null}
												</div>
											</div>
											<Button
												disabled={
													alreadyLinked ||
													!isProjectMediaLinkEligible(asset, contentType) ||
													linkMedia.isPending
												}
												onClick={() => void linkAsset(asset)}
												size="sm"
												variant={alreadyLinked ? "secondary" : "default"}
											>
												{alreadyLinked ? (
													<Check aria-hidden="true" />
												) : linkMedia.isPending ? (
													<Loader2
														aria-hidden="true"
														className="animate-spin"
													/>
												) : (
													<Link2 aria-hidden="true" />
												)}
												{alreadyLinked ? "Đã thêm" : "Thêm"}
											</Button>
										</div>
									);
								})
							)}
						</div>

						{pickerNextCursor ? (
							<div className="mt-4 flex justify-center">
								<Button
									disabled={pickerQuery.isFetching}
									onClick={() => {
										setPickerCursor(pickerNextCursor);
									}}
									variant="outline"
								>
									{pickerQuery.isFetching ? "Đang tải..." : "Tải thêm"}
								</Button>
							</div>
						) : null}

						<div className="mt-6 flex justify-end">
							<Button onClick={() => setPickerOpen(false)} variant="outline">
								Đóng
							</Button>
						</div>
					</DialogPopup>
				</DialogPortal>
			</Dialog>

			<Dialog
				open={Boolean(unlinkTarget)}
				onOpenChange={(open) => {
					if (!open && !unlinkMedia.isPending) setUnlinkTarget(null);
				}}
			>
				<DialogPortal>
					<DialogBackdrop />
					<DialogPopup className="max-w-md">
						<DialogTitle>Gỡ tài nguyên khỏi dự án?</DialogTitle>
						<DialogDescription>
							{unlinkTarget?.displayName} sẽ được gỡ khỏi project hiện tại. File
							vẫn còn trong Media Library và các project khác.
						</DialogDescription>
						<div className="mt-6 flex justify-end gap-2">
							<Button
								disabled={unlinkMedia.isPending}
								onClick={() => setUnlinkTarget(null)}
								variant="outline"
							>
								Hủy
							</Button>
							<Button
								disabled={unlinkMedia.isPending}
								onClick={() => void confirmUnlink()}
							>
								{unlinkMedia.isPending ? (
									<Loader2 aria-hidden="true" className="animate-spin" />
								) : (
									<Unlink aria-hidden="true" />
								)}
								Gỡ khỏi dự án
							</Button>
						</div>
					</DialogPopup>
				</DialogPortal>
			</Dialog>
		</>
	);
}
