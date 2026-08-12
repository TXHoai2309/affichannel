"use client";

import type {
	ProductFactRecord,
	ProductFactStatus,
	ProductFactType,
} from "@affichannel/core/product-fact/types";
import { Button } from "@affichannel/ui/components/button";
import {
	Dialog,
	DialogBackdrop,
	DialogClose,
	DialogDescription,
	DialogPopup,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
} from "@affichannel/ui/components/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@affichannel/ui/components/empty";
import { Input } from "@affichannel/ui/components/input";
import { Skeleton } from "@affichannel/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import { getFactErrorMessage } from "./fact-errors";
import { FactFormDrawer } from "./fact-form-drawer";
import { FactStatusBadge } from "./fact-status-badge";
import { FACT_STATUS_LABELS, FACT_TYPE_LABELS, FACT_TYPES } from "./fact-types";

function formatDate(value: string | Date | null) {
	if (!value) return "—";
	return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(
		new Date(value),
	);
}

function FactDeleteDialog({
	fact,
	onDelete,
	isPending,
}: {
	fact: ProductFactRecord;
	onDelete: () => void;
	isPending: boolean;
}) {
	return (
		<Dialog>
			<DialogTrigger
				render={
					<Button
						aria-label={`Xóa Fact ${fact.content}`}
						size="icon"
						variant="ghost"
					/>
				}
			>
				<Trash2 aria-hidden="true" className="text-destructive" />
			</DialogTrigger>
			<DialogPortal>
				<DialogBackdrop />
				<DialogPopup>
					<DialogTitle>Xóa Product Fact?</DialogTitle>
					<DialogDescription>
						Lịch sử thay đổi sẽ vẫn được giữ lại để truy vết sau khi Fact bị
						xóa.
					</DialogDescription>
					<div className="mt-6 flex justify-end gap-2">
						<DialogClose render={<Button variant="outline" />}>Hủy</DialogClose>
						<DialogClose
							render={
								<Button
									disabled={isPending}
									onClick={onDelete}
									variant="destructive"
								/>
							}
						>
							Xóa Fact
						</DialogClose>
					</div>
				</DialogPopup>
			</DialogPortal>
		</Dialog>
	);
}

export function FactList({
	productId,
	onChanged,
}: {
	productId: string;
	onChanged?: () => Promise<void> | void;
}) {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [type, setType] = useState<ProductFactType | "">("");
	const [status, setStatus] = useState<ProductFactStatus | "">("");
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [editingFact, setEditingFact] = useState<
		ProductFactRecord | undefined
	>();
	const deferredSearch = useDeferredValue(search.trim());
	const [loadedItems, setLoadedItems] = useState<ProductFactRecord[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const filterKey = [productId, deferredSearch, type, status].join("\u001f");
	const activeFilterKey = useRef(filterKey);
	const listInput = {
		productId,
		search: deferredSearch || undefined,
		type: type || undefined,
		status: status || undefined,
		limit: 30,
	};
	const factsQuery = useQuery(
		orpc.productFact.list.queryOptions({
			input: listInput,
			meta: { suppressGlobalErrorToast: true },
			staleTime: 15_000,
		}),
	);

	useEffect(() => {
		activeFilterKey.current = filterKey;
		setLoadedItems([]);
		setNextCursor(null);
		setLoadMoreError(null);
	}, [filterKey]);

	useEffect(() => {
		if (factsQuery.data?.kind !== "success") return;
		setLoadedItems(factsQuery.data.items as ProductFactRecord[]);
		setNextCursor(factsQuery.data.nextCursor);
		setLoadMoreError(null);
	}, [factsQuery.data]);

	async function refreshFacts() {
		await factsQuery.refetch();
		await onChanged?.();
	}

	async function loadMore() {
		if (!nextCursor || isLoadingMore) return;
		const requestFilterKey = filterKey;
		setIsLoadingMore(true);
		setLoadMoreError(null);
		try {
			const nextPage = await queryClient.fetchQuery(
				orpc.productFact.list.queryOptions({
					input: { ...listInput, cursor: nextCursor },
					meta: { suppressGlobalErrorToast: true },
					staleTime: 15_000,
				}),
			);
			if (activeFilterKey.current !== requestFilterKey) return;
			setLoadedItems((current) => [
				...current,
				...(nextPage.items as ProductFactRecord[]),
			]);
			setNextCursor(nextPage.nextCursor);
		} catch {
			if (activeFilterKey.current === requestFilterKey)
				setLoadMoreError("Không thể tải thêm Fact. Hãy thử lại.");
		} finally {
			setIsLoadingMore(false);
		}
	}

	function startCreate() {
		setEditingFact(undefined);
		setDrawerOpen(true);
	}

	function startEdit(fact: ProductFactRecord) {
		setEditingFact(fact);
		setDrawerOpen(true);
	}

	const deleteFact = useMutation(orpc.productFact.delete.mutationOptions());
	function handleDelete(fact: ProductFactRecord) {
		deleteFact.mutate(
			{ id: fact.id },
			{
				onSuccess: async () => {
					toast.success("Đã xóa Product Fact");
					await refreshFacts();
				},
				onError: (error) => toast.error(getFactErrorMessage(error)),
			},
		);
	}

	return (
		<div className="space-y-5">
			<div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="relative w-full sm:max-w-sm">
					<Search
						aria-hidden="true"
						className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						aria-label="Tìm nội dung Product Facts"
						className="pl-9"
						placeholder="Tìm nội dung Fact"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</div>
				<Button onClick={startCreate}>
					<Plus aria-hidden="true" />
					Thêm Fact
				</Button>
			</div>
			<fieldset className="flex flex-wrap gap-2" aria-label="Lọc Product Facts">
				<legend className="sr-only">Lọc Product Facts</legend>
				<Button
					aria-pressed={!type}
					onClick={() => setType("")}
					size="sm"
					variant={!type ? "default" : "outline"}
				>
					Tất cả loại
				</Button>
				{FACT_TYPES.map((item) => (
					<Button
						aria-pressed={type === item}
						key={item}
						onClick={() => setType(item)}
						size="sm"
						variant={type === item ? "default" : "outline"}
					>
						{FACT_TYPE_LABELS[item]}
					</Button>
				))}
				<select
					aria-label="Lọc trạng thái Product Facts"
					className="h-7 rounded-md border border-input bg-background px-2 text-xs"
					value={status}
					onChange={(event) =>
						setStatus(event.target.value as ProductFactStatus | "")
					}
				>
					<option value="">Mọi trạng thái</option>
					{Object.entries(FACT_STATUS_LABELS).map(([key, label]) => (
						<option key={key} value={key}>
							{label}
						</option>
					))}
				</select>
			</fieldset>

			{factsQuery.isPending ? (
				<div
					aria-label="Đang tải Product Facts"
					className="space-y-2"
					role="status"
				>
					{Array.from({ length: 3 }, (_, index) => (
						<Skeleton className="h-24 rounded-xl" key={index} />
					))}
				</div>
			) : null}
			{factsQuery.isError ? (
				<div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-destructive text-sm">
					<p className="font-medium">Không thể tải Product Facts.</p>
					<Button
						className="mt-4"
						onClick={() => void factsQuery.refetch()}
						variant="outline"
					>
						Thử lại
					</Button>
				</div>
			) : null}
			{factsQuery.isSuccess && loadedItems.length === 0 ? (
				<Empty className="rounded-2xl border bg-card py-14">
					<EmptyHeader>
						<EmptyTitle>
							{search || type || status
								? "Không tìm thấy Fact phù hợp"
								: "Chưa có Product Fact"}
						</EmptyTitle>
						<EmptyDescription>
							{search || type || status
								? "Thử đổi từ khóa hoặc xóa bớt bộ lọc."
								: "Thêm Fact đầu tiên để lưu thông tin có thể tái sử dụng cho sản phẩm."}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}
			{loadedItems.length > 0 ? (
				<div className="overflow-hidden rounded-2xl border bg-card">
					<div className="divide-y">
						{loadedItems.map((fact) => (
							<div
								className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between"
								key={fact.id}
							>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<FactStatusBadge status={fact.status} />
										<span className="text-muted-foreground text-xs">
											{FACT_TYPE_LABELS[fact.type]}
										</span>
									</div>
									<p className="mt-2 font-medium text-sm">{fact.content}</p>
									<p className="mt-1 text-muted-foreground text-xs">
										{fact.sourceLabel || fact.sourceUrl || "Chưa có nguồn"}
										{fact.confirmedAt
											? ` · Xác nhận ${formatDate(fact.confirmedAt)}`
											: ""}
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<Button
										aria-label={`Sửa Fact ${fact.content}`}
										onClick={() => startEdit(fact)}
										size="icon"
										variant="ghost"
									>
										<Pencil aria-hidden="true" />
									</Button>
									<FactDeleteDialog
										fact={fact}
										isPending={deleteFact.isPending}
										onDelete={() => handleDelete(fact)}
									/>
								</div>
							</div>
						))}
					</div>
				</div>
			) : null}
			{nextCursor ? (
				<div className="flex flex-col items-center gap-2">
					<Button
						disabled={isLoadingMore}
						onClick={() => void loadMore()}
						variant="outline"
					>
						{isLoadingMore
							? "Đang tải..."
							: loadMoreError
								? "Thử lại"
								: "Tải thêm Fact"}
					</Button>
					{loadMoreError ? (
						<p className="text-destructive text-sm" role="alert">
							{loadMoreError}
						</p>
					) : null}
				</div>
			) : null}
			<FactFormDrawer
				fact={editingFact}
				onOpenChange={(open) => {
					setDrawerOpen(open);
					if (!open) setEditingFact(undefined);
				}}
				onSaved={refreshFacts}
				open={drawerOpen}
				productId={productId}
			/>
		</div>
	);
}
