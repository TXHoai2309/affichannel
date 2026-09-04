"use client";

import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { orpc } from "@/utils/orpc";
import { ProductSelector } from "./product-selector";
import { getProjectErrorMessage } from "./project-errors";

export default function ProductLinkPanel({ projectId }: { projectId: string }) {
	const router = useRouter();
	const projectQuery = useQuery(
		orpc.project.get.queryOptions({ input: { id: projectId }, retry: false }),
	);
	const productsQuery = useQuery(
		orpc.product.listMinimal.queryOptions({
			input: { selectableOnly: true },
			retry: false,
		}),
	);
	const workflowQuery = useQuery(
		orpc.project.getAdaptiveWorkflow.queryOptions({
			input: { id: projectId },
			retry: false,
		}),
	);
	const createProduct = useMutation(
		orpc.product.createMinimal.mutationOptions(),
	);
	const updateProject = useMutation(orpc.project.update.mutationOptions());
	const [selectedProductId, setSelectedProductId] = useState("");
	const [error, setError] = useState<string | null>(null);

	const project = projectQuery.data;
	const linkedProductId = project?.product.id ?? "";
	const currentSelection = selectedProductId || linkedProductId;
	const productStep = workflowQuery.data?.steps.find(
		(step) => step.capability === "PRODUCT",
	);

	async function createProductAndSelect(name: string) {
		const created = await createProduct.mutateAsync({ name });
		setSelectedProductId(created.id);
		await productsQuery.refetch();
	}

	async function linkProduct() {
		if (!project || !currentSelection || updateProject.isPending) return;
		setError(null);
		try {
			await updateProject.mutateAsync({
				id: project.id,
				name: project.name,
				productId: currentSelection,
				platform: project.brief.platform,
				goal: project.brief.goal,
				durationSeconds: project.brief.durationSeconds,
				angle: project.brief.angle,
				description: project.brief.description ?? undefined,
				...(project.contentType && project.creationPath && project.contentFormat
					? {
							contentType: project.contentType,
							creationPath: project.creationPath,
							contentFormat: {
								key: project.contentFormat.ref.key,
								version: project.contentFormat.ref.version,
							},
						}
					: {}),
			});
			setSelectedProductId("");
			await projectQuery.refetch();
			router.refresh();
		} catch (linkError) {
			setError(
				getProjectErrorMessage(
					linkError,
					"Không thể liên kết sản phẩm. Hãy thử lại.",
				),
			);
		}
	}

	if (projectQuery.isPending) {
		return (
			<div
				aria-label="Đang tải sản phẩm"
				className="h-48 animate-pulse rounded-2xl bg-muted"
				role="status"
			/>
		);
	}
	if (!project || projectQuery.isError) {
		return (
			<Card className="border-destructive/25 bg-destructive/5">
				<CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
					<p className="text-destructive text-sm">
						Không thể tải thông tin sản phẩm.
					</p>
					<Button onClick={() => void projectQuery.refetch()} variant="outline">
						<RefreshCw aria-hidden="true" /> Thử lại
					</Button>
				</CardContent>
			</Card>
		);
	}
	if (!linkedProductId && productStep?.applicabilityState === "NOT_REQUIRED") {
		return (
			<Card className="rounded-2xl border-affi-blue-border/80 shadow-sm">
				<CardHeader>
					<CardTitle>Sản phẩm</CardTitle>
					<CardDescription>
						Project hiện tại không cần liên kết sản phẩm.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground text-sm">
						Bạn có thể tiếp tục tạo nội dung và chỉ liên kết sản phẩm khi thật
						sự cần.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="rounded-2xl border-affi-blue-border/80 shadow-sm">
			<CardHeader>
				<CardTitle>Liên kết sản phẩm</CardTitle>
				<CardDescription>
					{linkedProductId
						? `Sản phẩm hiện tại: ${project.product.name}`
						: "Liên kết khi kịch bản có claim về sản phẩm. Bạn cũng có thể để trống."}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<ProductSelector
					disabled={
						productsQuery.isLoading ||
						createProduct.isPending ||
						updateProject.isPending
					}
					error={undefined}
					products={productsQuery.data ?? []}
					value={currentSelection}
					onChange={setSelectedProductId}
					onCreate={createProductAndSelect}
				/>
				<Button
					disabled={!selectedProductId || updateProject.isPending}
					onClick={() => void linkProduct()}
					type="button"
				>
					{updateProject.isPending ? (
						<RefreshCw aria-hidden="true" className="animate-spin" />
					) : (
						<Link2 aria-hidden="true" />
					)}
					{updateProject.isPending ? "Đang liên kết…" : "Liên kết sản phẩm"}
				</Button>
				{error ? (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				) : null}
				{productsQuery.isError ? (
					<p className="text-destructive text-sm" role="alert">
						Không thể tải danh sách sản phẩm.
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
