"use client";

import { Button } from "@affichannel/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@affichannel/ui/components/empty";
import { Skeleton } from "@affichannel/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";

import { orpc } from "@/utils/orpc";

import { ProductCard } from "./product-card";
import { ProductFilters, type ProductFiltersValue } from "./product-filters";

const INITIAL_FILTERS: ProductFiltersValue = {
	search: "",
	category: "",
	archiveScope: "activeOnly",
};

function ProductListSkeleton() {
	return (
		<div
			aria-label="Đang tải danh sách sản phẩm"
			className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
			role="status"
		>
			{Array.from({ length: 6 }, (_, index) => (
				<Skeleton className="h-64 rounded-xl" key={index} />
			))}
		</div>
	);
}

export function ProductList() {
	const [filters, setFilters] = useState(INITIAL_FILTERS);
	const deferredSearch = useDeferredValue(filters.search.trim());
	const products = useQuery(
		orpc.product.list.queryOptions({
			input: {
				search: deferredSearch || undefined,
				category: filters.category || undefined,
				status: filters.status,
				archiveScope: filters.archiveScope,
				limit: 50,
			},
			meta: { suppressGlobalErrorToast: true },
			staleTime: 15_000,
		}),
	);

	const items = products.data?.items ?? [];
	const categories = useMemo(() => {
		const values = new Set(
			items.flatMap((product) => (product.category ? [product.category] : [])),
		);
		if (filters.category) {
			values.add(filters.category);
		}
		return Array.from(values).sort((left, right) =>
			left.localeCompare(right, "vi"),
		);
	}, [filters.category, items]);

	return (
		<div className="space-y-5">
			<ProductFilters
				categories={categories}
				value={filters}
				onChange={setFilters}
			/>

			{products.isPending ? <ProductListSkeleton /> : null}

			{products.isError ? (
				<div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-destructive text-sm">
					<p className="font-medium">Không thể tải danh sách sản phẩm.</p>
					<p className="mt-1 text-destructive/80">
						Hãy thử lại để lấy dữ liệu mới nhất.
					</p>
					<Button
						className="mt-4 border-destructive/30 text-destructive hover:bg-destructive/10"
						onClick={() => void products.refetch()}
						variant="outline"
					>
						Thử lại
					</Button>
				</div>
			) : null}

			{products.isSuccess && items.length === 0 ? (
				<Empty className="rounded-xl border bg-card py-14">
					<EmptyHeader>
						<EmptyTitle>
							{filters.search || filters.category || filters.status
								? "Không tìm thấy sản phẩm phù hợp"
								: "Chưa có sản phẩm nào"}
						</EmptyTitle>
						<EmptyDescription>
							{filters.search || filters.category || filters.status
								? "Thử đổi từ khóa hoặc xóa bớt bộ lọc."
								: "Thêm sản phẩm đầu tiên để tái sử dụng trong các dự án affiliate."}
						</EmptyDescription>
					</EmptyHeader>
					{filters.search || filters.category || filters.status ? (
						<EmptyContent>
							<Button
								onClick={() => setFilters(INITIAL_FILTERS)}
								variant="outline"
							>
								Xóa bộ lọc
							</Button>
						</EmptyContent>
					) : null}
				</Empty>
			) : null}

			{products.isSuccess && items.length > 0 ? (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{items.map((product) => (
						<ProductCard key={product.id} product={product} />
					))}
				</div>
			) : null}
		</div>
	);
}
