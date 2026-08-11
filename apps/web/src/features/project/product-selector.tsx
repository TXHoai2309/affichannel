"use client";

import { Button } from "@affichannel/ui/components/button";
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { useState } from "react";

export type ProductOption = {
	id: string;
	name: string;
	category: string | null;
};

export function ProductSelector({
	value,
	products,
	disabled,
	error,
	onChange,
	onCreate,
}: {
	value: string;
	products: ProductOption[];
	disabled?: boolean;
	error?: string;
	onChange: (productId: string) => void;
	onCreate: (name: string) => Promise<void>;
}) {
	const [isCreating, setIsCreating] = useState(false);
	const [newProductName, setNewProductName] = useState("");
	const [createError, setCreateError] = useState<string>();
	const [isSubmitting, setIsSubmitting] = useState(false);

	async function submitNewProduct() {
		const name = newProductName.trim();

		if (!name) {
			setCreateError("Nhập tên sản phẩm trước khi tạo.");
			return;
		}

		setCreateError(undefined);
		setIsSubmitting(true);

		try {
			await onCreate(name);
			setNewProductName("");
			setIsCreating(false);
		} catch (creationError) {
			setCreateError(
				creationError instanceof Error
					? creationError.message
					: "Không thể tạo sản phẩm.",
			);
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-3">
				<Label htmlFor="productId">Sản phẩm</Label>
				<Button
					disabled={disabled || isSubmitting}
					size="xs"
					type="button"
					variant="ghost"
					onClick={() => setIsCreating((current) => !current)}
				>
					{isCreating ? "Chọn từ danh sách" : "Tạo sản phẩm"}
				</Button>
			</div>

			{isCreating ? (
				<div className="flex gap-2">
					<Input
						disabled={disabled || isSubmitting}
						id="newProductName"
						maxLength={160}
						placeholder="Ví dụ: Tai nghe Bluetooth X1"
						value={newProductName}
						onChange={(event) => setNewProductName(event.target.value)}
					/>
					<Button
						disabled={disabled || isSubmitting}
						type="button"
						variant="outline"
						onClick={submitNewProduct}
					>
						{isSubmitting ? "Đang tạo…" : "Tạo"}
					</Button>
				</div>
			) : (
				<select
					aria-describedby={error ? "productId-error" : undefined}
					aria-invalid={Boolean(error)}
					className="h-8 w-full border border-input bg-transparent px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
					disabled={disabled}
					id="productId"
					value={value}
					onChange={(event) => onChange(event.target.value)}
				>
					<option value="">Chọn sản phẩm</option>
					{products.map((product) => (
						<option key={product.id} value={product.id}>
							{product.name}
							{product.category ? ` · ${product.category}` : ""}
						</option>
					))}
				</select>
			)}

			{error ? (
				<p className="text-destructive text-xs" id="productId-error">
					{error}
				</p>
			) : null}
			{createError ? (
				<p className="text-destructive text-xs">{createError}</p>
			) : null}
		</div>
	);
}
