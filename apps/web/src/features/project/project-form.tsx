"use client";

import {
	type CreateProjectInput,
	createProjectInputSchema,
} from "@affichannel/core/project/project-validation";
import { Button } from "@affichannel/ui/components/button";
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { Textarea } from "@affichannel/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { orpc } from "@/utils/orpc";

import { navigateAfterProjectCreate } from "../project-navigation/project-entry-presentation";
import { ProductSelector } from "./product-selector";
import { getProjectErrorMessage } from "./project-errors";

type ProjectFormValues = {
	name: string;
	productId: string;
	goal: string;
	durationSeconds: string;
	angle: string;
	description: string;
};

const INITIAL_VALUES: ProjectFormValues = {
	name: "",
	productId: "",
	goal: "",
	durationSeconds: "30",
	angle: "",
	description: "",
};

type FieldName = keyof ProjectFormValues;
type FieldErrors = Partial<Record<FieldName | "form", string>>;

const FIELD_ERROR_FALLBACKS: Partial<Record<FieldName, string>> = {
	name: "Tên dự án là bắt buộc.",
	productId: "Chọn hoặc tạo một sản phẩm.",
	goal: "Mục tiêu là bắt buộc.",
	durationSeconds: "Thời lượng cần nằm trong khoảng 15–180 giây.",
	angle: "Góc tiếp cận là bắt buộc.",
};

function parseProjectForm(values: ProjectFormValues) {
	const result = createProjectInputSchema.safeParse({
		name: values.name,
		productId: values.productId,
		platform: "tiktok",
		goal: values.goal,
		durationSeconds: Number(values.durationSeconds),
		angle: values.angle,
		description: values.description.trim() || undefined,
	});

	if (result.success) {
		return { data: result.data as CreateProjectInput, errors: {} };
	}

	const errors: FieldErrors = {};
	for (const issue of result.error.issues) {
		const field = issue.path[0];
		if (typeof field !== "string" || !(field in FIELD_ERROR_FALLBACKS)) {
			continue;
		}

		const fieldName = field as FieldName;
		const fallback = FIELD_ERROR_FALLBACKS[fieldName];
		if (fallback) {
			errors[fieldName] = issue.message.startsWith("Invalid input")
				? fallback
				: issue.message;
		}
	}

	return { errors };
}

export function ProjectForm() {
	const router = useRouter();
	const [values, setValues] = useState<ProjectFormValues>(INITIAL_VALUES);
	const [errors, setErrors] = useState<FieldErrors>({});
	const products = useQuery(
		orpc.product.listMinimal.queryOptions({
			input: { selectableOnly: true },
		}),
	);
	const createProduct = useMutation(
		orpc.product.createMinimal.mutationOptions(),
	);
	const createProject = useMutation(orpc.project.create.mutationOptions());

	function updateField(field: FieldName, value: string) {
		setValues((current) => ({ ...current, [field]: value }));
		setErrors((current) => ({
			...current,
			[field]: undefined,
			form: undefined,
		}));
	}

	async function createProductFromSelector(name: string) {
		const product = await createProduct.mutateAsync({ name });
		updateField("productId", product.id);
		await products.refetch();
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const parsed = parseProjectForm(values);

		if (!parsed.data) {
			setErrors(parsed.errors);
			return;
		}

		createProject.mutate(parsed.data, {
			onSuccess: (project) => {
				navigateAfterProjectCreate(router, project);
			},
			onError: (error) => {
				setErrors({
					form: getProjectErrorMessage(
						error,
						"Không thể tạo dự án. Hãy thử lại.",
					),
				});
			},
		});
	}

	const isSubmitting = createProject.isPending || createProduct.isPending;
	const productOptions = products.data ?? [];

	return (
		<form className="space-y-6" noValidate onSubmit={submit}>
			<div className="grid gap-5 md:grid-cols-2">
				<div className="space-y-2 md:col-span-2">
					<Label htmlFor="name">Tên dự án</Label>
					<Input
						aria-describedby={errors.name ? "name-error" : undefined}
						aria-invalid={Boolean(errors.name)}
						disabled={isSubmitting}
						id="name"
						maxLength={160}
						placeholder="Ví dụ: Video review Tai nghe X1"
						value={values.name}
						onChange={(event) => updateField("name", event.target.value)}
					/>
					{errors.name ? (
						<p className="text-destructive text-xs" id="name-error">
							{errors.name}
						</p>
					) : null}
				</div>

				<ProductSelector
					disabled={isSubmitting || products.isLoading}
					error={errors.productId}
					products={productOptions}
					value={values.productId}
					onChange={(productId) => updateField("productId", productId)}
					onCreate={createProductFromSelector}
				/>

				<div className="space-y-2">
					<Label htmlFor="platform">Nền tảng</Label>
					<Input disabled id="platform" value="TikTok" />
					<p className="text-muted-foreground text-xs">
						MVP hiện hỗ trợ một nền tảng để giữ brief nhất quán.
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="goal">Mục tiêu</Label>
					<Input
						aria-describedby={errors.goal ? "goal-error" : undefined}
						aria-invalid={Boolean(errors.goal)}
						disabled={isSubmitting}
						id="goal"
						maxLength={240}
						placeholder="Ví dụ: Tạo đơn hàng qua link affiliate"
						value={values.goal}
						onChange={(event) => updateField("goal", event.target.value)}
					/>
					{errors.goal ? (
						<p className="text-destructive text-xs" id="goal-error">
							{errors.goal}
						</p>
					) : null}
				</div>

				<div className="space-y-2">
					<Label htmlFor="durationSeconds">Thời lượng (giây)</Label>
					<Input
						aria-describedby={
							errors.durationSeconds ? "durationSeconds-error" : undefined
						}
						aria-invalid={Boolean(errors.durationSeconds)}
						disabled={isSubmitting}
						id="durationSeconds"
						max={180}
						min={15}
						step={1}
						type="number"
						value={values.durationSeconds}
						onChange={(event) =>
							updateField("durationSeconds", event.target.value)
						}
					/>
					{errors.durationSeconds ? (
						<p className="text-destructive text-xs" id="durationSeconds-error">
							{errors.durationSeconds}
						</p>
					) : null}
				</div>

				<div className="space-y-2 md:col-span-2">
					<Label htmlFor="angle">Góc tiếp cận</Label>
					<Input
						aria-describedby={errors.angle ? "angle-error" : undefined}
						aria-invalid={Boolean(errors.angle)}
						disabled={isSubmitting}
						id="angle"
						maxLength={240}
						placeholder="Ví dụ: So sánh trải nghiệm trước và sau khi dùng"
						value={values.angle}
						onChange={(event) => updateField("angle", event.target.value)}
					/>
					{errors.angle ? (
						<p className="text-destructive text-xs" id="angle-error">
							{errors.angle}
						</p>
					) : null}
				</div>

				<div className="space-y-2 md:col-span-2">
					<Label htmlFor="description">
						Mô tả thêm{" "}
						<span className="text-muted-foreground">(không bắt buộc)</span>
					</Label>
					<Textarea
						disabled={isSubmitting}
						id="description"
						maxLength={2000}
						placeholder="Bối cảnh, lưu ý về claim hoặc yêu cầu sáng tạo…"
						value={values.description}
						onChange={(event) => updateField("description", event.target.value)}
					/>
				</div>
			</div>

			{products.isError ? (
				<p className="text-destructive text-sm">
					{getProjectErrorMessage(
						products.error,
						"Không thể tải danh sách sản phẩm.",
					)}
				</p>
			) : null}
			{errors.form ? (
				<p className="text-destructive text-sm">{errors.form}</p>
			) : null}

			<div className="flex items-center justify-end gap-3 border-t pt-5">
				<Button
					disabled={isSubmitting}
					type="button"
					variant="outline"
					onClick={() => router.push("/projects")}
				>
					Hủy
				</Button>
				<Button disabled={isSubmitting} type="submit">
					{createProject.isPending ? "Đang tạo dự án…" : "Tạo dự án"}
				</Button>
			</div>
		</form>
	);
}
