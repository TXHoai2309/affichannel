"use client";

import {
	type ProductStatus,
	productFieldsSchema,
} from "@affichannel/core/product/validation";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { Skeleton } from "@affichannel/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { orpc } from "@/utils/orpc";

import { getProductErrorMessage } from "./product-errors";

type ProductFormValues = {
	name: string;
	category: string;
	priceAmount: string;
	thumbnailUrl: string;
	sourceUrl: string;
	affiliateUrl: string;
	status: ProductStatus;
};

type ProductField = keyof ProductFormValues;
type ProductFieldErrors = Partial<Record<ProductField | "form", string>>;

const INITIAL_VALUES: ProductFormValues = {
	name: "",
	category: "",
	priceAmount: "",
	thumbnailUrl: "",
	sourceUrl: "",
	affiliateUrl: "",
	status: "active",
};

function toFormValues(product: {
	name: string;
	category: string | null;
	priceAmount: number | null;
	thumbnailUrl: string | null;
	sourceUrl: string | null;
	affiliateUrl: string | null;
	status: string;
}): ProductFormValues {
	return {
		name: product.name,
		category: product.category ?? "",
		priceAmount:
			product.priceAmount === null ? "" : String(product.priceAmount),
		thumbnailUrl: product.thumbnailUrl ?? "",
		sourceUrl: product.sourceUrl ?? "",
		affiliateUrl: product.affiliateUrl ?? "",
		status: product.status === "inactive" ? "inactive" : "active",
	};
}

function parseProductForm(values: ProductFormValues) {
	const parsed = productFieldsSchema.safeParse({
		name: values.name,
		category: values.category,
		status: values.status,
		thumbnailUrl: values.thumbnailUrl,
		sourceUrl: values.sourceUrl,
		affiliateUrl: values.affiliateUrl,
		priceAmount:
			values.priceAmount.trim() === "" ? null : Number(values.priceAmount),
		currency: "VND",
	});

	if (parsed.success) {
		return { success: true as const, data: parsed.data };
	}

	const errors: ProductFieldErrors = {};
	for (const issue of parsed.error.issues) {
		const field = issue.path[0];
		if (typeof field === "string" && field in INITIAL_VALUES) {
			errors[field as ProductField] = issue.message;
		}
	}

	return { success: false as const, errors };
}

function FieldError({ id, message }: { id: string; message?: string }) {
	return message ? (
		<p className="text-destructive text-xs" id={id} role="alert">
			{message}
		</p>
	) : null;
}

export function ProductForm({ productId }: { productId?: string }) {
	const router = useRouter();
	const isEditing = Boolean(productId);
	const productQuery = useQuery(
		orpc.product.get.queryOptions({
			input: { id: productId as string },
			enabled: isEditing,
			meta: { suppressGlobalErrorToast: true },
		}),
	);
	const createProduct = useMutation(orpc.product.create.mutationOptions());
	const updateProduct = useMutation(orpc.product.update.mutationOptions());
	const [values, setValues] = useState<ProductFormValues>(INITIAL_VALUES);
	const [errors, setErrors] = useState<ProductFieldErrors>({});

	useEffect(() => {
		if (productQuery.data) {
			setValues(toFormValues(productQuery.data));
		}
	}, [productQuery.data]);

	function updateField(field: ProductField, value: string) {
		setValues((current) => ({
			...current,
			[field]: value,
		}));
		setErrors((current) => ({
			...current,
			[field]: undefined,
			form: undefined,
		}));
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const parsed = parseProductForm(values);

		if (!parsed.success) {
			setErrors(parsed.errors);
			return;
		}

		const input = parsed.data;
		const onSuccess = (product: { id: string }) => {
			void router.push(`/products/${product.id}` as Route);
			router.refresh();
		};
		const onError = (error: unknown) => {
			setErrors({
				form: getProductErrorMessage(
					error,
					isEditing
						? "Không thể cập nhật sản phẩm. Hãy thử lại."
						: "Không thể tạo sản phẩm. Hãy thử lại.",
				),
			});
		};

		if (productId) {
			updateProduct.mutate(
				{ id: productId, data: input },
				{ onSuccess, onError },
			);
		} else {
			createProduct.mutate(input, { onSuccess, onError });
		}
	}

	if (isEditing && productQuery.isPending) {
		return <Skeleton className="h-[520px] rounded-2xl" />;
	}

	if (isEditing && (productQuery.isError || !productQuery.data)) {
		return (
			<div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-destructive text-sm">
				Không thể tải sản phẩm để chỉnh sửa.
			</div>
		);
	}

	const isSubmitting = createProduct.isPending || updateProduct.isPending;

	return (
		<Card className="mx-auto w-full max-w-3xl rounded-2xl">
			<CardHeader>
				<CardTitle>
					{isEditing ? "Chỉnh sửa sản phẩm" : "Thêm sản phẩm"}
				</CardTitle>
				<p className="text-muted-foreground text-sm">
					Lưu thông tin nền tảng để dùng lại trong nhiều dự án affiliate.
				</p>
			</CardHeader>
			<CardContent>
				<form className="space-y-6" noValidate onSubmit={submit}>
					<div className="grid gap-5 md:grid-cols-2">
						<div className="space-y-2 md:col-span-2">
							<Label htmlFor="product-name">Tên sản phẩm</Label>
							<Input
								aria-describedby={
									errors.name ? "product-name-error" : undefined
								}
								aria-invalid={Boolean(errors.name)}
								disabled={isSubmitting}
								id="product-name"
								maxLength={160}
								placeholder="Ví dụ: Tai nghe Bluetooth X1"
								value={values.name}
								onChange={(event) => updateField("name", event.target.value)}
							/>
							<FieldError id="product-name-error" message={errors.name} />
						</div>

						<div className="space-y-2">
							<Label htmlFor="product-category">Danh mục</Label>
							<Input
								disabled={isSubmitting}
								id="product-category"
								maxLength={80}
								placeholder="Ví dụ: Điện tử"
								value={values.category}
								onChange={(event) =>
									updateField("category", event.target.value)
								}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="product-price">Giá tham khảo (VND)</Label>
							<Input
								aria-describedby={
									errors.priceAmount ? "product-price-error" : undefined
								}
								aria-invalid={Boolean(errors.priceAmount)}
								disabled={isSubmitting}
								id="product-price"
								inputMode="numeric"
								min={0}
								placeholder="Để trống nếu chưa có"
								type="number"
								value={values.priceAmount}
								onChange={(event) =>
									updateField("priceAmount", event.target.value)
								}
							/>
							<FieldError
								id="product-price-error"
								message={errors.priceAmount}
							/>
						</div>

						<div className="space-y-2 md:col-span-2">
							<Label htmlFor="product-thumbnail">
								Ảnh đại diện (HTTPS, không bắt buộc)
							</Label>
							<Input
								aria-describedby={
									errors.thumbnailUrl ? "product-thumbnail-error" : undefined
								}
								aria-invalid={Boolean(errors.thumbnailUrl)}
								disabled={isSubmitting}
								id="product-thumbnail"
								placeholder="https://..."
								value={values.thumbnailUrl}
								onChange={(event) =>
									updateField("thumbnailUrl", event.target.value)
								}
							/>
							<FieldError
								id="product-thumbnail-error"
								message={errors.thumbnailUrl}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="product-source-url">Nguồn sản phẩm</Label>
							<Input
								aria-describedby={
									errors.sourceUrl ? "product-source-error" : undefined
								}
								aria-invalid={Boolean(errors.sourceUrl)}
								disabled={isSubmitting}
								id="product-source-url"
								placeholder="https://..."
								value={values.sourceUrl}
								onChange={(event) =>
									updateField("sourceUrl", event.target.value)
								}
							/>
							<FieldError
								id="product-source-error"
								message={errors.sourceUrl}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="product-affiliate-url">Link affiliate</Label>
							<Input
								aria-describedby={
									errors.affiliateUrl ? "product-affiliate-error" : undefined
								}
								aria-invalid={Boolean(errors.affiliateUrl)}
								disabled={isSubmitting}
								id="product-affiliate-url"
								placeholder="https://..."
								value={values.affiliateUrl}
								onChange={(event) =>
									updateField("affiliateUrl", event.target.value)
								}
							/>
							<FieldError
								id="product-affiliate-error"
								message={errors.affiliateUrl}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="product-status-field">Trạng thái</Label>
							<select
								className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
								disabled={isSubmitting}
								id="product-status-field"
								value={values.status}
								onChange={(event) =>
									updateField("status", event.target.value as ProductStatus)
								}
							>
								<option value="active">Đang hoạt động</option>
								<option value="inactive">Tạm ngưng</option>
							</select>
						</div>
					</div>

					{errors.form ? (
						<p
							className="rounded-lg bg-destructive/5 p-3 text-destructive text-sm"
							role="alert"
						>
							{errors.form}
						</p>
					) : null}

					<div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
						<Button
							disabled={isSubmitting}
							nativeButton={false}
							render={
								<Link
									href={
										(productId
											? `/products/${productId}`
											: "/products") as Route
									}
								/>
							}
							variant="outline"
						>
							Hủy
						</Button>
						<Button disabled={isSubmitting} type="submit">
							{isSubmitting
								? "Đang lưu..."
								: isEditing
									? "Lưu thay đổi"
									: "Lưu sản phẩm"}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
