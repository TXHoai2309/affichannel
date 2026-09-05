"use client";

import type { VoiceSegmentArtifactReadModel } from "@affichannel/core";
import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { Skeleton } from "@affichannel/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	CheckCircle2,
	Clock3,
	FileAudio,
	History,
	LoaderCircle,
	RefreshCw,
	RotateCcw,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { orpc } from "@/utils/orpc";
import {
	buildVoiceSegmentAudioUrl,
	createVoiceSegmentGenerateInput,
	createVoiceSegmentIdempotencyKey,
	formatVoiceSegmentDuration,
	getVoiceSegmentErrorMessage,
	getVoiceSegmentStatusLabel,
	getVoiceSegmentStatusVariant,
	settleVoiceSegmentMutation,
} from "./voice-segment-studio-state";
import { VoiceSegmentWaveform } from "./voice-segment-waveform";
import {
	getVoiceStudioErrorCode,
	isVoiceStudioFactLockError,
} from "./voice-studio-state";

type VoiceSegmentListItem = {
	segmentKey: string;
	text: string;
	readModel: VoiceSegmentArtifactReadModel;
};

type VoiceStepSummary = {
	totalSegments: number;
	completedSegments: number;
	pendingSegments: number;
	staleSegments: number;
	totalVoiceoverDurationMs: number;
	ready: boolean;
};

function VoiceoverSummary({
	summary,
}: {
	summary: VoiceStepSummary | null | undefined;
}) {
	if (!summary) {
		return <Skeleton className="h-24 rounded-2xl" />;
	}
	return (
		<Card className="rounded-2xl border-primary/20 bg-primary/[0.03]">
			<CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
				<div>
					<p className="font-medium">Voiceover</p>
					<p className="mt-1 text-muted-foreground text-sm">
						{summary.completedSegments} / {summary.totalSegments} đoạn đã tạo
					</p>
				</div>
				<div className="text-left sm:text-right">
					<p className="text-muted-foreground text-xs">
						Tổng thời lượng hiện tại
					</p>
					<p className="font-semibold text-primary text-sm">
						{(summary.totalVoiceoverDurationMs / 1_000).toFixed(1)} giây
					</p>
				</div>
				{summary.ready ? (
					<Badge className="ml-auto" variant="success">
						Voiceover đã sẵn sàng
					</Badge>
				) : null}
			</CardContent>
		</Card>
	);
}

function SegmentStudioSkeleton() {
	return (
		<div className="space-y-4">
			{[0, 1].map((index) => (
				<Skeleton className="h-52 rounded-2xl" key={index} />
			))}
		</div>
	);
}

function statusIcon(status: VoiceSegmentArtifactReadModel["effectiveStatus"]) {
	if (status === "completed") return CheckCircle2;
	if (status === "pending") return LoaderCircle;
	if (status === "stale") return History;
	if (status === "failed" || status === "indeterminate") return AlertTriangle;
	return FileAudio;
}

function VoiceSegmentCard({
	projectId,
	index,
	item,
	configDirty,
	configReady,
	activeSegmentKey,
	actionError,
	onGenerate,
}: {
	projectId: string;
	index: number;
	item: VoiceSegmentListItem;
	configDirty: boolean;
	configReady: boolean;
	activeSegmentKey: string | null;
	actionError: string | null;
	onGenerate: (segmentKey: string) => void;
}) {
	const { readModel } = item;
	const latestRequest = readModel.latestRequest;
	const usableArtifact = readModel.latestUsableArtifact;
	const status = readModel.effectiveStatus;
	const isActive = activeSegmentKey === item.segmentKey;
	const duration = formatVoiceSegmentDuration(usableArtifact?.durationMs);
	const serverError = latestRequest?.errorCode
		? getVoiceSegmentErrorMessage({ code: latestRequest.errorCode })
		: null;
	const [playbackError, setPlaybackError] = useState<{
		artifactId: string;
		message: string;
	} | null>(null);

	const audioUrl = usableArtifact
		? buildVoiceSegmentAudioUrl(projectId, usableArtifact.id)
		: null;
	const buttonDisabled =
		configDirty ||
		!configReady ||
		status === "pending" ||
		activeSegmentKey !== null;
	const buttonLabel =
		status === "pending" || isActive
			? "Đang tạo..."
			: usableArtifact
				? "Tạo lại"
				: "Tạo giọng đọc";
	const StatusIcon = statusIcon(status);

	const playbackMessage =
		playbackError && playbackError.artifactId === usableArtifact?.id
			? playbackError.message
			: null;

	return (
		<Card
			className="rounded-2xl"
			data-segment-key={item.segmentKey}
			data-testid={`voice-segment-${item.segmentKey}`}
		>
			<CardHeader className="border-b">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2">
						<StatusIcon
							aria-hidden="true"
							className={
								status === "pending"
									? "size-4 animate-spin text-primary"
									: "size-4 text-primary"
							}
						/>
						<CardTitle>Đoạn {index + 1}</CardTitle>
					</div>
					<div className="flex flex-wrap items-center justify-end gap-2">
						<Badge variant={getVoiceSegmentStatusVariant(status)}>
							{getVoiceSegmentStatusLabel(status)}
							{duration ? ` · ${duration}` : ""}
						</Badge>
						{status === "pending" ? (
							<Clock3
								className="size-4 text-muted-foreground"
								aria-hidden="true"
							/>
						) : null}
					</div>
				</div>
				<CardDescription className="mt-1">
					Khóa theo ScriptVersion hiện tại · {item.segmentKey}
				</CardDescription>
			</CardHeader>

			<CardContent className="space-y-4 pt-5">
				<p className="whitespace-pre-wrap text-sm leading-6">{item.text}</p>

				{usableArtifact && audioUrl ? (
					<div className="space-y-3 rounded-xl border bg-muted/20 p-3">
						{/* biome-ignore lint/a11y/useMediaCaption: Segment transcript is displayed immediately above the player. */}
						<audio
							aria-label={`Audio đoạn ${index + 1}`}
							className="w-full"
							controls
							preload="metadata"
							src={audioUrl}
							onError={() =>
								setPlaybackError({
									artifactId: usableArtifact.id,
									message:
										"Không thể tải audio. Hãy kiểm tra quyền truy cập hoặc thử lại sau.",
								})
							}
							onLoadStart={() => setPlaybackError(null)}
						/>
						<VoiceSegmentWaveform
							artifact={usableArtifact}
							projectId={projectId}
						/>
						{playbackMessage ? (
							<p className="text-destructive text-xs" role="alert">
								{playbackMessage}
							</p>
						) : null}
					</div>
				) : null}

				{status === "stale" ? (
					<div className="rounded-lg border border-amber-200/80 bg-amber-50/60 p-3 text-amber-900 text-xs dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
						Audio lịch sử không còn khớp với ScriptVersion hoặc VoiceConfig hiện
						tại. Hãy tạo lại sau khi cấu hình đã được lưu.
					</div>
				) : null}

				{status === "indeterminate" ? (
					<div className="rounded-lg border border-amber-200/80 bg-amber-50/60 p-3 text-amber-900 text-xs dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
						{serverError ??
							"Trạng thái yêu cầu chưa xác định. Hệ thống không tự động gửi lại để tránh phát sinh chi phí trùng."}
					</div>
				) : null}

				{status === "failed" && serverError ? (
					<div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-destructive text-xs">
						{serverError}
					</div>
				) : null}

				{actionError ? (
					<p
						aria-live="polite"
						className="text-destructive text-xs"
						role="alert"
					>
						{actionError}
					</p>
				) : null}

				{configDirty ? (
					<p className="text-muted-foreground text-xs">
						Lưu VoiceConfig hiện tại trước khi tạo hoặc tạo lại audio.
					</p>
				) : null}

				<div className="flex flex-wrap items-center justify-between gap-3">
					{usableArtifact ? (
						<span className="text-muted-foreground text-xs">
							Audio hiện tại được giữ lại trong lúc tạo lại.
						</span>
					) : (
						<span className="text-muted-foreground text-xs">
							Audio sẽ được tạo riêng cho đoạn này.
						</span>
					)}
					<Button
						disabled={buttonDisabled}
						onClick={() => onGenerate(item.segmentKey)}
						variant={usableArtifact ? "outline" : "default"}
					>
						{isActive || status === "pending" ? (
							<LoaderCircle aria-hidden="true" className="animate-spin" />
						) : usableArtifact ? (
							<RotateCcw aria-hidden="true" />
						) : (
							<FileAudio aria-hidden="true" />
						)}
						{buttonLabel}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

export default function VoiceSegmentStudio({
	projectId,
	configDirty,
	configReady,
	configRevision,
	onFactLockStale,
}: {
	projectId: string;
	configDirty: boolean;
	configReady: boolean;
	configRevision: number | null;
	onFactLockStale: () => void;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const listQuery = useQuery(
		orpc.voiceSegment.list.queryOptions({
			input: { projectId },
			meta: { suppressGlobalErrorToast: true },
			retry: false,
			enabled: configReady,
		}),
	);
	const summaryQuery = useQuery(
		orpc.voiceSegment.getSummary.queryOptions({
			input: { projectId },
			meta: { suppressGlobalErrorToast: true },
			retry: false,
			enabled: configReady,
		}),
	);
	const generateMutation = useMutation(
		orpc.voiceSegment.generate.mutationOptions({ retry: false }),
	);
	const [activeSegmentKey, setActiveSegmentKey] = useState<string | null>(null);
	const [actionError, setActionError] = useState<{
		segmentKey: string;
		message: string;
	} | null>(null);
	const lastConfigRevisionRef = useRef<number | null>(null);

	const segments = (listQuery.data?.sourceSegments ??
		[]) as VoiceSegmentListItem[];
	const hasPending = segments.some(
		(segment) => segment.readModel.effectiveStatus === "pending",
	);
	const listErrorCode = getVoiceStudioErrorCode(listQuery.error);

	useEffect(() => {
		if (listErrorCode && isVoiceStudioFactLockError(listQuery.error)) {
			onFactLockStale();
		}
	}, [listErrorCode, listQuery.error, onFactLockStale]);

	useEffect(() => {
		if (configRevision === null || !configReady) return;
		if (lastConfigRevisionRef.current === null) {
			lastConfigRevisionRef.current = configRevision;
			return;
		}
		if (lastConfigRevisionRef.current === configRevision) return;
		lastConfigRevisionRef.current = configRevision;
		void listQuery.refetch();
		void summaryQuery.refetch();
	}, [configReady, configRevision, listQuery.refetch, summaryQuery.refetch]);

	useEffect(() => {
		if (!configReady || (!hasPending && !generateMutation.isPending)) return;
		const intervalId = window.setInterval(() => {
			void listQuery.refetch();
			void summaryQuery.refetch();
		}, 2_000);
		return () => window.clearInterval(intervalId);
	}, [
		configReady,
		generateMutation.isPending,
		hasPending,
		listQuery.refetch,
		summaryQuery.refetch,
	]);

	const refreshSegmentState = async (segmentKey: string) => {
		return queryClient.fetchQuery(
			orpc.voiceSegment.getState.queryOptions({
				input: { projectId, segmentKey },
				meta: { suppressGlobalErrorToast: true },
				retry: false,
			}),
		);
	};

	const generateSegment = async (segmentKey: string) => {
		if (configDirty || !configReady || activeSegmentKey !== null) return;
		setActiveSegmentKey(segmentKey);
		setActionError(null);
		const input = createVoiceSegmentGenerateInput(
			projectId,
			segmentKey,
			createVoiceSegmentIdempotencyKey(),
		);
		const mutationPromise = generateMutation.mutateAsync(input);
		void listQuery.refetch();
		let mutationSucceeded = false;
		try {
			await settleVoiceSegmentMutation(
				mutationPromise,
				() =>
					Promise.allSettled([
						listQuery.refetch(),
						summaryQuery.refetch(),
						refreshSegmentState(segmentKey),
					]),
				() => router.refresh(),
			);
			mutationSucceeded = true;
		} catch (error) {
			if (isVoiceStudioFactLockError(error)) {
				onFactLockStale();
				return;
			}
			setActionError({
				segmentKey,
				message: getVoiceSegmentErrorMessage(error),
			});
		} finally {
			if (!mutationSucceeded) {
				await Promise.allSettled([
					listQuery.refetch(),
					summaryQuery.refetch(),
					refreshSegmentState(segmentKey),
				]);
			}
			setActiveSegmentKey(null);
		}
	};

	const queryErrorMessage = useMemo(
		() =>
			getVoiceSegmentErrorMessage(
				listQuery.error,
				"Không thể tải danh sách voiceover. Hãy thử lại.",
			),
		[listQuery.error],
	);

	return (
		<section aria-labelledby="voice-segments-title" className="space-y-4">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<FileAudio className="size-5 text-primary" aria-hidden="true" />
						<h2
							className="font-semibold text-xl tracking-tight"
							id="voice-segments-title"
						>
							Voiceover Segments
						</h2>
					</div>
					<p className="max-w-2xl text-muted-foreground text-sm">
						Tạo và nghe từng đoạn theo đúng thứ tự ScriptVersion hiện tại.
					</p>
				</div>
				<Link
					className="text-primary text-xs underline-offset-4 hover:underline"
					href={`/projects/${projectId}/content` as Route}
				>
					Sửa trong Nội dung
				</Link>
			</div>

			{configReady ? <VoiceoverSummary summary={summaryQuery.data} /> : null}

			{configDirty ? (
				<div
					className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 text-amber-900 text-sm dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
					role="status"
				>
					Voiceover đang tạm khóa vì VoiceConfig chưa được lưu. Lưu cấu hình để
					bắt đầu tạo audio.
				</div>
			) : null}

			{configReady && listQuery.isPending ? <SegmentStudioSkeleton /> : null}

			{configReady && listQuery.isError ? (
				<Card className="rounded-2xl border-destructive/25 bg-destructive/5">
					<CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
						<div className="flex items-start gap-3">
							<AlertTriangle
								aria-hidden="true"
								className="mt-0.5 size-5 text-destructive"
							/>
							<div>
								<p className="font-medium">Không thể tải Voiceover Segments</p>
								<p className="mt-1 text-muted-foreground text-sm">
									{queryErrorMessage}
								</p>
							</div>
						</div>
						<Button onClick={() => void listQuery.refetch()} variant="outline">
							<RefreshCw aria-hidden="true" />
							Thử lại
						</Button>
					</CardContent>
				</Card>
			) : null}

			{configReady && listQuery.isSuccess && segments.length === 0 ? (
				<Card className="rounded-2xl">
					<CardContent className="p-6 text-muted-foreground text-sm">
						ScriptVersion hiện tại chưa có đoạn voiceover nào.
					</CardContent>
				</Card>
			) : null}

			{configReady && listQuery.isSuccess ? (
				<div className="space-y-4">
					{segments.map((segment, index) => (
						<VoiceSegmentCard
							configDirty={configDirty}
							configReady={configReady}
							actionError={
								actionError?.segmentKey === segment.segmentKey
									? actionError.message
									: null
							}
							activeSegmentKey={activeSegmentKey}
							index={index}
							item={segment}
							key={segment.segmentKey}
							onGenerate={(segmentKey) => void generateSegment(segmentKey)}
							projectId={projectId}
						/>
					))}
				</div>
			) : null}
		</section>
	);
}
