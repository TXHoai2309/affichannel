"use client";

import {
	factRequiresEvidence,
	hasFactEvidence,
	hasSensitiveFactChanges,
	isValidFactDateRange,
} from "@affichannel/core/product-fact/eligibility";
import type {
	ProductFactRecord,
	ProductFactSourceType,
	ProductFactStatus,
	ProductFactType,
} from "@affichannel/core/product-fact/types";
import { productFactFieldsSchema } from "@affichannel/core/product-fact/validation";
import { Button } from "@affichannel/ui/components/button";
import {
	Drawer,
	DrawerBackdrop,
	DrawerClose,
	DrawerDescription,
	DrawerPopup,
	DrawerPortal,
	DrawerTitle,
	DrawerViewport,
} from "@affichannel/ui/components/drawer";
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { Textarea } from "@affichannel/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import { getFactErrorMessage } from "./fact-errors";
import {
	FACT_SOURCE_LABELS,
	FACT_SOURCE_TYPES,
	FACT_STATUS_LABELS,
	FACT_STATUSES,
	FACT_TYPE_LABELS,
	FACT_TYPES,
} from "./fact-types";

type FactFormValues = {
	content: string;
	type: ProductFactType;
	status: ProductFactStatus;
	sourceType: ProductFactSourceType | "";
	sourceLabel: string;
	sourceUrl: string;
	confirmedAt: string;
	expiresAt: string;
	notes: string;
};

type FieldName = keyof FactFormValues | "form";
type FieldErrors = Partial<Record<FieldName, string>>;

const EMPTY_VALUES: FactFormValues = {
	content: "",
	type: "other",
	status: "draft",
	sourceType: "",
	sourceLabel: "",
	sourceUrl: "",
	confirmedAt: "",
	expiresAt: "",
	notes: "",
};

function toFormValues(fact?: ProductFactRecord): FactFormValues {
	return fact
		? {
				content: fact.content,
				type: fact.type,
				status: fact.status,
				sourceType: fact.sourceType ?? "",
				sourceLabel: fact.sourceLabel ?? "",
				sourceUrl: fact.sourceUrl ?? "",
				confirmedAt: fact.confirmedAt ?? "",
				expiresAt: fact.expiresAt ?? "",
				notes: fact.notes ?? "",
			}
		: EMPTY_VALUES;
}

function fieldId(prefix: string, field: string) {
	return `${prefix}-${field}`;
}

function toComparableFact(values: FactFormValues) {
	return {
		content: values.content.trim(),
		type: values.type,
		sourceType: values.sourceType || null,
		sourceLabel: values.sourceLabel.trim() || null,
		sourceUrl: values.sourceUrl.trim() || null,
		confirmedAt: values.confirmedAt || null,
		expiresAt: values.expiresAt || null,
	};
}

export function FactFormDrawer({
	open,
	onOpenChange,
	productId,
	fact,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	productId: string;
	fact?: ProductFactRecord;
	onSaved: () => Promise<void> | void;
}) {
	const prefix = useId();
	const isEditing = Boolean(fact);
	const [values, setValues] = useState<FactFormValues>(() =>
		toFormValues(fact),
	);
	const [errors, setErrors] = useState<FieldErrors>({});
	const createFact = useMutation(orpc.productFact.create.mutationOptions());
	const updateFact = useMutation(orpc.productFact.update.mutationOptions());
	const historyQuery = useQuery(
		orpc.productFact.listHistory.queryOptions({
			input: { productId, factId: fact?.id, limit: 10 },
			enabled: open && Boolean(fact),
			meta: { suppressGlobalErrorToast: true },
		}),
	);

	useEffect(() => {
		if (open) {
			setValues(toFormValues(fact));
			setErrors({});
		}
	}, [fact, open]);

	function updateField(field: FieldName, value: string) {
		if (field === "form") return;
		setValues((current) => ({ ...current, [field]: value }));
		setErrors((current) => ({
			...current,
			[field]: undefined,
			form: undefined,
		}));
	}

	function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const submitter = (event.nativeEvent as SubmitEvent).submitter;
		const verificationIntent =
			submitter instanceof HTMLButtonElement && submitter.value === "verify"
				? "verify"
				: "preserve";
		const parsed = productFactFieldsSchema.safeParse({
			...values,
			sourceType: values.sourceType || null,
		});
		if (!parsed.success) {
			const nextErrors: FieldErrors = {};
			for (const issue of parsed.error.issues) {
				const field = issue.path[0];
				if (typeof field === "string")
					nextErrors[field as FieldName] = issue.message;
			}
			setErrors(nextErrors);
			return;
		}

		const data = parsed.data;
		const nextErrors: FieldErrors = {};
		if (!isValidFactDateRange(data.confirmedAt, data.expiresAt)) {
			nextErrors.expiresAt = "Ngày hết hạn phải bằng hoặc sau ngày xác nhận.";
		}
		if (
			(!fact ? data.status === "verified" : verificationIntent === "verify") &&
			factRequiresEvidence(data.type) &&
			!hasFactEvidence(data)
		) {
			nextErrors.form =
				"Fact này cần nguồn, nhãn hoặc URL nguồn, và ngày xác nhận trước khi được xác minh.";
		}
		if (Object.keys(nextErrors).length > 0) {
			setErrors(nextErrors);
			return;
		}

		const onSuccess = async () => {
			toast.success(
				isEditing ? "Đã cập nhật Product Fact" : "Đã thêm Product Fact",
			);
			onOpenChange(false);
			await onSaved();
		};
		const onError = (error: unknown) =>
			setErrors({ form: getFactErrorMessage(error) });

		if (fact) {
			updateFact.mutate(
				{ id: fact.id, data, verificationIntent },
				{ onSuccess, onError },
			);
		} else {
			createFact.mutate({ productId, data }, { onSuccess, onError });
		}
	}

	const hasSensitiveEdits = Boolean(
		fact && hasSensitiveFactChanges(fact, toComparableFact(values)),
	);
	const shouldOfferReverify = Boolean(
		fact &&
			values.status === "verified" &&
			(fact.status !== "verified" || hasSensitiveEdits),
	);
	const isPending = createFact.isPending || updateFact.isPending;
	return (
		<Drawer open={open} onOpenChange={onOpenChange}>
			<DrawerPortal>
				<DrawerBackdrop />
				<DrawerViewport>
					<DrawerPopup className="w-[min(34rem,calc(100%-1rem))] overflow-y-auto">
						<div>
							<DrawerTitle>
								{isEditing ? "Chỉnh sửa Fact" : "Thêm Product Fact"}
							</DrawerTitle>
							<DrawerDescription>
								Lưu một thông tin có thể tái sử dụng cho brief và kiểm tra AI.
							</DrawerDescription>
						</div>
						<form className="mt-6 space-y-4" noValidate onSubmit={submit}>
							<div className="space-y-2">
								<Label htmlFor={fieldId(prefix, "content")}>
									Nội dung Fact
								</Label>
								<Textarea
									aria-invalid={Boolean(errors.content)}
									id={fieldId(prefix, "content")}
									maxLength={5000}
									placeholder="Ví dụ: Pin có thời lượng 20 giờ"
									value={values.content}
									onChange={(event) =>
										updateField("content", event.target.value)
									}
								/>
								{errors.content ? (
									<p className="text-destructive text-xs" role="alert">
										{errors.content}
									</p>
								) : null}
							</div>
							<div className="grid gap-4 sm:grid-cols-2">
								<div className="space-y-2">
									<Label htmlFor={fieldId(prefix, "type")}>Loại Fact</Label>
									<select
										className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs"
										id={fieldId(prefix, "type")}
										value={values.type}
										onChange={(event) =>
											updateField("type", event.target.value)
										}
									>
										{FACT_TYPES.map((type) => (
											<option key={type} value={type}>
												{FACT_TYPE_LABELS[type]}
											</option>
										))}
									</select>
								</div>
								<div className="space-y-2">
									<Label htmlFor={fieldId(prefix, "status")}>Trạng thái</Label>
									<select
										className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs"
										id={fieldId(prefix, "status")}
										value={values.status}
										onChange={(event) =>
											updateField("status", event.target.value)
										}
									>
										{FACT_STATUSES.map((status) => (
											<option key={status} value={status}>
												{FACT_STATUS_LABELS[status]}
											</option>
										))}
									</select>
								</div>
							</div>
							<div className="rounded-xl border bg-muted/30 p-4">
								<p className="font-medium text-sm">Nguồn xác minh</p>
								<p className="mt-1 text-muted-foreground text-xs">
									Giá, khuyến mãi và claim cần đủ nguồn cùng ngày xác nhận khi
									chuyển sang Đã xác minh.
								</p>
								<div className="mt-4 grid gap-4 sm:grid-cols-2">
									<div className="space-y-2">
										<Label htmlFor={fieldId(prefix, "sourceType")}>
											Loại nguồn
										</Label>
										<select
											className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs"
											id={fieldId(prefix, "sourceType")}
											value={values.sourceType}
											onChange={(event) =>
												updateField("sourceType", event.target.value)
											}
										>
											<option value="">Chưa chọn</option>
											{FACT_SOURCE_TYPES.map((sourceType) => (
												<option key={sourceType} value={sourceType}>
													{FACT_SOURCE_LABELS[sourceType]}
												</option>
											))}
										</select>
									</div>
									<div className="space-y-2">
										<Label htmlFor={fieldId(prefix, "confirmedAt")}>
											Ngày xác nhận
										</Label>
										<Input
											aria-invalid={Boolean(errors.confirmedAt)}
											id={fieldId(prefix, "confirmedAt")}
											type="date"
											value={values.confirmedAt}
											onChange={(event) =>
												updateField("confirmedAt", event.target.value)
											}
										/>
									</div>
								</div>
								<div className="mt-4 space-y-2">
									<Label htmlFor={fieldId(prefix, "sourceLabel")}>
										Nhãn nguồn
									</Label>
									<Input
										id={fieldId(prefix, "sourceLabel")}
										placeholder="Ví dụ: Website thương hiệu"
										value={values.sourceLabel}
										onChange={(event) =>
											updateField("sourceLabel", event.target.value)
										}
									/>
								</div>
								<div className="mt-4 space-y-2">
									<Label htmlFor={fieldId(prefix, "sourceUrl")}>
										URL nguồn (không bắt buộc nếu có nhãn)
									</Label>
									<Input
										aria-invalid={Boolean(errors.sourceUrl)}
										id={fieldId(prefix, "sourceUrl")}
										placeholder="https://..."
										value={values.sourceUrl}
										onChange={(event) =>
											updateField("sourceUrl", event.target.value)
										}
									/>
								</div>
							</div>
							<div className="grid gap-4 sm:grid-cols-2">
								<div className="space-y-2">
									<Label htmlFor={fieldId(prefix, "expiresAt")}>
										Ngày hết hạn (không bắt buộc)
									</Label>
									<Input
										aria-invalid={Boolean(errors.expiresAt)}
										id={fieldId(prefix, "expiresAt")}
										type="date"
										value={values.expiresAt}
										onChange={(event) =>
											updateField("expiresAt", event.target.value)
										}
									/>
									{errors.expiresAt ? (
										<p className="text-destructive text-xs" role="alert">
											{errors.expiresAt}
										</p>
									) : null}
								</div>
								<div className="space-y-2">
									<Label htmlFor={fieldId(prefix, "notes")}>Ghi chú</Label>
									<Input
										id={fieldId(prefix, "notes")}
										maxLength={2000}
										placeholder="Ghi chú nội bộ"
										value={values.notes}
										onChange={(event) =>
											updateField("notes", event.target.value)
										}
									/>
								</div>
							</div>
							{errors.form ? (
								<p
									className="rounded-lg bg-destructive/10 p-3 text-destructive text-sm"
									role="alert"
								>
									{errors.form}
								</p>
							) : null}
							{fact?.status === "verified" && hasSensitiveEdits ? (
								<p
									className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm"
									role="status"
								>
									Thông tin đã xác minh đã thay đổi. Fact sẽ chuyển về Bản nháp
									khi lưu.
								</p>
							) : null}
							{fact && historyQuery.data?.items.length ? (
								<div className="rounded-xl border bg-muted/20 p-4">
									<p className="font-medium text-sm">
										Lịch sử thay đổi ({historyQuery.data.items.length})
									</p>
									<p className="mt-1 text-muted-foreground text-xs">
										Lần gần nhất:{" "}
										{new Intl.DateTimeFormat("vi-VN", {
											dateStyle: "medium",
											timeStyle: "short",
										}).format(new Date(historyQuery.data.items[0].changedAt))}
									</p>
								</div>
							) : null}
							<div className="flex justify-end gap-2 border-t pt-4">
								<DrawerClose
									render={
										<Button
											disabled={isPending}
											type="button"
											variant="outline"
										/>
									}
								>
									Hủy
								</DrawerClose>
								<Button disabled={isPending} type="submit" value="preserve">
									{isPending
										? "Đang lưu..."
										: isEditing
											? "Lưu thay đổi"
											: "Thêm Fact"}
								</Button>
								{shouldOfferReverify ? (
									<Button
										disabled={isPending}
										type="submit"
										value="verify"
										variant="outline"
									>
										Xác minh lại &amp; Lưu
									</Button>
								) : null}
							</div>
						</form>
					</DrawerPopup>
				</DrawerViewport>
			</DrawerPortal>
		</Drawer>
	);
}
