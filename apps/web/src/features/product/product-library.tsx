import { Button } from "@affichannel/ui/components/button";
import { Plus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { ProductList } from "./product-list";

export function ProductLibrary() {
	return (
		<div className="mx-auto w-full max-w-6xl space-y-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-muted-foreground text-sm italic">
						Lưu và tái sử dụng thông tin sản phẩm cho các dự án affiliate.
					</p>
				</div>
				<Button
					nativeButton={false}
					render={<Link href={"/products/new" as Route} />}
				>
					<Plus aria-hidden="true" />
					Thêm sản phẩm
				</Button>
			</div>
			<ProductList />
		</div>
	);
}
