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
	ExternalLink,
	Package,
	Pencil,
	RotateCcw,
	Trash2,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
						variant="ghost"
						size="icon"
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
							? "Sản phẩm chưa được dùng trong dự án nào. Thao tác này không thể hoàn tác."
							: "Sản phẩm đang được tham chiếu bởi dự án. Hãy giữ lại hoặc lưu trữ sản phẩm thay vì xóa."}
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

	if (productQuery.isPending) {
		return <DetailSkeleton />;
	}

	if (productQuery.isError || !productQuery.data) {
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
	}

	const product = productQuery.data as ProductDetails;
	const isArchived = Boolean(product.archivedAt);
	const isActionPending =
		archiveProduct.isPending ||
		restoreProduct.isPending ||
		deleteProduct.isPending;

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
						canDelete={product.usage.referenceCount === 0}
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
						<div className="mt-6 grid gap-4 sm:grid-cols-2">
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
						</div>
					</div>
				</CardContent>
			</Card>

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
						<CardTitle>Dữ liệu mở rộng</CardTitle>
						<CardDescription>
							Facts và media sẽ được nối ở các slice tiếp theo.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 sm:grid-cols-2">
						<div className="rounded-xl border border-dashed p-4">
							<Package className="size-5 text-primary" />
							<p className="mt-3 font-medium">Product Facts</p>
							<p className="mt-1 text-muted-foreground text-xs">
								0 facts · sẽ nối ở US006
							</p>
						</div>
						<div className="rounded-xl border border-dashed p-4">
							<Package className="size-5 text-primary" />
							<p className="mt-3 font-medium">Media</p>
							<p className="mt-1 text-muted-foreground text-xs">
								0 asset · chưa upload trong US005
							</p>
						</div>
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
										variant="outline"
										size="sm"
									>
										Mở dự án
									</Button>
								</div>
							))}
						</div>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
