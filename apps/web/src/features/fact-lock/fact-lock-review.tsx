"use client";

import type {
	FactLockReadModel,
	FactLockRunStatus,
	FactLockStoredClaim,
} from "@affichannel/core/fact-lock/types";
import { Badge } from "@affichannel/ui/components/badge";
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
} from "@affichannel/ui/components/dialog";
import { Skeleton } from "@affichannel/ui/components/skeleton";
import { Textarea } from "@affichannel/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowRight,
	Check,
	CheckCircle2,
	CircleHelp,
	Clock3,
	FileText,
	LockKeyhole,
	RefreshCw,
	ShieldAlert,
	Trash2,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import {
	FACT_LOCK_CLASSIFICATION_LABELS,
	FACT_LOCK_STATUS_LABELS,
	type FactLockFilter,
	filterFactLockClaims,
	getFactLockActionState,
	getFactLockErrorCode,
	getFactLockErrorMessage,
	getFactLockOccurrenceLabel,
	getFactLockReviewRun,
	getFactLockSummary,
	settleFactLockMutation,
	shouldRefreshFactLockWorkflow,
} from "./fact-lock-review-state";

const FILTERS: Array<{ key: FactLockFilter; label: string }> = [
	{ key: "ALL", label: "Tất cả" },
	{ key: "SUPPORTED", label: "Được hỗ trợ" },
	{ key: "NEEDS_REVIEW", label: "Cần xem xét" },
	{ key: "UNSUPPORTED", label: "Chưa được hỗ trợ" },
	{ key: "PROHIBITED", label: "Không được phép" },
];

function classificationVariant(
	classification: FactLockStoredClaim["classificationStatus"],
) {
	if (classification === "SUPPORTED") return "success" as const;
	if (classification === "NEEDS_REVIEW") return "warning" as const;
	if (classification === "PROHIBITED") return "destructive" as const;
	return "outline" as const;
}

function reviewStatusLabel(claim: FactLockStoredClaim) {
	if (claim.reviewStatus === "AUTO_PASSED") return "Tự động đạt";
	if (claim.reviewStatus === "MANUAL_APPROVED") return "Đã duyệt thủ công";
	return "Chưa xử lý";
}

function formatConfidence(value: number | null) {
	return value === null ? "Chưa có" : `${Math.round(value * 100)}%`;
}

function getRunIdempotencyKey() {
	const random =
		typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return `fact-lock-review-${random}`;
}

function ReviewSkeleton() {
	return (
		<div className="space-y-5">
			<Skeleton className="h-24 w-full rounded-2xl" />
			<div className="grid gap-4 xl:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.4fr)_minmax(260px,0.9fr)]">
				<Skeleton className="h-[520px] rounded-2xl" />
				<Skeleton className="h-[520px] rounded-2xl" />
				<Skeleton className="h-[520px] rounded-2xl" />
			</div>
		</div>
	);
}

function StatusBadge({
	status,
}: {
	status: FactLockReadModel["effectiveStatus"];
}) {
	if (!status) return <Badge variant="outline">Chưa chạy</Badge>;
	const variant =
		status === "passed"
			? "success"
			: status === "review_required" || status === "pending"
				? "warning"
				: status === "failed" || status === "indeterminate"
					? "destructive"
					: "outline";
	return <Badge variant={variant}>{FACT_LOCK_STATUS_LABELS[status]}</Badge>;
}

function ErrorPanel({
	message,
	onRetry,
}: {
	message: string;
	onRetry: () => void;
}) {
	return (
		<Card className="border-destructive/25 bg-destructive/5">
			<CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
				<div className="flex items-start gap-3">
					<AlertTriangle
						className="mt-0.5 size-5 text-destructive"
						aria-hidden="true"
					/>
					<div>
						<p className="font-medium">Không thể tải Fact Lock Review</p>
						<p className="mt-1 text-muted-foreground text-sm">{message}</p>
					</div>
				</div>
				<Button onClick={onRetry} variant="outline">
					<RefreshCw aria-hidden="true" />
					Thử lại
				</Button>
			</CardContent>
		</Card>
	);
}

export default function FactLockReview({ projectId }: { projectId: string }) {
	const router = useRouter();
	const [filter, setFilter] = useState<FactLockFilter>("ALL");
	const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
	const [editingClaim, setEditingClaim] = useState<FactLockStoredClaim | null>(
		null,
	);
	const [editText, setEditText] = useState("");
	const [deletingClaim, setDeletingClaim] =
		useState<FactLockStoredClaim | null>(null);
	const [suggestionClaim, setSuggestionClaim] =
		useState<FactLockStoredClaim | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	const stateQuery = useQuery(
		orpc.factLock.getState.queryOptions({
			input: { projectId },
			meta: { suppressGlobalErrorToast: true },
			retry: false,
			staleTime: 0,
			refetchInterval: (query) => {
				const data = query.state.data as FactLockReadModel | undefined;
				return data?.latestRequest?.status === "pending" ? 2_000 : false;
			},
		}),
	);
	const prepareManifestMutation = useMutation(
		orpc.factLock.prepareManifest.mutationOptions(),
	);
	const runMutation = useMutation(orpc.factLock.run.mutationOptions());
	const approveMutation = useMutation(
		orpc.factLock.manualApprove.mutationOptions(),
	);
	const editMutation = useMutation(
		orpc.factLock.editClaimSource.mutationOptions(),
	);
	const deleteMutation = useMutation(
		orpc.factLock.deleteClaimSource.mutationOptions(),
	);
	const suggestionMutation = useMutation(
		orpc.factLock.applySuggestion.mutationOptions(),
	);

	const model = stateQuery.data as FactLockReadModel | undefined;
	const currentRequestStatus: FactLockRunStatus | null =
		model?.latestRequest?.status ?? null;
	const previousRequestStatus = useRef<FactLockRunStatus | null>(null);
	useEffect(() => {
		if (
			shouldRefreshFactLockWorkflow(
				previousRequestStatus.current,
				currentRequestStatus,
			)
		) {
			void router.refresh();
		}
		previousRequestStatus.current = currentRequestStatus;
	}, [currentRequestStatus, router]);
	const reviewRun = model ? getFactLockReviewRun(model) : null;
	const claims = reviewRun?.claims ?? [];
	const summary = getFactLockSummary(claims);
	const visibleClaims = filterFactLockClaims(claims, filter);
	const selectedClaim =
		claims.find((claim) => claim.id === selectedClaimId) ??
		visibleClaims[0] ??
		null;
	const stale = Boolean(
		model?.effectiveStatus === "stale" ||
			reviewRun?.effectiveStatus === "stale",
	);
	const resolutionLocked = stale || model?.latestRequest?.status === "pending";
	const isMutating =
		prepareManifestMutation.isPending ||
		approveMutation.isPending ||
		editMutation.isPending ||
		deleteMutation.isPending ||
		suggestionMutation.isPending;

	async function refresh() {
		await stateQuery.refetch();
	}

	async function runFactLock() {
		setActionError(null);
		try {
			const refreshed = await stateQuery.refetch();
			const currentModel = refreshed.data as FactLockReadModel | undefined;
			const currentScriptVersion = currentModel?.currentScriptVersion;
			if (!currentScriptVersion) {
				throw new Error("FACT_LOCK_SCRIPT_NOT_READY");
			}
			const manifest = await prepareManifestMutation.mutateAsync({
				projectId,
				scriptVersionId: currentScriptVersion.id,
				expectedScriptVersionRevision: currentScriptVersion.revision,
			});
			await settleFactLockMutation(
				runMutation.mutateAsync({
					projectId,
					claimManifestId: manifest.claimManifestId,
					idempotencyKey: getRunIdempotencyKey(),
				}),
				refresh,
				() => router.refresh(),
			);
			toast.success("Đã chạy Fact Lock", {
				description: "Kết quả đối chiếu đã được lưu để review.",
			});
		} catch (error) {
			setActionError(getFactLockErrorCode(error) ?? "FACT_LOCK_ERROR");
			const code = getFactLockErrorCode(error);
			if (
				code === "CLAIM_MANIFEST_SOURCE_REVISION_CONFLICT" ||
				code === "CLAIM_MANIFEST_NOT_EXECUTABLE"
			)
				await refresh();
			toast.error(getFactLockErrorMessage(error));
		}
	}

	function resolutionInput(claim: FactLockStoredClaim) {
		if (!reviewRun?.id || !model?.currentScriptVersion || !claim.id)
			return null;
		return {
			projectId,
			factLockRunId: reviewRun.id,
			claimId: claim.id,
			scriptVersionId: model.currentScriptVersion.id,
			baseRevision: model.currentScriptVersion.revision,
		};
	}

	async function approveClaim(claim: FactLockStoredClaim) {
		const input = resolutionInput(claim);
		if (!input) return;
		try {
			await approveMutation.mutateAsync(input);
			await refresh();
			toast.success("Đã duyệt claim thủ công");
		} catch (error) {
			toast.error(getFactLockErrorMessage(error));
		}
	}

	async function submitEdit() {
		if (!editingClaim) return;
		const input = resolutionInput(editingClaim);
		if (!input) return;
		try {
			await editMutation.mutateAsync({ ...input, newText: editText });
			setEditingClaim(null);
			await refresh();
			toast.success("Đã cập nhật nguồn claim", {
				description: "Fact Lock cũ đã được đánh dấu lỗi thời.",
			});
		} catch (error) {
			toast.error(getFactLockErrorMessage(error));
		}
	}

	async function deleteClaim() {
		if (!deletingClaim) return;
		const input = resolutionInput(deletingClaim);
		if (!input) return;
		try {
			await deleteMutation.mutateAsync(input);
			setDeletingClaim(null);
			await refresh();
			toast.success("Đã xoá claim khỏi script", {
				description: "Fact Lock cần chạy lại để tạo review mới.",
			});
		} catch (error) {
			toast.error(getFactLockErrorMessage(error));
		}
	}

	async function applySuggestion() {
		if (!suggestionClaim) return;
		const input = resolutionInput(suggestionClaim);
		if (!input) return;
		try {
			await suggestionMutation.mutateAsync(input);
			setSuggestionClaim(null);
			await refresh();
			toast.success("Đã áp dụng đề xuất", {
				description: "Fact Lock cũ đã được đánh dấu lỗi thời.",
			});
		} catch (error) {
			toast.error(getFactLockErrorMessage(error));
		}
	}

	if (stateQuery.isPending) return <ReviewSkeleton />;
	if (stateQuery.isError || !model)
		return (
			<ErrorPanel
				message={getFactLockErrorMessage(stateQuery.error)}
				onRetry={() => void refresh()}
			/>
		);

	const latestStatus = model.latestRequest?.effectiveStatus ?? null;
	const latestErrorCode = model.latestRequest?.errorCode ?? null;
	const hasNoRun = model.latestRequest === null;
	const needsFacts =
		model.latestRequest?.errorCode === "FACT_LOCK_NO_USABLE_FACTS" ||
		actionError === "FACT_LOCK_NO_USABLE_FACTS";
	const statusMessage =
		latestStatus === "failed"
			? "Lần đối chiếu gần nhất không thành công."
			: latestStatus === "indeterminate"
				? "Lần đối chiếu gần nhất chưa xác định; hệ thống không tự động gửi lại."
				: latestStatus === "pending"
					? "Đang đối chiếu claim với Product Facts..."
					: null;

	return (
		<div className="space-y-5 pb-8">
			<div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-card p-5 shadow-sm">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<h1 className="font-semibold text-2xl tracking-tight">
							Fact Lock Review
						</h1>
						<StatusBadge status={model.effectiveStatus} />
					</div>
					<p className="mt-1 max-w-2xl text-muted-foreground text-sm">
						Đối chiếu từng claim với Product Facts trước khi chuyển sang các
						bước tạo giọng đọc và render.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{!hasNoRun && (
						<Button
							disabled={
								prepareManifestMutation.isPending ||
								runMutation.isPending ||
								model.latestRequest?.status === "pending"
							}
							onClick={() => void runFactLock()}
							variant="default"
						>
							<RefreshCw aria-hidden="true" />
							Đối chiếu lại
						</Button>
					)}
					<Button
						nativeButton={false}
						render={<Link href={`/projects/${projectId}/content` as Route} />}
						variant="outline"
					>
						<FileText aria-hidden="true" />
						Mở Script Editor
					</Button>
				</div>
			</div>

			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
				<SummaryCard label="Tổng claim" value={summary.total} />
				<SummaryCard
					label="Được hỗ trợ"
					value={summary.SUPPORTED}
					tone="success"
				/>
				<SummaryCard
					label="Cần xem xét"
					value={summary.NEEDS_REVIEW}
					tone="warning"
				/>
				<SummaryCard label="Chưa được hỗ trợ" value={summary.UNSUPPORTED} />
				<SummaryCard
					label="Không được phép"
					value={summary.PROHIBITED}
					tone="danger"
				/>
			</div>

			{stale && (
				<div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
					<AlertTriangle
						className="mt-0.5 size-5 shrink-0"
						aria-hidden="true"
					/>
					<div>
						<p className="font-medium">Review đã lỗi thời</p>
						<p className="mt-1 text-sm">
							Script hoặc Product Facts đã thay đổi. Các thao tác xử lý claim
							đang bị khoá; hãy chạy lại Fact Lock.
						</p>
					</div>
				</div>
			)}

			{statusMessage && !reviewRun?.claims.length && (
				<Card className="border-blue-200 bg-blue-50/70">
					<CardContent className="flex items-start gap-3 p-5 text-blue-950">
						<Clock3 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
						<div>
							<p className="font-medium">{statusMessage}</p>
							<p className="mt-1 text-sm opacity-80">
								{latestStatus === "pending"
									? "Bạn có thể giữ màn hình này mở để trạng thái tự cập nhật."
									: getFactLockErrorMessage({
											message: latestErrorCode ?? "FACT_LOCK_ERROR",
										})}
							</p>
							{latestErrorCode && latestStatus !== "pending" && (
								<code className="mt-2 block break-all text-xs opacity-70">
									{latestErrorCode}
								</code>
							)}
						</div>
					</CardContent>
				</Card>
			)}

			{hasNoRun && (
				<Card className="border-blue-200 bg-blue-50/60">
					<CardContent className="flex flex-wrap items-center justify-between gap-5 p-7">
						<div>
							<p className="font-medium text-lg">Chưa có kết quả Fact Lock</p>
							<p className="mt-1 max-w-xl text-muted-foreground text-sm">
								Chạy đối chiếu để hệ thống kiểm tra các claim trong bản nháp
								hiện tại với Product Facts đã xác nhận.
							</p>
						</div>
						<Button
							disabled={
								prepareManifestMutation.isPending || runMutation.isPending
							}
							onClick={() => void runFactLock()}
						>
							<LockKeyhole aria-hidden="true" />
							Bắt đầu đối chiếu
						</Button>
					</CardContent>
				</Card>
			)}

			{needsFacts && (
				<Card className="border-amber-200 bg-amber-50/60">
					<CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
						<div>
							<p className="font-medium">Chưa có Product Facts đủ điều kiện</p>
							<p className="mt-1 text-muted-foreground text-sm">
								Bổ sung hoặc cập nhật Fact trước khi chạy Fact Lock.
							</p>
						</div>
						<Button
							nativeButton={false}
							render={<Link href={`/projects/${projectId}/product` as Route} />}
							variant="outline"
						>
							Mở Product Facts <ArrowRight aria-hidden="true" />
						</Button>
					</CardContent>
				</Card>
			)}

			{actionError && !needsFacts && (
				<Card className="border-destructive/25 bg-destructive/5">
					<CardContent className="flex items-start gap-3 p-5 text-destructive">
						<AlertTriangle
							className="mt-0.5 size-5 shrink-0"
							aria-hidden="true"
						/>
						<div>
							<p className="font-medium">Không thể chạy Fact Lock</p>
							<p className="mt-1 text-sm">
								{getFactLockErrorMessage({ message: actionError })}
							</p>
						</div>
					</CardContent>
				</Card>
			)}

			{reviewRun && reviewRun.claims.length > 0 && (
				<div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.4fr)_minmax(260px,0.9fr)]">
					<Card className="min-w-0">
						<CardHeader className="border-b">
							<CardTitle>Claims trong script</CardTitle>
							<CardDescription>
								{summary.unresolved > 0
									? `${summary.unresolved} claim cần xử lý trước khi khoá nội dung.`
									: "Các claim đã có trạng thái review."}
							</CardDescription>
							<div
								className="mt-3 flex flex-wrap gap-1.5"
								role="tablist"
								aria-label="Lọc claim"
							>
								{FILTERS.map((item) => {
									const count =
										item.key === "ALL" ? summary.total : summary[item.key];
									return (
										<Button
											aria-selected={filter === item.key}
											key={item.key}
											onClick={() => setFilter(item.key)}
											size="xs"
											variant={filter === item.key ? "secondary" : "ghost"}
										>
											{item.label} · {count}
										</Button>
									);
								})}
							</div>
						</CardHeader>
						<CardContent className="space-y-2 p-3">
							{visibleClaims.map((claim) => (
								<button
									className={`w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted/60 ${selectedClaim?.id === claim.id ? "border-primary bg-primary/5" : "border-transparent"}`}
									key={claim.id ?? claim.claimKey}
									onClick={() => setSelectedClaimId(claim.id)}
									type="button"
								>
									<div className="flex items-start justify-between gap-2">
										<span className="line-clamp-2 font-medium text-sm">
											{claim.claimText}
										</span>
										{claim.reviewStatus === "MANUAL_APPROVED" && (
											<CheckCircle2
												className="size-4 shrink-0 text-green-600"
												aria-label="Đã duyệt"
											/>
										)}
									</div>
									<div className="mt-2 flex flex-wrap gap-1">
										<Badge
											variant={classificationVariant(
												claim.classificationStatus,
											)}
										>
											{
												FACT_LOCK_CLASSIFICATION_LABELS[
													claim.classificationStatus
												]
											}
										</Badge>
										<Badge variant="outline">{reviewStatusLabel(claim)}</Badge>
									</div>
								</button>
							))}
						</CardContent>
					</Card>

					<ClaimReviewPanel
						claim={selectedClaim}
						isMutating={isMutating}
						locked={resolutionLocked}
						inputMode={reviewRun?.inputMode ?? "LEGACY"}
						onApprove={() => selectedClaim && void approveClaim(selectedClaim)}
						onApplySuggestion={() =>
							selectedClaim && setSuggestionClaim(selectedClaim)
						}
						onDelete={() => selectedClaim && setDeletingClaim(selectedClaim)}
						onEdit={() => {
							if (!selectedClaim) return;
							setEditText(selectedClaim.claimText);
							setEditingClaim(selectedClaim);
						}}
					/>

					<EvidencePanel claim={selectedClaim} facts={reviewRun.facts} />
				</div>
			)}

			{reviewRun &&
				reviewRun.claims.length === 0 &&
				!hasNoRun &&
				!statusMessage && (
					<Card>
						<CardContent className="p-8 text-center text-muted-foreground">
							<CircleHelp className="mx-auto size-8" aria-hidden="true" />
							<p className="mt-3 font-medium text-foreground">
								Không có claim để review
							</p>
							<p className="mt-1 text-sm">
								Bản nháp hiện tại chưa tạo claim nào.
							</p>
						</CardContent>
					</Card>
				)}

			<Dialog
				open={editingClaim !== null}
				onOpenChange={(open) => !open && setEditingClaim(null)}
			>
				<DialogPortal>
					<DialogBackdrop />
					<DialogPopup>
						<DialogTitle>Sửa nguồn claim</DialogTitle>
						<DialogDescription>
							Sửa đúng đoạn nội dung đang chứa claim. Thay đổi sẽ làm Fact Lock
							hiện tại lỗi thời.
						</DialogDescription>
						<form
							className="mt-5 space-y-4"
							onSubmit={(event) => {
								event.preventDefault();
								void submitEdit();
							}}
						>
							<Textarea
								aria-label="Nội dung claim mới"
								maxLength={4_000}
								onChange={(event) => setEditText(event.target.value)}
								value={editText}
							/>
							<div className="flex justify-end gap-2">
								<DialogClose render={<Button variant="outline" />}>
									Huỷ
								</DialogClose>
								<Button
									disabled={!editText.trim() || editMutation.isPending}
									type="submit"
								>
									Lưu thay đổi
								</Button>
							</div>
						</form>
					</DialogPopup>
				</DialogPortal>
			</Dialog>

			<Dialog
				open={deletingClaim !== null}
				onOpenChange={(open) => !open && setDeletingClaim(null)}
			>
				<DialogPortal>
					<DialogBackdrop />
					<DialogPopup>
						<DialogTitle>Xoá claim khỏi script?</DialogTitle>
						<DialogDescription>
							Thao tác này chỉ xoá đúng đoạn claim đã xác định. Script sẽ tăng
							revision và cần chạy Fact Lock lại.
						</DialogDescription>
						<div className="mt-5 flex justify-end gap-2">
							<DialogClose render={<Button variant="outline" />}>
								Huỷ
							</DialogClose>
							<Button
								disabled={deleteMutation.isPending}
								onClick={() => void deleteClaim()}
								variant="destructive"
							>
								<Trash2 aria-hidden="true" />
								Xoá claim
							</Button>
						</div>
					</DialogPopup>
				</DialogPortal>
			</Dialog>

			<Dialog
				open={suggestionClaim !== null}
				onOpenChange={(open) => !open && setSuggestionClaim(null)}
			>
				<DialogPortal>
					<DialogBackdrop />
					<DialogPopup>
						<DialogTitle>Áp dụng đề xuất?</DialogTitle>
						<DialogDescription>
							Đề xuất sẽ thay thế đúng claim trong Script Editor. Fact Lock hiện
							tại sẽ chuyển sang lỗi thời.
						</DialogDescription>
						{suggestionClaim?.suggestionText && (
							<p className="mt-4 rounded-xl bg-muted p-3 text-sm">
								{suggestionClaim.suggestionText}
							</p>
						)}
						<div className="mt-5 flex justify-end gap-2">
							<DialogClose render={<Button variant="outline" />}>
								Huỷ
							</DialogClose>
							<Button
								disabled={suggestionMutation.isPending}
								onClick={() => void applySuggestion()}
							>
								Áp dụng đề xuất
							</Button>
						</div>
					</DialogPopup>
				</DialogPortal>
			</Dialog>
		</div>
	);
}

function SummaryCard({
	label,
	value,
	tone,
}: {
	label: string;
	value: number;
	tone?: "success" | "warning" | "danger";
}) {
	return (
		<Card className="rounded-2xl">
			<CardContent className="p-4">
				<p className="text-muted-foreground text-xs">{label}</p>
				<p
					className={`mt-2 font-semibold text-2xl ${tone === "success" ? "text-green-700" : tone === "warning" ? "text-amber-700" : tone === "danger" ? "text-destructive" : ""}`}
				>
					{value}
				</p>
			</CardContent>
		</Card>
	);
}

function ClaimReviewPanel({
	claim,
	locked,
	inputMode,
	isMutating,
	onApprove,
	onEdit,
	onDelete,
	onApplySuggestion,
}: {
	claim: FactLockStoredClaim | null;
	locked: boolean;
	inputMode: "LEGACY" | "MANIFEST_V1";
	isMutating: boolean;
	onApprove: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onApplySuggestion: () => void;
}) {
	if (!claim)
		return (
			<Card className="min-w-0">
				<CardContent className="p-8 text-center text-muted-foreground">
					Chọn một claim để xem chi tiết.
				</CardContent>
			</Card>
		);
	const actions = getFactLockActionState(claim, locked, inputMode);
	return (
		<Card className="min-w-0">
			<CardHeader className="border-b">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle>Review claim</CardTitle>
					<Badge variant={classificationVariant(claim.classificationStatus)}>
						{FACT_LOCK_CLASSIFICATION_LABELS[claim.classificationStatus]}
					</Badge>
				</div>
				<CardDescription>
					{getFactLockOccurrenceLabel(claim.occurrence)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5 p-5">
				<div className="rounded-2xl border bg-muted/30 p-4">
					<p className="whitespace-pre-wrap font-medium text-base leading-7">
						{claim.claimText}
					</p>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<Detail label="Trạng thái review">{reviewStatusLabel(claim)}</Detail>
					<Detail label="Confidence">
						{formatConfidence(claim.confidence)}
					</Detail>
					<Detail className="sm:col-span-2" label="Lý do đối chiếu">
						{claim.reason}
					</Detail>
				</div>
				{claim.suggestionText && (
					<div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 text-blue-950">
						<p className="font-medium text-xs">Đề xuất sửa</p>
						<p className="mt-1 text-sm">{claim.suggestionText}</p>
					</div>
				)}
				{inputMode === "MANIFEST_V1" && (
					<p className="flex items-center gap-2 text-muted-foreground text-xs">
						<ShieldAlert className="size-4" aria-hidden="true" />
						Claim thuộc Manifest bất biến. Hãy sửa Script và chạy Fact Lock lại.
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					{actions.canApprove && (
						<Button disabled={isMutating} onClick={onApprove}>
							<Check aria-hidden="true" />
							Duyệt thủ công
						</Button>
					)}
					{actions.canEdit && (
						<Button disabled={isMutating} onClick={onEdit} variant="outline">
							Sửa claim
						</Button>
					)}
					{actions.canApplySuggestion && (
						<Button
							disabled={isMutating}
							onClick={onApplySuggestion}
							variant="outline"
						>
							Áp dụng đề xuất
						</Button>
					)}
					{actions.canDelete && (
						<Button
							disabled={isMutating}
							onClick={onDelete}
							variant="destructive"
						>
							<Trash2 aria-hidden="true" />
							Xoá
						</Button>
					)}
				</div>
				{locked && inputMode !== "MANIFEST_V1" && (
					<p className="flex items-center gap-2 text-muted-foreground text-xs">
						<ShieldAlert className="size-4" aria-hidden="true" />
						Thao tác xử lý đang khoá vì review chưa còn là nguồn hiện hành.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function Detail({
	label,
	children,
	className,
}: {
	label: string;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={className}>
			<p className="text-muted-foreground text-xs">{label}</p>
			<p className="mt-1 whitespace-pre-wrap text-sm">{children}</p>
		</div>
	);
}

function EvidencePanel({
	claim,
	facts,
}: {
	claim: FactLockStoredClaim | null;
	facts: FactLockReadModel["latestRequest"] extends infer Run
		? Run extends { facts: infer Facts }
			? Facts
			: never
		: never;
}) {
	if (!claim)
		return (
			<Card className="min-w-0">
				<CardHeader className="border-b">
					<CardTitle>Product Facts</CardTitle>
				</CardHeader>
				<CardContent className="p-5 text-muted-foreground text-sm">
					Chọn claim để xem bằng chứng.
				</CardContent>
			</Card>
		);
	const evidence = facts.filter((fact) =>
		claim.factMappings.some(
			(mapping) =>
				mapping.factId === fact.id && mapping.factRevision === fact.revision,
		),
	);
	return (
		<Card className="min-w-0">
			<CardHeader className="border-b">
				<CardTitle>Product Facts</CardTitle>
				<CardDescription>
					Bằng chứng theo đúng revision đã snapshot trong run.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3 p-5">
				{evidence.length === 0 ? (
					<div className="rounded-xl border border-dashed p-5 text-center text-muted-foreground text-sm">
						{claim.classificationStatus === "SUPPORTED"
							? "Claim được đánh dấu hỗ trợ nhưng không có evidence khớp revision để hiển thị."
							: "Claim này không có Product Fact được mapping trong snapshot."}
					</div>
				) : (
					evidence.map((fact) => {
						const mapping = claim.factMappings.find(
							(item) =>
								item.factId === fact.id && item.factRevision === fact.revision,
						);
						return (
							<div
								className="rounded-2xl border bg-muted/20 p-4"
								key={`${fact.id}:${fact.revision}`}
							>
								<div className="flex items-center justify-between gap-2">
									<p className="font-medium text-sm">{fact.type}</p>
									<Badge
										variant={
											mapping?.relation === "supports" ? "success" : "outline"
										}
									>
										{mapping?.relation === "supports"
											? "Hỗ trợ"
											: mapping?.relation === "contradicts"
												? "Mâu thuẫn"
												: "Liên quan"}
									</Badge>
								</div>
								<p className="mt-2 whitespace-pre-wrap text-sm leading-6">
									{fact.content}
								</p>
								<p className="mt-3 text-muted-foreground text-xs">
									Revision #{fact.revision} ·{" "}
									{fact.source.label ?? "Nguồn chưa đặt tên"}
								</p>
							</div>
						);
					})
				)}
			</CardContent>
		</Card>
	);
}
