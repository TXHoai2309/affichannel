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
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@affichannel/ui/components/empty";
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { Skeleton } from "@affichannel/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Images,
	RefreshCw,
	Search,
	SlidersHorizontal,
	UploadCloud,
} from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";

import { orpc } from "@/utils/orpc";

import { MediaAssetCard } from "./media-asset-card";
import { MediaAssetDetail } from "./media-asset-detail";
import { getMediaTypeLabel } from "./media-library-helpers";
import type {
	MediaFilterStatus,
	MediaFilterType,
	MediaListItem,
} from "./media-types";
import { MediaUploadDialog } from "./media-upload-dialog";

type MediaFilters = {
	search: string;
	mediaType: MediaFilterType;
	status: MediaFilterStatus;
};

const INITIAL_FILTERS: MediaFilters = {
	search: "",
	mediaType: "all",
	status: "ready",
};

function MediaListSkeleton() {
	return (
		<div
			aria-label="Đang tải thư viện media"
			className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
			role="status"
		>
			{Array.from({ length: 6 }, (_, index) => (
				<Skeleton className="h-64 rounded-xl" key={index} />
			))}
		</div>
	);
}

function hasActiveFilters(filters: MediaFilters) {
	return (
		filters.search.trim().length > 0 ||
		filters.mediaType !== "all" ||
		filters.status !== INITIAL_FILTERS.status
	);
}

export function MediaLibrary() {
	const [filters, setFilters] = useState<MediaFilters>(INITIAL_FILTERS);
	const deferredSearch = useDeferredValue(filters.search.trim());
	const [loadedItems, setLoadedItems] = useState<MediaListItem[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
	const [uploadOpen, setUploadOpen] = useState(false);
	const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
	const queryClient = useQueryClient();
	const filterKey = [deferredSearch, filters.mediaType, filters.status].join(
		"\u001f",
	);
	const activeFilterKey = useRef(filterKey);
	const archiveScope: "activeOnly" | "archivedOnly" =
		filters.status === "archived" ? "archivedOnly" : "activeOnly";
	const listInput = {
		archiveScope,
		limit: 18,
		mediaType: filters.mediaType === "all" ? undefined : filters.mediaType,
		search: deferredSearch || undefined,
		status: filters.status === "archived" ? undefined : filters.status,
	};
	const mediaQuery = useQuery(
		orpc.media.list.queryOptions({
			input: listInput,
			meta: { suppressGlobalErrorToast: true },
			staleTime: 10_000,
		}),
	);

	useEffect(() => {
		activeFilterKey.current = filterKey;
		setLoadedItems([]);
		setNextCursor(null);
		setLoadMoreError(null);
	}, [filterKey]);

	useEffect(() => {
		if (!mediaQuery.data) return;
		setLoadedItems(mediaQuery.data.items);
		setNextCursor(mediaQuery.data.nextCursor);
		setLoadMoreError(null);
	}, [mediaQuery.data]);

	async function loadMore() {
		if (!nextCursor || isLoadingMore) return;
		const requestFilterKey = filterKey;
		const requestCursor = nextCursor;
		setIsLoadingMore(true);
		setLoadMoreError(null);
		try {
			const nextPage = await queryClient.fetchQuery(
				orpc.media.list.queryOptions({
					input: { ...listInput, cursor: requestCursor },
					meta: { suppressGlobalErrorToast: true },
					staleTime: 10_000,
				}),
			);
			if (activeFilterKey.current !== requestFilterKey) return;
			setLoadedItems((currentItems) => {
				const existing = new Set(currentItems.map((item) => item.id));
				return [
					...currentItems,
					...nextPage.items.filter((item) => !existing.has(item.id)),
				];
			});
			setNextCursor(nextPage.nextCursor);
		} catch {
			if (activeFilterKey.current === requestFilterKey) {
				setLoadMoreError("Không thể tải thêm media. Hãy thử lại.");
			}
		} finally {
			setIsLoadingMore(false);
		}
	}

	async function refreshList() {
		await mediaQuery.refetch();
	}

	function clearFilters() {
		setFilters(INITIAL_FILTERS);
	}

	const isSearchEmpty = hasActiveFilters(filters);

	return (
		<div className="mx-auto w-full max-w-7xl space-y-6">
			<div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
				<div className="space-y-2">
					<p className="font-semibold text-affi-blue text-xs uppercase tracking-[0.18em]">
						Shared media
					</p>
					<h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
						Thư viện media
					</h1>
					<p className="max-w-2xl text-muted-foreground text-sm">
						Lưu trữ và tái sử dụng hình ảnh, video và âm thanh trong một không
						gian riêng tư của workspace.
					</p>
				</div>
				<Button
					className="self-start sm:self-auto"
					onClick={() => setUploadOpen(true)}
				>
					<UploadCloud aria-hidden="true" />
					Tải media lên
				</Button>
			</div>

			<Card className="border-affi-blue-border shadow-sm">
				<CardContent className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_12rem_12rem_auto] md:items-end">
					<div className="min-w-0 space-y-2">
						<Label htmlFor="media-search">Tìm kiếm</Label>
						<div className="relative">
							<Search
								aria-hidden="true"
								className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								aria-label="Tìm kiếm media theo tên hoặc tag"
								className="h-9 pl-9"
								id="media-search"
								onChange={(event) =>
									setFilters((current) => ({
										...current,
										search: event.target.value,
									}))
								}
								placeholder="Tìm theo tên hoặc tag..."
								value={filters.search}
							/>
						</div>
					</div>
					<div className="space-y-2">
						<Label htmlFor="media-type-filter">Loại media</Label>
						<select
							className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
							id="media-type-filter"
							onChange={(event) =>
								setFilters((current) => ({
									...current,
									mediaType: event.target.value as MediaFilterType,
								}))
							}
							value={filters.mediaType}
						>
							<option value="all">Tất cả loại</option>
							<option value="image">Hình ảnh</option>
							<option value="video">Video</option>
							<option value="audio">Âm thanh</option>
						</select>
					</div>
					<div className="space-y-2">
						<Label htmlFor="media-status-filter">Trạng thái</Label>
						<select
							className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
							id="media-status-filter"
							onChange={(event) =>
								setFilters((current) => ({
									...current,
									status: event.target.value as MediaFilterStatus,
								}))
							}
							value={filters.status}
						>
							<option value="ready">Sẵn sàng</option>
							<option value="failed">Tải lên lỗi</option>
							<option value="archived">Đã lưu trữ</option>
						</select>
					</div>
					<div className="flex items-center gap-2 text-muted-foreground text-xs md:pb-2">
						<SlidersHorizontal aria-hidden="true" className="size-4" />
						<span>Lọc trên dữ liệu server</span>
					</div>
				</CardContent>
			</Card>

			{mediaQuery.isPending ? <MediaListSkeleton /> : null}

			{mediaQuery.isError ? (
				<Card className="border-destructive/20 bg-destructive/5">
					<CardHeader>
						<CardTitle className="text-destructive">
							Không thể tải thư viện
						</CardTitle>
						<CardDescription>
							Đã có lỗi khi lấy danh sách media. Bạn có thể thử lại ngay.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button onClick={() => void mediaQuery.refetch()} variant="outline">
							<RefreshCw aria-hidden="true" />
							Thử lại
						</Button>
					</CardContent>
				</Card>
			) : null}

			{mediaQuery.isSuccess && loadedItems.length === 0 ? (
				<Empty className="min-h-72 border bg-card">
					<EmptyMedia variant="icon">
						{isSearchEmpty ? (
							<Search aria-hidden="true" />
						) : (
							<Images aria-hidden="true" />
						)}
					</EmptyMedia>
					<EmptyHeader>
						<EmptyTitle>
							{isSearchEmpty
								? "Không tìm thấy media phù hợp"
								: "Chưa có tài nguyên nào trong thư viện"}
						</EmptyTitle>
						<EmptyDescription>
							{isSearchEmpty
								? "Thử đổi từ khóa hoặc xóa bớt bộ lọc để tìm asset khác."
								: "Tải lên hình ảnh, video hoặc âm thanh đầu tiên của workspace."}
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						{isSearchEmpty ? (
							<Button onClick={clearFilters} variant="outline">
								Xóa bộ lọc
							</Button>
						) : (
							<Button onClick={() => setUploadOpen(true)}>
								<UploadCloud aria-hidden="true" />
								Tải media lên
							</Button>
						)}
					</EmptyContent>
				</Empty>
			) : null}

			{mediaQuery.isSuccess && loadedItems.length > 0 ? (
				<>
					<div
						aria-busy={mediaQuery.isFetching}
						className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
					>
						{loadedItems.map((asset) => (
							<MediaAssetCard
								asset={asset}
								key={asset.id}
								onSelect={setSelectedAssetId}
							/>
						))}
					</div>
					{nextCursor ? (
						<div className="flex flex-col items-center gap-2 pt-2">
							{loadMoreError ? (
								<p className="text-destructive text-sm" role="alert">
									{loadMoreError}
								</p>
							) : null}
							<Button
								disabled={isLoadingMore}
								onClick={() => void loadMore()}
								variant="outline"
							>
								{isLoadingMore
									? "Đang tải..."
									: loadMoreError
										? "Thử lại"
										: "Tải thêm"}
							</Button>
						</div>
					) : null}
				</>
			) : null}

			<div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
				<span>
					{loadedItems.length > 0
						? loadedItems.length +
							" " +
							(loadedItems.length === 1 ? "asset" : "assets") +
							" đang hiển thị"
						: "Dữ liệu được tải từ MediaAsset server"}
				</span>
				{filters.mediaType !== "all" ? (
					<Badge variant="outline">
						{getMediaTypeLabel(filters.mediaType)}
					</Badge>
				) : null}
			</div>

			<MediaUploadDialog
				onCompleted={refreshList}
				onOpenChange={setUploadOpen}
				open={uploadOpen}
			/>
			<MediaAssetDetail
				assetId={selectedAssetId}
				onChanged={refreshList}
				onOpenChange={(open) => {
					if (!open) setSelectedAssetId(null);
				}}
				open={Boolean(selectedAssetId)}
			/>
		</div>
	);
}
