"use client";

import { getProjectStepRoute } from "@affichannel/core/project/project-types";
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
	DialogTrigger,
} from "@affichannel/ui/components/dialog";
import { Skeleton } from "@affichannel/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	Archive,
	ArrowLeft,
	ClipboardList,
	ExternalLink,
	Pencil,
	RotateCcw,
	Trash2,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { FactList } from "@/features/product-facts/fact-list";
import { orpc } from "@/utils/orpc";

import { getProductErrorMessage } from "./product-errors";
import { ProductStatusBadge } from "./product-status-badge";
import { ProductThumbnail } from "./product-thumbnail";
import type { ProductDetails } from "./product-types";

const PRICE_FORMATTER = new Intl.NumberFormat("vi-VN", {
	style: "currency",
	currency: "VND",
	maximumFractionDigits: 0,
});

function formatPrice(priceAmount: number | null) {
	return priceAmount === null
		? "Chưa khai báo giá"
		: PRICE_FORMATTER.format(priceAmount);
}

function formatDate(value: string | Date) {
	return new Intl.DateTimeFormat("vi-VN", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function DetailSkeleton() {
	return (
		<div className="mx-auto w-full max-w-6xl space-y-5">
			<Skeleton className="h-8 w-32 rounded-lg" />
			<Skeleton className="h-64 rounded-2xl" />
			<div className="grid gap-5 lg:grid-cols-2">
				<Skeleton className="h-56 rounded-2xl" />
				<Skeleton className="h-56 rounded-2xl" />
			</div>
		</div>
	);
}

function ProductLinks({ product }: { product: ProductDetails }) {
	const links = [
		{ label: "Nguồn sản phẩm", value: product.sourceUrl },
		{ label: "Link affiliate", value: product.affiliateUrl },
	];
	return (
		<div className="space-y-3">
			{links.map((link) => (
				<div
					className="flex items-center justify-between gap-4"
					key={link.label}
				>
					<span className="text-muted-foreground">{link.label}</span>
					{link.value ? (
						<a
							className="inline-flex max-w-[65%] items-center gap-1 truncate text-primary hover:underline"
							href={link.value}
							rel="noreferrer"
							target="_blank"
						>
							<span className="truncate">{link.value}</span>
							<ExternalLink aria-hidden="true" className="size-3 shrink-0" />
						</a>
					) : (
						<span className="text-muted-foreground">Chưa khai báo</span>
					)}
				</div>
			))}
		</div>
	);
}

function DeleteProductDialog({
	open,
	onOpenChange,
	onDelete,
	isPending,
	canDelete,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDelete: () => void;
	isPending: boolean;
	canDelete: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger
				render={
					<Button
						aria-label="Xóa sản phẩm"
						className="text-destructive hover:bg-destructive/10"
						size="icon"
						variant="ghost"
					/>
				}
			>
				<Trash2 aria-hidden="true" />
			</DialogTrigger>
			<DialogPortal>
				<DialogBackdrop />
				<DialogPopup>
					<DialogTitle>Xóa sản phẩm?</DialogTitle>
					<DialogDescription>
						{canDelete
							? "Sản phẩm chưa có dự án, Fact hoặc lịch sử Fact liên quan. Thao tác này không thể hoàn tác."
							: "Sản phẩm đang có dữ liệu liên quan. Hãy lưu trữ sản phẩm thay vì xóa."}
					</DialogDescription>
					<div className="mt-6 flex justify-end gap-2">
						<DialogClose render={<Button variant="outline" />}>Hủy</DialogClose>
						{canDelete ? (
							<Button
								disabled={isPending}
								onClick={onDelete}
								variant="destructive"
							>
								{isPending ? "Đang xóa..." : "Xóa sản phẩm"}
							</Button>
						) : null}
					</div>
				</DialogPopup>
			</DialogPortal>
		</Dialog>
	);
}

export function ProductDetail({ productId }: { productId: string }) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [deleteOpen, setDeleteOpen] = useState(false);
	const productQuery = useQuery(
		orpc.product.get.queryOptions({
			input: { id: productId },
			meta: { suppressGlobalErrorToast: true },
		}),
	);
	const archiveProduct = useMutation(orpc.product.archive.mutationOptions());
	const restoreProduct = useMutation(orpc.product.restore.mutationOptions());
	const deleteProduct = useMutation(orpc.product.delete.mutationOptions());

	if (productQuery.isPending) return <DetailSkeleton />;
	if (productQuery.isError || !productQuery.data)
		return (
			<div className="mx-auto w-full max-w-3xl rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-destructive">
				<h1 className="font-semibold text-lg">Không thể tải sản phẩm</h1>
				<p className="mt-2 text-sm">
					Sản phẩm không tồn tại hoặc bạn không có quyền truy cập.
				</p>
				<Button
					className="mt-5"
					onClick={() => void productQuery.refetch()}
					variant="outline"
				>
					Thử lại
				</Button>
			</div>
		);

	const product = productQuery.data as ProductDetails;
	const isArchived = Boolean(product.archivedAt);
	const activeTab = searchParams.get("tab") === "facts" ? "facts" : "overview";
	const isActionPending =
		archiveProduct.isPending ||
		restoreProduct.isPending ||
		deleteProduct.isPending;
	const canDelete =
		product.usage.referenceCount === 0 &&
		product.usage.factCount === 0 &&
		product.usage.factHistoryCount === 0;

	function selectTab(tab: "overview" | "facts") {
		void router.push(
			tab === "facts"
				? `/products/${product.id}?tab=facts`
				: `/products/${product.id}`,
			{ scroll: false },
		);
	}

	function onArchive() {
		archiveProduct.mutate(
			{ id: product.id },
			{
				onSuccess: async () => {
					toast.success("Đã lưu trữ sản phẩm");
					await productQuery.refetch();
				},
				onError: (error) =>
					toast.error(
						getProductErrorMessage(error, "Không thể lưu trữ sản phẩm."),
					),
			},
		);
	}
	function onRestore() {
		restoreProduct.mutate(
			{ id: product.id },
			{
				onSuccess: async () => {
					toast.success("Đã khôi phục sản phẩm");
					await productQuery.refetch();
				},
				onError: (error) =>
					toast.error(
						getProductErrorMessage(error, "Không thể khôi phục sản phẩm."),
					),
			},
		);
	}
	function onDelete() {
		deleteProduct.mutate(
			{ id: product.id },
			{
				onSuccess: () => {
					toast.success("Đã xóa sản phẩm");
					void router.push("/products" as Route);
				},
				onError: (error) => {
					setDeleteOpen(false);
					toast.error(getProductErrorMessage(error, "Không thể xóa sản phẩm."));
				},
			},
		);
	}

	return (
		<div className="mx-auto w-full max-w-6xl space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Button
					nativeButton={false}
					render={<Link href="/products" />}
					variant="ghost"
				>
					<ArrowLeft aria-hidden="true" />
					Thư viện sản phẩm
				</Button>
				<div className="flex items-center gap-2">
					<Button
						disabled={isActionPending}
						nativeButton={false}
						render={<Link href={`/products/${product.id}/edit` as Route} />}
						variant="outline"
					>
						<Pencil aria-hidden="true" />
						Chỉnh sửa
					</Button>
					{isArchived ? (
						<Button
							disabled={isActionPending}
							onClick={onRestore}
							variant="outline"
						>
							<RotateCcw aria-hidden="true" />
							Khôi phục
						</Button>
					) : (
						<Button
							disabled={isActionPending}
							onClick={onArchive}
							variant="outline"
						>
							<Archive aria-hidden="true" />
							Lưu trữ
						</Button>
					)}
					<DeleteProductDialog
						canDelete={canDelete}
						isPending={deleteProduct.isPending}
						onDelete={onDelete}
						onOpenChange={setDeleteOpen}
						open={deleteOpen}
					/>
				</div>
			</div>
			<Card className="rounded-2xl">
				<CardContent className="grid gap-6 p-6 md:grid-cols-[220px_1fr] md:p-8">
					<ProductThumbnail
						className="h-52 w-full rounded-2xl md:h-full"
						name={product.name}
						thumbnailUrl={product.thumbnailUrl}
					/>
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<ProductStatusBadge product={product} />
							{product.category ? (
								<span className="text-muted-foreground text-sm">
									{product.category}
								</span>
							) : null}
						</div>
						<h1 className="mt-3 font-semibold text-2xl tracking-tight">
							{product.name}
						</h1>
						<p className="mt-2 text-muted-foreground text-sm">
							Cập nhật lần cuối {formatDate(product.updatedAt)}
						</p>
						<div className="mt-6 grid gap-4 sm:grid-cols-3">
							<div className="rounded-xl bg-muted/40 p-4">
								<p className="text-muted-foreground text-xs">Giá tham khảo</p>
								<p className="mt-1 font-semibold text-base">
									{formatPrice(product.priceAmount)}
								</p>
							</div>
							<div className="rounded-xl bg-muted/40 p-4">
								<p className="text-muted-foreground text-xs">
									Dự án đang tham chiếu
								</p>
								<p className="mt-1 font-semibold text-base">
									{product.usage.referenceCount}
								</p>
							</div>
							<button
								className="rounded-xl bg-muted/40 p-4 text-left transition-colors hover:bg-muted"
								onClick={() => selectTab("facts")}
								type="button"
							>
								<p className="text-muted-foreground text-xs">Product Facts</p>
								<p className="mt-1 font-semibold text-base">
									{product.usage.factCount}
								</p>
								<p className="mt-1 text-muted-foreground text-xs">
									{product.usage.verifiedFactCount} đã xác minh
								</p>
							</button>
						</div>
					</div>
				</CardContent>
			</Card>
			<div
				className="flex gap-1 border-b"
				role="tablist"
				aria-label="Chi tiết sản phẩm"
			>
				<button
					aria-selected={activeTab === "overview"}
					className={`border-b-2 px-4 py-2 font-medium text-sm transition-colors ${activeTab === "overview" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
					onClick={() => selectTab("overview")}
					role="tab"
					type="button"
				>
					Tổng quan
				</button>
				<button
					aria-selected={activeTab === "facts"}
					className={`border-b-2 px-4 py-2 font-medium text-sm transition-colors ${activeTab === "facts" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
					onClick={() => selectTab("facts")}
					role="tab"
					type="button"
				>
					Product Facts{" "}
					<span className="ml-1 text-muted-foreground">
						({product.usage.factCount})
					</span>
				</button>
			</div>
			{activeTab === "facts" ? (
				<FactList
					onChanged={async () => {
						await productQuery.refetch();
					}}
					productId={product.id}
				/>
			) : (
				<>
					<div className="grid gap-5 lg:grid-cols-2">
						<Card className="rounded-2xl">
							<CardHeader>
								<CardTitle>Thông tin nguồn</CardTitle>
								<CardDescription>
									Liên kết được lưu để tái sử dụng khi làm brief.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<ProductLinks product={product} />
							</CardContent>
						</Card>
						<Card className="rounded-2xl">
							<CardHeader>
								<CardTitle>Product Facts</CardTitle>
								<CardDescription>
									Dữ liệu có thể kiểm tra và tái sử dụng trong nội dung.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<button
									className="flex w-full items-center gap-4 rounded-xl border border-dashed p-4 text-left transition-colors hover:bg-muted/50"
									onClick={() => selectTab("facts")}
									type="button"
								>
									<ClipboardList className="size-5 text-primary" />
									<span>
										<span className="block font-medium">
											{product.usage.factCount} Fact đã lưu
										</span>
										<span className="mt-1 block text-muted-foreground text-xs">
											{product.usage.verifiedFactCount} đã xác minh ·{" "}
											{product.usage.draftFactCount} bản nháp
										</span>
									</span>
								</button>
							</CardContent>
						</Card>
					</div>
					<Card className="rounded-2xl">
						<CardHeader>
							<CardTitle>Dự án liên quan</CardTitle>
							<CardDescription>
								{product.usage.referenceCount === 0
									? "Chưa có dự án nào sử dụng sản phẩm này."
									: `${product.usage.referenceCount} dự án đang giữ liên kết với sản phẩm này.`}
							</CardDescription>
						</CardHeader>
						<CardContent>
							{product.usage.projects.length > 0 ? (
								<div className="divide-y rounded-xl border">
									{product.usage.projects.map((project) => (
										<div
											className="flex flex-wrap items-center justify-between gap-3 p-4"
											key={project.id}
										>
											<div className="min-w-0">
												<p className="truncate font-medium">{project.name}</p>
												{project.archivedAt ? (
													<p className="mt-1 text-muted-foreground text-xs">
														Dự án đã lưu trữ
													</p>
												) : null}
											</div>
											<Button
												nativeButton={false}
												render={
													<Link
														href={
															getProjectStepRoute(
																project.id,
																project.currentStepKey,
															) as Route
														}
													/>
												}
												size="sm"
												variant="outline"
											>
												Mở dự án
											</Button>
										</div>
									))}
								</div>
							) : null}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	);
}
