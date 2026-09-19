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
import { LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { orpc } from "@/utils/orpc";
import {
	resolveQuickImageRenderUiState,
	shouldPollQuickImageRender,
} from "./quick-image-render-presentation";

type Props = Readonly<{
	projectId: string;
	compositionVersionId: string;
}>;

function userMessage(state: ReturnType<typeof resolveQuickImageRenderUiState>) {
	switch (state) {
		case "READY":
			return "Sẵn sàng tạo video từ CompositionVersion đã khóa.";
		case "QUEUED":
			return "Video đang chờ xử lý…";
		case "RUNNING":
			return "Đang tạo video…";
		case "BLOCKED":
			return "Render hiện đang bị chặn. Vui lòng kiểm tra lại điều kiện render.";
		case "FAILED":
			return "Tạo video thất bại.";
		case "INDETERMINATE":
			return "Chưa xác định được kết quả render. Không có artifact được giả định.";
		case "COMPLETED":
			return "Video đã sẵn sàng.";
	}
}

function isCurrentStatus(
	value:
		| {
				renderJobId: string;
				compositionVersionId: string;
		  }
		| null
		| undefined,
	identity: { compositionVersionId: string; renderJobId: string | null },
) {
	return Boolean(
		value &&
			value.compositionVersionId === identity.compositionVersionId &&
			value.renderJobId === identity.renderJobId,
	);
}

export default function QuickImageRenderController({
	projectId,
	compositionVersionId,
}: Props) {
	const identity = useMemo(
		() => ({ compositionVersionId, projectId }),
		[compositionVersionId, projectId],
	);
	const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
	const [trackingInitialized, setTrackingInitialized] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);

	const discoveryQuery = useQuery(
		orpc.quickImageRender.forComposition.queryOptions({
			input: identity,
			meta: { suppressGlobalErrorToast: true },
			retry: false,
		}),
	);

	useEffect(() => {
		setTrackedJobId(null);
		setTrackingInitialized(false);
		setActionError(null);
	}, [compositionVersionId, projectId]);

	useEffect(() => {
		if (
			trackingInitialized ||
			discoveryQuery.isPending ||
			discoveryQuery.isError
		)
			return;
		setTrackedJobId(discoveryQuery.data?.renderJobId ?? null);
		setTrackingInitialized(true);
	}, [
		discoveryQuery.data,
		discoveryQuery.isError,
		discoveryQuery.isPending,
		trackingInitialized,
	]);

	const statusQuery = useQuery(
		orpc.quickImageRender.status.queryOptions({
			input: {
				projectId,
				renderJobId: trackedJobId ?? "disabled",
			},
			meta: { suppressGlobalErrorToast: true },
			enabled: trackingInitialized && trackedJobId !== null,
			retry: false,
			refetchInterval: (query) =>
				shouldPollQuickImageRender(query.state.data?.status ?? null)
					? 1_500
					: false,
		}),
	);

	const startMutation = useMutation(
		orpc.quickImageRender.start.mutationOptions({ retry: false }),
	);
	const retryMutation = useMutation(
		orpc.quickImageRender.retry.mutationOptions({ retry: false }),
	);

	const status = isCurrentStatus(statusQuery.data, {
		compositionVersionId,
		renderJobId: trackedJobId,
	})
		? statusQuery.data
		: isCurrentStatus(discoveryQuery.data, {
					compositionVersionId,
					renderJobId: trackedJobId,
				})
			? discoveryQuery.data
			: null;
	const state = resolveQuickImageRenderUiState({
		status: status?.status ?? null,
	});

	const start = async () => {
		if (startMutation.isPending || retryMutation.isPending) return;
		setActionError(null);
		try {
			const result = await startMutation.mutateAsync({
				...identity,
				idempotencyKey: crypto.randomUUID(),
			});
			setTrackedJobId(result.renderJobId);
			setTrackingInitialized(true);
		} catch {
			setActionError("Không thể bắt đầu render. Vui lòng thử lại.");
		}
	};

	const retry = async () => {
		if (
			!trackedJobId ||
			state !== "FAILED" ||
			startMutation.isPending ||
			retryMutation.isPending
		)
			return;
		setActionError(null);
		try {
			const result = await retryMutation.mutateAsync({
				projectId,
				failedRenderJobId: trackedJobId,
				idempotencyKey: crypto.randomUUID(),
			});
			setTrackedJobId(result.renderJobId);
		} catch {
			setActionError("Không thể thử lại render. Vui lòng thử lại sau.");
		}
	};

	if (discoveryQuery.isPending || !trackingInitialized) {
		return (
			<div
				aria-live="polite"
				className="rounded-lg border p-4 text-sm"
				data-testid="quick-image-render-loading"
			>
				Đang tải trạng thái video…
			</div>
		);
	}

	if (discoveryQuery.isError) {
		return (
			<div
				aria-live="assertive"
				className="rounded-lg border border-destructive/30 p-4 text-destructive text-sm"
				data-testid="quick-image-render-error"
			>
				Không thể tải trạng thái video. Hãy tải lại trang để thử lại.
			</div>
		);
	}

	return (
		<Card data-render-state={state} data-testid="quick-image-render-controller">
			<CardHeader>
				<CardTitle>Render video</CardTitle>
				<CardDescription>
					Job được gắn với CompositionVersion đã khóa, không tự chọn phiên bản
					mới.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div
					aria-live="polite"
					className="text-sm"
					data-testid="quick-image-render-status"
				>
					{userMessage(state)}
				</div>

				{state === "READY" ? (
					<Button
						disabled={startMutation.isPending}
						onClick={() => void start()}
					>
						{startMutation.isPending ? (
							<LoaderCircle className="animate-spin" aria-hidden="true" />
						) : null}
						Render video
					</Button>
				) : null}

				{state === "FAILED" ? (
					<Button
						disabled={retryMutation.isPending}
						onClick={() => void retry()}
						variant="outline"
					>
						{retryMutation.isPending ? (
							<LoaderCircle className="animate-spin" aria-hidden="true" />
						) : (
							<RotateCcw aria-hidden="true" />
						)}
						Thử lại
					</Button>
				) : null}

				{state === "COMPLETED" && status?.artifact ? (
					<a
						className="inline-flex items-center rounded-md border px-3 py-2 font-medium text-sm"
						download
						href={status.artifact.downloadUrl}
						data-testid="quick-image-render-artifact"
					>
						Tải video
					</a>
				) : null}

				{statusQuery.isError && trackedJobId ? (
					<Button onClick={() => void statusQuery.refetch()} variant="outline">
						Tải lại trạng thái
					</Button>
				) : null}
				{actionError ? (
					<p
						aria-live="assertive"
						className="text-destructive text-sm"
						role="alert"
					>
						{actionError}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
