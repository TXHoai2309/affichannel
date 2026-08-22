"use client";

import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { Search, SlidersHorizontal } from "lucide-react";

import type { ProductArchiveScope, ProductStatus } from "./product-types";

export type ProductFiltersValue = {
	search: string;
	category: string;
	status?: ProductStatus;
	archiveScope: ProductArchiveScope;
};

export function ProductFilters({
	value,
	categories,
	onChange,
}: {
	value: ProductFiltersValue;
	categories: string[];
	onChange: (value: ProductFiltersValue) => void;
}) {
	return (
		<div className="flex flex-col gap-4 rounded-xl border border-affi-blue-border bg-card p-4 sm:flex-row sm:items-end">
			<div className="min-w-0 flex-1 space-y-2">
				<Label htmlFor="product-search">Tìm kiếm</Label>
				<div className="relative">
					<Search
						aria-hidden="true"
						className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						aria-label="Tìm kiếm sản phẩm"
						className="h-10 rounded-lg pl-9"
						id="product-search"
						placeholder="Tìm theo tên sản phẩm..."
						value={value.search}
						onChange={(event) =>
							onChange({ ...value, search: event.target.value })
						}
					/>
				</div>
			</div>

			<div className="space-y-2 sm:w-48">
				<Label htmlFor="product-category">Danh mục</Label>
				<select
					className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
					id="product-category"
					value={value.category}
					onChange={(event) =>
						onChange({ ...value, category: event.target.value })
					}
				>
					<option value="">Tất cả danh mục</option>
					{categories.map((category) => (
						<option key={category} value={category}>
							{category}
						</option>
					))}
				</select>
			</div>

			<div className="space-y-2 sm:w-48">
				<Label htmlFor="product-status">Trạng thái</Label>
				<select
					className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
					id="product-status"
					value={
						value.archiveScope === "archivedOnly"
							? "archived"
							: (value.status ?? "all")
					}
					onChange={(event) => {
						const nextStatus = event.target.value;
						onChange({
							...value,
							status:
								nextStatus === "active" || nextStatus === "inactive"
									? nextStatus
									: undefined,
							archiveScope:
								nextStatus === "archived" ? "archivedOnly" : "activeOnly",
						});
					}}
				>
					<option value="all">Tất cả trạng thái</option>
					<option value="active">Đang hoạt động</option>
					<option value="inactive">Tạm ngưng</option>
					<option value="archived">Đã lưu trữ</option>
				</select>
			</div>

			<div className="hidden items-center gap-2 pb-2 text-muted-foreground text-xs lg:flex">
				<SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
				Bộ lọc tự động áp dụng
			</div>
		</div>
	);
}
