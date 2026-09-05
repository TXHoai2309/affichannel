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
	DialogClose,
	DialogDescription,
	DialogPopup,
	DialogPortal,
	DialogTitle,
} from "@affichannel/ui/components/dialog";
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { Skeleton } from "@affichannel/ui/components/skeleton";
import { Textarea } from "@affichannel/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	Archive,
	Download,
	Edit3,
	FileAudio,
	FileImage,
	FileVideo,
	Loader2,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import {
	formatMediaBytes,
	formatMediaDimensions,
	formatMediaDuration,
	getMediaErrorMessage,
	getMediaFailureMessage,
	getMediaRightsLabel,
	getMediaStatusLabel,
	getMediaTypeLabel,
	mediaAssetPreviewUrl,
	parseMediaTags,
} from "./media-library-helpers";

function statusVariant(
	status: "pending_upload" | "validating" | "ready" | "failed" | "archived",
) {
	if (status === "ready") return "success" as const;
	if (status === "failed") return "destructive" as const;
	if (status === "archived") return "secondary" as const;
	return "warning" as const;
}

function formatDate(value: string | Date) {
	return new Intl.DateTimeFormat("vi-VN", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function PreviewIcon({
	mediaType,
}: {
	mediaType: "image" | "video" | "audio";
}) {
	const Icon =
		mediaType === "image"
			? FileImage
			: mediaType === "video"
				? FileVideo
				: FileAudio;
	return <Icon aria-hidden="true" className="size-8" />;
}

function MediaPreview({
	mediaType,
	displayName,
	url,
	loading,
	error,
	onRetry,
}: {
	mediaType: "image" | "video" | "audio";
	displayName: string;
	url: string | null;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
}) {
	if (loading) {
		return <Skeleton className="h-56 w-full rounded-xl" />;
	}
	if (error) {
		return (
			<div className="flex h-56 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-center text-destructive">
				<p className="text-sm">{error}</p>
				<Button onClick={onRetry} size="sm" variant="outline">
					<RefreshCw aria-hidden="true" />
					Thử lại
				</Button>
			</div>
		);
	}
	if (!url) {
		return (
			<div className="flex h-56 items-center justify-center rounded-xl bg-muted text-muted-foreground">
				<PreviewIcon mediaType={mediaType} />
			</div>
		);
	}
	if (mediaType === "image") {
		return (
			<div className="flex h-56 items-center justify-center overflow-hidden rounded-xl bg-muted">
				<img
					alt={`Xem trước ${displayName}`}
					className="h-full w-full object-contain"
					src={url}
				/>
			</div>
		);
	}
	if (mediaType === "video") {
		return (
			<video
				className="h-56 w-full rounded-xl bg-black object-contain"
				controls
				preload="metadata"
				src={url}
			>
				<track
					default
					kind="captions"
					src="data:text/vtt,WEBVTT%0A"
					srcLang="vi"
				/>
				Trình duyệt không hỗ trợ xem video.
			</video>
		);
	}
	return (
		<div className="flex h-56 items-center justify-center rounded-xl bg-muted p-5">
			<audio
				aria-label={`Phát ${displayName}`}
				className="w-full"
				controls
				preload="metadata"
				src={url}
			>
				<track
					default
					kind="captions"
					src="data:text/vtt,WEBVTT%0A"
					srcLang="vi"
				/>
				Trình duyệt không hỗ trợ phát âm thanh.
			</audio>
		</div>
	);
}

export function MediaAssetDetail({
	assetId,
	open,
	onOpenChange,
	onChanged,
}: {
	assetId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onChanged: () => Promise<void> | void;
}) {
	const assetQuery = useQuery(
		orpc.media.get.queryOptions({
			input: { assetId: assetId ?? "" },
			enabled: open && Boolean(assetId),
			meta: { suppressGlobalErrorToast: true },
		}),
	);
	const getDownload = useMutation(
		orpc.media.getDownload.mutationOptions({ retry: false }),
	);
	const updateMetadata = useMutation(
		orpc.media.updateMetadata.mutationOptions({ retry: false }),
	);
	const archiveAsset = useMutation(
		orpc.media.archive.mutationOptions({ retry: false }),
	);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);
	const previewRequest = useRef(0);
	const [editing, setEditing] = useState(false);
	const [archiveOpen, setArchiveOpen] = useState(false);
	const [displayName, setDisplayName] = useState("");
	const [tagsInput, setTagsInput] = useState("");
	const [usageRights, setUsageRights] = useState<
		"owned" | "licensed" | "unknown" | "restricted"
	>("unknown");

	const asset = assetQuery.data?.asset;
	const linkCount = assetQuery.data?.linkCount ?? 0;
	const previewableAssetId =
		asset?.status === "ready" || asset?.status === "archived" ? asset.id : null;

	useEffect(() => {
		if (!asset) return;
		setDisplayName(asset.displayName);
		setTagsInput(asset.tags.join(", "));
		setUsageRights(asset.usageRights);
		setEditing(false);
	}, [asset]);

	const loadPreview = useCallback(async () => {
		if (
			!asset?.id ||
			(asset.status !== "ready" && asset.status !== "archived")
		) {
			setPreviewUrl(null);
			return;
		}
		const requestId = ++previewRequest.current;
		setPreviewError(null);
		setPreviewUrl(null);
		try {
			const grant = await getDownload.mutateAsync({ assetId: asset.id });
			if (requestId === previewRequest.current) {
				setPreviewUrl(mediaAssetPreviewUrl(grant));
			}
		} catch (error) {
			if (requestId === previewRequest.current) {
				setPreviewError(
					getMediaErrorMessage(error, "Không thể tải bản xem trước."),
				);
			}
		}
	}, [asset?.id, asset?.status, getDownload.mutateAsync]);

	useEffect(() => {
		if (!open || !previewableAssetId) return;
		void loadPreview();
		return () => {
			previewRequest.current += 1;
			setPreviewUrl(null);
		};
	}, [open, previewableAssetId, loadPreview]);

	async function downloadAsset() {
		if (!asset) return;
		try {
			const grant = await getDownload.mutateAsync({ assetId: asset.id });
			const anchor = document.createElement("a");
			anchor.href = mediaAssetPreviewUrl(grant);
			anchor.download = asset.originalFilename;
			anchor.rel = "noreferrer";
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
		} catch (error) {
			toast.error(getMediaErrorMessage(error, "Không thể tải media xuống."));
		}
	}

	async function saveMetadata() {
		if (!asset || !displayName.trim()) return;
		try {
			await updateMetadata.mutateAsync({
				assetId: asset.id,
				displayName: displayName.trim(),
				tags: parseMediaTags(tagsInput),
				usageRights,
			});
			setEditing(false);
			await assetQuery.refetch();
			await onChanged();
			toast.success("Đã cập nhật thông tin media");
		} catch (error) {
			toast.error(getMediaErrorMessage(error, "Không thể cập nhật media."));
		}
	}

	async function archive() {
		if (!asset) return;
		try {
			await archiveAsset.mutateAsync({ assetId: asset.id });
			setArchiveOpen(false);
			await onChanged();
			toast.success("Đã lưu trữ media");
			onOpenChange(false);
		} catch (error) {
			toast.error(getMediaErrorMessage(error, "Không thể lưu trữ media."));
		}
	}

	const dimensions = asset
		? formatMediaDimensions(asset.width, asset.height)
		: null;
	const duration = asset ? formatMediaDuration(asset.durationMs) : null;
	const technicalDetails = asset
		? [
				["Tên tệp", asset.originalFilename],
				["Loại media", getMediaTypeLabel(asset.mediaType)],
				["MIME", asset.mimeType],
				["Dung lượng", formatMediaBytes(asset.byteSize)],
				["Kích thước", dimensions],
				["Thời lượng", duration],
				["Tạo lúc", formatDate(asset.createdAt)],
				["Cập nhật", formatDate(asset.updatedAt)],
			].filter((entry): entry is [string, string] => Boolean(entry[1]))
		: [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogBackdrop />
				<DialogPopup className="max-h-[calc(100svh-2rem)] max-w-3xl overflow-y-auto">
					{assetQuery.isPending ? (
						<div className="space-y-4">
							<Skeleton className="h-7 w-48" />
							<Skeleton className="h-56 w-full rounded-xl" />
							<Skeleton className="h-40 w-full rounded-xl" />
						</div>
					) : assetQuery.isError || !asset ? (
						<div className="space-y-4">
							<DialogTitle>Không thể tải media</DialogTitle>
							<p className="text-muted-foreground text-sm">
								Media không tồn tại hoặc bạn không có quyền truy cập.
							</p>
							<Button
								onClick={() => void assetQuery.refetch()}
								variant="outline"
							>
								<RefreshCw aria-hidden="true" />
								Thử lại
							</Button>
						</div>
					) : (
						<>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0">
									<DialogTitle className="truncate">
										{asset.displayName}
									</DialogTitle>
									<DialogDescription className="truncate">
										{asset.originalFilename}
									</DialogDescription>
								</div>
								<Badge variant={statusVariant(asset.status)}>
									{getMediaStatusLabel(asset.status)}
								</Badge>
							</div>

							<div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
								<div className="space-y-3">
									<MediaPreview
										displayName={asset.displayName}
										error={previewError}
										loading={getDownload.isPending}
										mediaType={asset.mediaType}
										onRetry={() => void loadPreview()}
										url={previewUrl}
									/>
									<div className="flex flex-wrap gap-2">
										{asset.status === "ready" || asset.status === "archived" ? (
											<Button
												disabled={getDownload.isPending}
												onClick={() => void downloadAsset()}
												variant="outline"
											>
												<Download aria-hidden="true" />
												Tải xuống
											</Button>
										) : null}
										{asset.status !== "archived" &&
										(asset.status === "ready" || asset.status === "failed") ? (
											<Button
												onClick={() => setArchiveOpen(true)}
												variant="destructive"
											>
												<Archive aria-hidden="true" />
												Lưu trữ
											</Button>
										) : null}
									</div>
								</div>

								<div className="space-y-4">
									<Card size="sm">
										<CardHeader>
											<CardTitle>Thông tin</CardTitle>
											<CardDescription>
												Thông tin server đã xác nhận cho asset này.
											</CardDescription>
										</CardHeader>
										<CardContent className="space-y-2">
											{technicalDetails.map(([label, value]) => (
												<div
													className="flex items-start justify-between gap-4 text-xs"
													key={label}
												>
													<span className="text-muted-foreground">{label}</span>
													<span className="max-w-[62%] text-right">
														{value}
													</span>
												</div>
											))}
											<div className="flex items-center justify-between gap-4 text-xs">
												<span className="text-muted-foreground">
													Quyền sử dụng
												</span>
												<span className="inline-flex items-center gap-1">
													<ShieldCheck
														aria-hidden="true"
														className="size-3.5"
													/>
													{getMediaRightsLabel(asset.usageRights)}
												</span>
											</div>
											{linkCount > 0 ? (
												<div className="flex items-center justify-between gap-4 text-xs">
													<span className="text-muted-foreground">
														Đang dùng trong
													</span>
													<span>{linkCount} dự án</span>
												</div>
											) : null}
										</CardContent>
									</Card>

									<Card size="sm">
										<CardHeader className="flex-row items-center justify-between">
											<div>
												<CardTitle>Thông tin hiển thị</CardTitle>
												<CardDescription>
													Tên, tags và quyền sử dụng có thể chỉnh sửa.
												</CardDescription>
											</div>
											<Button
												aria-label={
													editing
														? "Hủy chỉnh sửa metadata"
														: "Chỉnh sửa metadata"
												}
												onClick={() => setEditing((current) => !current)}
												size="icon-sm"
												variant="ghost"
											>
												<Edit3 aria-hidden="true" />
											</Button>
										</CardHeader>
										<CardContent className="space-y-3">
											{editing ? (
												<>
													<div className="space-y-2">
														<Label htmlFor="media-detail-display-name">
															Tên hiển thị
														</Label>
														<Input
															id="media-detail-display-name"
															maxLength={240}
															onChange={(event) =>
																setDisplayName(event.target.value)
															}
															value={displayName}
														/>
													</div>
													<div className="space-y-2">
														<Label htmlFor="media-detail-tags">Tags</Label>
														<Textarea
															id="media-detail-tags"
															onChange={(event) =>
																setTagsInput(event.target.value)
															}
															placeholder="campaign, launch"
															value={tagsInput}
														/>
													</div>
													<div className="space-y-2">
														<Label htmlFor="media-detail-rights">
															Quyền sử dụng
														</Label>
														<select
															className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
															id="media-detail-rights"
															onChange={(event) =>
																setUsageRights(
																	event.target.value as
																		| "owned"
																		| "licensed"
																		| "unknown"
																		| "restricted",
																)
															}
															value={usageRights}
														>
															<option value="unknown">Chưa xác minh</option>
															<option value="owned">Sở hữu</option>
															<option value="licensed">Đã cấp phép</option>
															<option value="restricted">Hạn chế</option>
														</select>
													</div>
													<div className="flex justify-end gap-2">
														<Button
															onClick={() => setEditing(false)}
															variant="outline"
														>
															Hủy
														</Button>
														<Button
															disabled={
																updateMetadata.isPending || !displayName.trim()
															}
															onClick={() => void saveMetadata()}
														>
															{updateMetadata.isPending ? (
																<Loader2
																	aria-hidden="true"
																	className="animate-spin"
																/>
															) : null}
															Lưu thay đổi
														</Button>
													</div>
												</>
											) : (
												<>
													<p className="font-medium text-sm">
														{asset.displayName}
													</p>
													<div className="flex flex-wrap gap-1.5">
														{asset.tags.length > 0 ? (
															asset.tags.map((tag) => (
																<Badge key={tag} variant="outline">
																	{tag}
																</Badge>
															))
														) : (
															<span className="text-muted-foreground text-xs">
																Chưa có tag
															</span>
														)}
													</div>
												</>
											)}
										</CardContent>
									</Card>

									{asset.failureCode ? (
										<div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-destructive text-xs">
											{getMediaFailureMessage(asset)}
										</div>
									) : null}
								</div>
							</div>
						</>
					)}

					<div className="mt-6 flex justify-end">
						<DialogClose render={<Button variant="outline" />}>
							Đóng
						</DialogClose>
					</div>
				</DialogPopup>
			</DialogPortal>
			<Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
				<DialogPortal>
					<DialogBackdrop />
					<DialogPopup className="max-w-md">
						<DialogTitle>Lưu trữ media?</DialogTitle>
						<DialogDescription>
							Media sẽ rời khỏi thư viện đang hoạt động nhưng file và lịch sử
							không bị xóa. Các liên kết hiện có vẫn được giữ nguyên.
						</DialogDescription>
						<div className="mt-6 flex justify-end gap-2">
							<DialogClose render={<Button variant="outline" />}>
								Hủy
							</DialogClose>
							<Button
								disabled={archiveAsset.isPending}
								onClick={() => void archive()}
								variant="destructive"
							>
								{archiveAsset.isPending ? "Đang lưu trữ..." : "Lưu trữ"}
							</Button>
						</div>
					</DialogPopup>
				</DialogPortal>
			</Dialog>
		</Dialog>
	);
}
