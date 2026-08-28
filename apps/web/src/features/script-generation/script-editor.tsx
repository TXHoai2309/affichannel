"use client";

import { validateScriptVersionForFactLock } from "@affichannel/core";
import type { ScriptGenerationArtifact } from "@affichannel/core/script-generation/types";
import type {
	ScriptVersionEditableSnapshot,
	ScriptVersionHistoryItem,
	ScriptVersionReadModel,
} from "@affichannel/core/script-version/types";
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
import {
	Drawer,
	DrawerBackdrop,
	DrawerClose,
	DrawerDescription,
	DrawerPopup,
	DrawerPortal,
	DrawerTitle,
} from "@affichannel/ui/components/drawer";
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { Textarea } from "@affichannel/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	Check,
	CircleAlert,
	Clock3,
	Eye,
	History,
	LockKeyhole,
	RefreshCw,
	RotateCcw,
	Save,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import {
	getScriptVersionErrorCode,
	getScriptVersionErrorMessage,
	type ScriptAutosaveRequest,
	type ScriptAutosaveResult,
	useScriptAutosave,
} from "./script-editor-autosave";
import { selectScriptHook } from "./script-editor-state";
import {
	createIdempotencyKey,
	getScriptClaimRefreshErrorMessage,
	getScriptClaimRefreshResultMessage,
	runClaimRefreshAfterAutosaveFlush,
} from "./script-studio-state";

type ScriptEditorProps = {
	draft: ScriptVersionReadModel;
	sourceArtifact: ScriptGenerationArtifact | null;
	hasNewerGeneration: boolean;
	onReloadLatest: () => Promise<ScriptVersionReadModel | null>;
	save: (request: ScriptAutosaveRequest) => Promise<ScriptAutosaveResult>;
	onVersionSaved: () => Promise<void>;
	onClaimRefreshComplete?: (
		scriptVersion: ScriptVersionReadModel,
	) => Promise<void>;
	initialHistoryOpen?: boolean;
	onHistoryClosed?: () => void;
};

function EditorCard({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: React.ReactNode;
}) {
	return (
		<Card className="rounded-2xl border-affi-blue-border/80 shadow-sm">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{description ? <CardDescription>{description}</CardDescription> : null}
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}

function SaveIndicator({
	status,
	onRetry,
}: {
	status: ReturnType<typeof useScriptAutosave>["state"]["status"];
	onRetry: () => void;
}) {
	if (status === "saving") {
		return (
			<span
				aria-live="polite"
				className="flex items-center gap-1.5 text-primary text-xs"
			>
				<RefreshCw aria-hidden="true" className="size-3.5 animate-spin" />
				Đang lưu...
			</span>
		);
	}
	if (status === "dirty") {
		return (
			<span
				aria-live="polite"
				className="flex items-center gap-1.5 text-muted-foreground text-xs"
			>
				<Clock3 aria-hidden="true" className="size-3.5" />
				Có thay đổi chưa lưu
			</span>
		);
	}
	if (status === "error") {
		return (
			<div className="flex items-center gap-2 text-destructive text-xs">
				<span aria-live="polite" className="flex items-center gap-1.5">
					<CircleAlert aria-hidden="true" className="size-3.5" />
					Không thể lưu
				</span>
				<Button onClick={onRetry} size="xs" type="button" variant="outline">
					Thử lại
				</Button>
			</div>
		);
	}
	if (status === "conflict") {
		return (
			<span
				aria-live="polite"
				className="flex items-center gap-1.5 text-amber-800 text-xs"
			>
				<CircleAlert aria-hidden="true" className="size-3.5" />
				Có xung đột
			</span>
		);
	}
	return (
		<span
			aria-live="polite"
			className="flex items-center gap-1.5 text-emerald-700 text-xs"
		>
			<Check aria-hidden="true" className="size-3.5" />
			Đã lưu
		</span>
	);
}

function ClaimsPanel({
	snapshot,
	onRefreshClaims,
	refreshPending,
	refreshNotice,
}: {
	snapshot: ScriptVersionEditableSnapshot;
	onRefreshClaims: () => void;
	refreshPending: boolean;
	refreshNotice: string | null;
}) {
	const current = snapshot.claimsStatus === "current";
	return (
		<EditorCard
			title="Claims"
			description="Claims do AI tạo được giữ nguyên để cập nhật ở bước Fact Lock."
		>
			<div
				aria-live="polite"
				className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
					current
						? "border-emerald-200 bg-emerald-50 text-emerald-900"
						: "border-amber-200 bg-amber-50 text-amber-950"
				}`}
			>
				<LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
				<div>
					<p className="font-medium">
						{current
							? "Claims hiện tại"
							: "Claims cần cập nhật trước Fact Lock"}
					</p>
					{current ? null : (
						<div className="mt-1 space-y-2">
							<p className="text-xs">
								Nội dung script đã thay đổi. Danh sách claim hiện tại cần được
								cập nhật trước bước Fact Lock.
							</p>
							<Button
								data-testid="refresh-claims-button"
								disabled={refreshPending}
								onClick={onRefreshClaims}
								size="sm"
								type="button"
							>
								{refreshPending ? (
									<RefreshCw aria-hidden="true" className="animate-spin" />
								) : null}
								{refreshPending ? "Đang cập nhật..." : "Cập nhật Claims"}
							</Button>
							{refreshNotice ? (
								<p className="font-medium text-xs" role="status">
									{refreshNotice}
								</p>
							) : null}
						</div>
					)}
				</div>
			</div>
			<div className="mt-4 space-y-3">
				{snapshot.claims.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						Không có claim trong bản nháp.
					</p>
				) : (
					snapshot.claims.map((claim, index) => (
						<div
							className="rounded-xl border bg-background p-3"
							key={`${claim.text}-${index}`}
						>
							<p className="whitespace-pre-wrap text-sm">{claim.text}</p>
							<p className="mt-2 text-muted-foreground text-xs">
								Vị trí: {formatOccurrence(claim.occurrence)}
							</p>
						</div>
					))
				)}
			</div>
		</EditorCard>
	);
}

function formatOccurrence(
	occurrence: ScriptVersionEditableSnapshot["claims"][number]["occurrence"],
) {
	if (occurrence.section === "hook") return `Hook ${occurrence.hookKey}`;
	if (occurrence.section === "voiceover")
		return `Voiceover ${occurrence.segmentKey}`;
	if (occurrence.section === "scene") return `Cảnh ${occurrence.sceneOrder}`;
	return occurrence.section === "cta" ? "CTA" : "Caption";
}

function formatVersionDate(value: string | Date | null) {
	if (!value) return "Chưa có thời điểm";
	return new Intl.DateTimeFormat("vi-VN", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function ReadOnlyVersion({
	snapshot,
}: {
	snapshot: ScriptVersionEditableSnapshot;
}) {
	return (
		<div className="space-y-4" data-testid="saved-version-read-only">
			<div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950 text-sm">
				<div className="flex items-center gap-2 font-medium">
					<Eye aria-hidden="true" className="size-4" />
					Bản lưu chỉ đọc
				</div>
				<p className="mt-1 text-xs">
					Đây là snapshot lịch sử. Hãy dùng Restore để đưa nội dung vào bản nháp
					hiện tại.
				</p>
			</div>
			<div className="space-y-3">
				<div className="rounded-xl border p-3">
					<p className="font-medium text-sm">Hook</p>
					<div className="mt-2 space-y-2">
						{snapshot.hookVariants.map((hook, index) => (
							<div
								className="rounded-lg bg-muted/40 p-2 text-sm"
								key={hook.key}
							>
								<span className="font-medium">Hook {index + 1}: </span>
								{hook.text}
							</div>
						))}
					</div>
				</div>
				<div className="rounded-xl border p-3">
					<p className="font-medium text-sm">Voiceover</p>
					<div className="mt-2 space-y-2">
						{snapshot.voiceoverSegments.map((segment, index) => (
							<p
								className="rounded-lg bg-muted/40 p-2 text-sm"
								key={segment.key}
							>
								<span className="font-medium">Đoạn {index + 1}: </span>
								{segment.text}
							</p>
						))}
					</div>
				</div>
				<div className="rounded-xl border p-3">
					<p className="font-medium text-sm">Scenes</p>
					<div className="mt-2 space-y-2">
						{snapshot.scenes.map((scene) => (
							<div
								className="rounded-lg bg-muted/40 p-2 text-sm"
								key={scene.order}
							>
								<p className="font-medium">Cảnh {scene.order}</p>
								<p className="mt-1">{scene.visualDirection}</p>
								{scene.onScreenText ? (
									<p className="mt-1 text-muted-foreground">
										Text: {scene.onScreenText}
									</p>
								) : null}
							</div>
						))}
					</div>
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="rounded-xl border p-3">
						<p className="font-medium text-sm">CTA</p>
						<p className="mt-1 whitespace-pre-wrap text-sm">
							{snapshot.cta.text}
						</p>
					</div>
					<div className="rounded-xl border p-3">
						<p className="font-medium text-sm">Caption</p>
						<p className="mt-1 whitespace-pre-wrap text-sm">
							{snapshot.caption}
						</p>
					</div>
				</div>
				<div className="rounded-xl border p-3">
					<p className="font-medium text-sm">Hashtags & disclosure</p>
					<p className="mt-1 text-sm">
						{snapshot.hashtags.join(" ") || "Không có hashtag"}
					</p>
					<p className="mt-2 whitespace-pre-wrap text-muted-foreground text-sm">
						{snapshot.disclosure}
					</p>
				</div>
			</div>
		</div>
	);
}

function HistoryDrawer({
	open,
	onOpenChange,
	items,
	loading,
	selected,
	selectedLoading,
	onSelect,
	onRestore,
	restorePending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	items: ScriptVersionHistoryItem[];
	loading: boolean;
	selected: ScriptVersionReadModel | null;
	selectedLoading: boolean;
	onSelect: (versionId: string) => void;
	onRestore: (version: ScriptVersionReadModel) => void;
	restorePending: boolean;
}) {
	return (
		<Drawer open={open} onOpenChange={onOpenChange}>
			<DrawerPortal>
				<DrawerBackdrop />
				<DrawerPopup className="w-[min(48rem,calc(100%-1rem))] overflow-y-auto">
					<div className="flex items-start justify-between gap-4">
						<div>
							<DrawerTitle>Lịch sử phiên bản</DrawerTitle>
							<DrawerDescription>
								Các bản đã lưu là immutable và được sắp xếp từ mới nhất.
							</DrawerDescription>
						</div>
						<DrawerClose
							aria-label="Đóng lịch sử phiên bản"
							render={<Button size="icon" variant="ghost" />}
						>
							<span aria-hidden="true">×</span>
						</DrawerClose>
					</div>
					<div className="mt-6 grid gap-5 lg:grid-cols-[minmax(13rem,0.75fr)_minmax(0,1.25fr)]">
						<div className="space-y-2">
							<p className="font-medium text-sm">Bản đã lưu</p>
							{loading ? (
								<p className="text-muted-foreground text-sm">
									Đang tải lịch sử...
								</p>
							) : items.length === 0 ? (
								<p className="rounded-xl border border-dashed p-4 text-muted-foreground text-sm">
									Chưa có bản lưu nào.
								</p>
							) : (
								items.map((item) => (
									<button
										className={`w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted/50 ${
											selected?.id === item.id
												? "border-primary bg-primary/5"
												: ""
										}`}
										key={item.id}
										onClick={() => onSelect(item.id)}
										type="button"
									>
										<div className="flex items-center justify-between gap-2">
											<span className="font-medium text-sm">
												Bản lưu #{item.versionNumber}
											</span>
											<Badge variant="outline">Đã lưu</Badge>
										</div>
										<p className="mt-1 text-muted-foreground text-xs">
											{formatVersionDate(item.savedAt)}
										</p>
									</button>
								))
							)}
						</div>
						<div>
							{selectedLoading ? (
								<p className="text-muted-foreground text-sm">
									Đang tải snapshot...
								</p>
							) : selected ? (
								<div className="space-y-4">
									<div className="flex flex-wrap items-center justify-between gap-3">
										<div>
											<p className="font-semibold">
												Bản lưu #{selected.versionNumber}
											</p>
											<p className="text-muted-foreground text-xs">
												{formatVersionDate(selected.savedAt)} · Revision{" "}
												{selected.revision}
											</p>
										</div>
										<Button
											disabled={restorePending}
											onClick={() => onRestore(selected)}
											type="button"
											variant="outline"
										>
											{restorePending ? (
												<RefreshCw className="animate-spin" />
											) : (
												<RotateCcw />
											)}
											Khôi phục
										</Button>
									</div>
									<ReadOnlyVersion snapshot={selected.editableSnapshot} />
								</div>
							) : (
								<p className="text-muted-foreground text-sm">
									Chọn một bản lưu để xem.
								</p>
							)}
						</div>
					</div>
				</DrawerPopup>
			</DrawerPortal>
		</Drawer>
	);
}

export default function ScriptEditor({
	draft,
	sourceArtifact,
	hasNewerGeneration,
	onReloadLatest,
	save,
	onVersionSaved,
	onClaimRefreshComplete,
	initialHistoryOpen = false,
	onHistoryClosed,
}: ScriptEditorProps) {
	const autosave = useScriptAutosave({
		scriptVersionId: draft.id,
		initialSnapshot: draft.editableSnapshot,
		initialRevision: draft.revision,
		save,
	});
	const { state } = autosave;
	const [reloadPending, setReloadPending] = useState(false);
	const [reloadError, setReloadError] = useState<string | null>(null);
	const [historyOpen, setHistoryOpen] = useState(initialHistoryOpen);
	const [selectedVersion, setSelectedVersion] =
		useState<ScriptVersionReadModel | null>(null);
	const [restoreTarget, setRestoreTarget] =
		useState<ScriptVersionReadModel | null>(null);
	const [durationInputs, setDurationInputs] = useState<Record<number, string>>(
		{},
	);
	const historyQuery = useQuery(
		orpc.scriptVersion.listHistory.queryOptions({
			input: { projectId: draft.projectId },
			enabled: historyOpen,
			meta: { suppressGlobalErrorToast: true },
			retry: false,
		}),
	);
	const getVersionMutation = useMutation(
		orpc.scriptVersion.getVersion.mutationOptions(),
	);
	const saveVersionMutation = useMutation(
		orpc.scriptVersion.saveVersion.mutationOptions(),
	);
	const restoreMutation = useMutation(
		orpc.scriptVersion.restore.mutationOptions(),
	);
	const claimRefreshMutation = useMutation(
		orpc.scriptVersion.refreshClaims.mutationOptions(),
	);
	const [claimRefreshNotice, setClaimRefreshNotice] = useState<string | null>(
		null,
	);
	const readiness = validateScriptVersionForFactLock(state.snapshot).success;
	const sourceLabel =
		sourceArtifact?.id === draft.sourceGenerationId
			? `${sourceArtifact.provider} · ${sourceArtifact.model}`
			: "ScriptGeneration";

	function updateSnapshot(
		updater: (
			current: ScriptVersionEditableSnapshot,
		) => ScriptVersionEditableSnapshot,
	) {
		autosave.updateSnapshot(updater);
	}

	function updateDuration(order: number, value: string) {
		setDurationInputs((current) => ({ ...current, [order]: value }));
		const duration = Number(value);
		if (
			!Number.isFinite(duration) ||
			!Number.isInteger(duration) ||
			duration <= 0
		)
			return;
		updateSnapshot((current) => ({
			...current,
			scenes: current.scenes.map((scene) =>
				scene.order === order ? { ...scene, durationSeconds: duration } : scene,
			),
		}));
	}

	function finishDuration(order: number, value: number) {
		setDurationInputs((current) => ({ ...current, [order]: String(value) }));
	}

	async function loadLatest() {
		setReloadPending(true);
		setReloadError(null);
		try {
			const latest = await onReloadLatest();
			if (!latest) {
				setReloadError("Không tìm thấy bản nháp hiện tại.");
				return;
			}
			autosave.resetFromServer(latest.editableSnapshot, latest.revision);
		} catch {
			setReloadError("Không thể tải bản mới nhất. Hãy thử lại.");
		} finally {
			setReloadPending(false);
		}
	}

	async function openHistory() {
		setHistoryOpen(true);
		await historyQuery.refetch();
	}

	function changeHistoryOpen(open: boolean) {
		setHistoryOpen(open);
		if (!open) onHistoryClosed?.();
	}

	async function selectVersion(versionId: string) {
		try {
			const version = await getVersionMutation.mutateAsync({
				projectId: draft.projectId,
				versionId,
			});
			setSelectedVersion(version as ScriptVersionReadModel);
		} catch (error) {
			toast.error(
				getScriptVersionErrorMessage(error) || "Không thể tải bản lưu.",
			);
		}
	}

	async function saveVersion() {
		if (saveVersionMutation.isPending) return;
		const flushed = await autosave.flush();
		if (flushed.status !== "saved" || flushed.dirty) {
			toast.error(
				flushed.status === "conflict"
					? "Có xung đột. Hãy tải bản mới nhất trước khi lưu phiên bản."
					: "Chưa thể lưu phiên bản vì bản nháp chưa được autosave thành công.",
			);
			return;
		}
		try {
			await saveVersionMutation.mutateAsync({
				scriptVersionId: draft.id,
				baseRevision: flushed.baseRevision,
			});
			toast.success("Đã lưu phiên bản script");
			await onVersionSaved();
		} catch (error) {
			toast.error(getScriptVersionErrorMessage(error));
		}
	}

	async function refreshClaims() {
		if (
			claimRefreshMutation.isPending ||
			state.snapshot.claimsStatus === "current"
		)
			return;
		setClaimRefreshNotice(null);
		try {
			const prepared = await runClaimRefreshAfterAutosaveFlush(
				autosave.flush,
				(revision) =>
					claimRefreshMutation.mutateAsync({
						projectId: draft.projectId,
						scriptVersionId: draft.id,
						expectedScriptVersionRevision: revision,
						idempotencyKey: createIdempotencyKey("claim-refresh"),
					}),
			);
			if (prepared.kind === "blocked") {
				setClaimRefreshNotice(
					prepared.status === "conflict"
						? "Có xung đột khi lưu. Hãy tải bản mới nhất trước khi cập nhật Claims."
						: "Chưa thể cập nhật Claims vì bản nháp chưa được autosave thành công.",
				);
				return;
			}
			const result = prepared.result;
			if (result.kind === "completed" || result.kind === "not_required") {
				autosave.resetFromServer(
					result.scriptVersion.editableSnapshot,
					result.scriptVersion.revision,
				);
				setClaimRefreshNotice(null);
				toast.success(getScriptClaimRefreshResultMessage(result));
				await onClaimRefreshComplete?.(result.scriptVersion);
				return;
			}
			setClaimRefreshNotice(getScriptClaimRefreshResultMessage(result));
		} catch (error) {
			setClaimRefreshNotice(getScriptClaimRefreshErrorMessage(error));
		}
	}

	async function requestRestore(version: ScriptVersionReadModel) {
		const flushed = await autosave.flush();
		if (flushed.status !== "saved" || flushed.dirty) {
			toast.error(
				flushed.status === "conflict"
					? "Có xung đột. Hãy tải bản mới nhất trước khi khôi phục."
					: "Không thể khôi phục khi bản nháp chưa được lưu thành công.",
			);
			return;
		}
		setRestoreTarget(version);
	}

	async function restoreVersion() {
		if (!restoreTarget || restoreMutation.isPending) return;
		const restoredVersionNumber = restoreTarget.versionNumber;
		try {
			const restored = await restoreMutation.mutateAsync({
				scriptVersionId: draft.id,
				versionId: restoreTarget.id,
				baseRevision: autosave.state.baseRevision,
			});
			autosave.resetFromServer(
				(restored as ScriptVersionReadModel).editableSnapshot,
				(restored as ScriptVersionReadModel).revision,
			);
			setRestoreTarget(null);
			toast.success(`Đã khôi phục bản lưu #${restoredVersionNumber}`);
			await historyQuery.refetch();
		} catch (error) {
			if (getScriptVersionErrorCode(error) === "SCRIPT_VERSION_CONFLICT") {
				toast.error("Bản nháp đã thay đổi. Hãy tải bản mới nhất rồi thử lại.");
			} else {
				toast.error(getScriptVersionErrorMessage(error));
			}
		}
	}

	return (
		<div className="mx-auto w-full max-w-7xl space-y-5">
			<header className="flex flex-col gap-4 rounded-2xl border border-affi-blue-border bg-card p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="font-semibold text-2xl tracking-tight">
							Script Editor
						</h2>
						<Badge variant="outline">Phiên bản nháp</Badge>
					</div>
					<p className="text-muted-foreground text-sm">
						Chọn hook và chỉnh từng phần nội dung trước khi kiểm tra Fact Lock.
					</p>
					<div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
						<span>Nguồn AI: {sourceLabel}</span>
						<span>Revision: {state.baseRevision}</span>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						disabled={
							state.status === "saving" ||
							state.status === "error" ||
							state.status === "conflict" ||
							saveVersionMutation.isPending
						}
						onClick={() => void saveVersion()}
						type="button"
						variant="outline"
					>
						{saveVersionMutation.isPending ? (
							<RefreshCw className="animate-spin" />
						) : (
							<Save />
						)}
						Lưu phiên bản
					</Button>
					<Button
						onClick={() => void openHistory()}
						type="button"
						variant="outline"
					>
						<History />
						Lịch sử
					</Button>
					<SaveIndicator status={state.status} onRetry={autosave.retry} />
				</div>
			</header>

			{hasNewerGeneration ? (
				<div
					aria-live="polite"
					className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950"
					role="status"
				>
					<AlertTriangle
						aria-hidden="true"
						className="mt-0.5 size-5 shrink-0"
					/>
					<div>
						<p className="font-semibold text-sm">Có bản AI mới</p>
						<p className="mt-1 text-sm">
							Một kịch bản AI mới đã được tạo sau khi bạn bắt đầu chỉnh sửa. Bản
							nháp hiện tại không bị thay đổi.
						</p>
					</div>
				</div>
			) : null}

			{state.status === "conflict" ? (
				<div
					className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between"
					role="alert"
				>
					<div>
						<p className="font-semibold text-sm">Có phiên bản mới hơn</p>
						<p className="mt-1 text-sm">
							Script đã được cập nhật ở một phiên khác. Tải bản mới nhất để tiếp
							tục chỉnh sửa.
						</p>
						{state.latestRevision ? (
							<p className="mt-1 text-xs">
								Revision mới: {state.latestRevision}
							</p>
						) : null}
					</div>
					<Button
						disabled={reloadPending}
						onClick={() => void loadLatest()}
						type="button"
						variant="outline"
					>
						{reloadPending ? (
							<RefreshCw aria-hidden="true" className="animate-spin" />
						) : null}
						Tải bản mới nhất
					</Button>
				</div>
			) : null}
			{state.status === "error" ? (
				<div
					className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm"
					role="alert"
				>
					{getScriptVersionErrorMessage({ data: { code: state.errorCode } })}
				</div>
			) : null}
			{reloadError ? (
				<div
					className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm"
					role="alert"
				>
					{reloadError}
				</div>
			) : null}

			<div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.65fr)]">
				<main className="space-y-5">
					<EditorCard
						title="Hook"
						description="Chọn 1 hook chính cho phiên bản này. Hook được chọn sẽ được dùng khi kiểm tra Fact Lock."
					>
						<div aria-label="Chọn hook" className="space-y-3" role="radiogroup">
							{state.snapshot.hookVariants.map((hook, index) => {
								const selected = state.snapshot.selectedHookKey === hook.key;
								const selectHook = () => {
									if (selected) return;
									updateSnapshot((current) =>
										selectScriptHook(current, hook.key),
									);
								};
								return (
									<fieldset
										className={`rounded-xl border p-4 transition-colors ${
											selected
												? "border-primary bg-primary/5 shadow-sm"
												: "border-border bg-background hover:border-primary/40 hover:bg-muted/20"
										}`}
										data-selected={selected ? "true" : "false"}
										data-testid={`hook-card-${index + 1}`}
										key={hook.key}
										onClick={(event) => {
											const target = event.target as HTMLElement;
											if (target.closest("textarea, input, button, a")) return;
											selectHook();
										}}
										onKeyDown={(event) => {
											if (event.target !== event.currentTarget) return;
											if (event.key !== "Enter" && event.key !== " ") return;
											event.preventDefault();
											selectHook();
										}}
									>
										<legend className="sr-only">
											Thẻ chọn Hook {index + 1}
										</legend>
										<div className="flex items-center justify-between gap-3">
											<div className="flex items-center gap-2.5">
												<input
													aria-label={`Hook ${index + 1}`}
													checked={selected}
													className="size-5 cursor-pointer accent-primary outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
													name="script-hook"
													onChange={selectHook}
													onKeyDown={(event) => {
														if (event.key !== "Enter") return;
														event.preventDefault();
														selectHook();
													}}
													type="radio"
												/>
												<Badge variant={selected ? "default" : "outline"}>
													{selected ? <Check aria-hidden="true" /> : null}
													{selected ? "Đang chọn" : "Chọn hook"}
												</Badge>
											</div>
											<span className="font-medium text-muted-foreground text-sm">
												Hook {index + 1}
											</span>
										</div>
										<Textarea
											aria-label={`Nội dung Hook ${index + 1}`}
											className="mt-3 bg-background"
											value={hook.text}
											onChange={(event) =>
												updateSnapshot((current) => ({
													...current,
													hookVariants: current.hookVariants.map((item) =>
														item.key === hook.key
															? { ...item, text: event.target.value }
															: item,
													),
												}))
											}
										/>
									</fieldset>
								);
							})}
						</div>
					</EditorCard>

					<EditorCard
						title="Voiceover"
						description="Chỉnh nội dung từng đoạn; thứ tự và key được giữ cố định."
					>
						<div className="space-y-4">
							{state.snapshot.voiceoverSegments.map((segment, index) => (
								<div className="space-y-2" key={segment.key}>
									<Label htmlFor={`voiceover-${segment.key}`}>
										Đoạn {index + 1}
									</Label>
									<Textarea
										id={`voiceover-${segment.key}`}
										aria-label={`Voiceover đoạn ${index + 1}`}
										value={segment.text}
										onChange={(event) =>
											updateSnapshot((current) => ({
												...current,
												voiceoverSegments: current.voiceoverSegments.map(
													(item) =>
														item.key === segment.key
															? { ...item, text: event.target.value }
															: item,
												),
											}))
										}
									/>
								</div>
							))}
						</div>
					</EditorCard>

					<EditorCard
						title="Scenes"
						description="Chỉnh thời lượng và nội dung hiển thị; cấu trúc scene không thể thay đổi."
					>
						<div className="space-y-5">
							{state.snapshot.scenes.map((scene) => (
								<section
									className="space-y-4 rounded-xl border bg-background p-4"
									key={scene.order}
								>
									<div className="flex items-center justify-between gap-3">
										<h3 className="font-semibold text-sm">
											Cảnh {scene.order}
										</h3>
										<Badge variant="outline">Voiceover cố định</Badge>
									</div>
									<div className="grid gap-4 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)]">
										<div className="space-y-2">
											<Label htmlFor={`duration-${scene.order}`}>
												Thời lượng (giây)
											</Label>
											<Input
												id={`duration-${scene.order}`}
												inputMode="numeric"
												min={1}
												type="number"
												value={
													durationInputs[scene.order] ??
													String(scene.durationSeconds)
												}
												onBlur={() =>
													finishDuration(scene.order, scene.durationSeconds)
												}
												onChange={(event) =>
													updateDuration(scene.order, event.target.value)
												}
											/>
										</div>
										<div className="space-y-2">
											<Label htmlFor={`visual-${scene.order}`}>
												Visual Direction
											</Label>
											<Textarea
												id={`visual-${scene.order}`}
												value={scene.visualDirection}
												onChange={(event) =>
													updateSnapshot((current) => ({
														...current,
														scenes: current.scenes.map((item) =>
															item.order === scene.order
																? {
																		...item,
																		visualDirection: event.target.value,
																	}
																: item,
														),
													}))
												}
											/>
										</div>
									</div>
									<div className="space-y-2">
										<Label htmlFor={`onscreen-${scene.order}`}>
											On-screen Text
										</Label>
										<Textarea
											id={`onscreen-${scene.order}`}
											value={scene.onScreenText ?? ""}
											onChange={(event) =>
												updateSnapshot((current) => ({
													...current,
													scenes: current.scenes.map((item) =>
														item.order === scene.order
															? {
																	...item,
																	onScreenText: event.target.value || null,
																}
															: item,
													),
												}))
											}
										/>
									</div>
									<p className="text-muted-foreground text-xs">
										Voiceover tham chiếu:{" "}
										{scene.voiceoverSegmentKeys.join(", ") || "Không có"}
									</p>
								</section>
							))}
						</div>
					</EditorCard>

					<EditorCard title="CTA">
						<div className="space-y-2">
							<Label htmlFor="script-cta">Nội dung CTA</Label>
							<Textarea
								id="script-cta"
								value={state.snapshot.cta.text}
								onChange={(event) =>
									updateSnapshot((current) => ({
										...current,
										cta: { text: event.target.value },
									}))
								}
							/>
						</div>
					</EditorCard>

					<EditorCard title="Caption">
						<div className="space-y-2">
							<Label htmlFor="script-caption">Caption</Label>
							<Textarea
								id="script-caption"
								value={state.snapshot.caption}
								onChange={(event) =>
									updateSnapshot((current) => ({
										...current,
										caption: event.target.value,
									}))
								}
							/>
						</div>
					</EditorCard>

					<EditorCard
						title="Hashtags"
						description="Nhập các hashtag cách nhau bằng khoảng trắng."
					>
						<div className="space-y-2">
							<Label htmlFor="script-hashtags">Hashtags</Label>
							<Input
								id="script-hashtags"
								value={state.snapshot.hashtags.join(" ")}
								onChange={(event) =>
									updateSnapshot((current) => ({
										...current,
										hashtags: event.target.value.split(/\s+/).filter(Boolean),
									}))
								}
							/>
						</div>
					</EditorCard>

					<EditorCard title="Disclosure">
						<div className="space-y-2">
							<Label htmlFor="script-disclosure">Disclosure affiliate</Label>
							<Textarea
								id="script-disclosure"
								value={state.snapshot.disclosure}
								onChange={(event) =>
									updateSnapshot((current) => ({
										...current,
										disclosure: event.target.value,
									}))
								}
							/>
						</div>
					</EditorCard>
				</main>

				<aside className="space-y-5 xl:sticky xl:top-5">
					<EditorCard title="Trạng thái bản nháp">
						<dl className="space-y-4">
							<div>
								<dt className="text-muted-foreground text-xs">Lưu tự động</dt>
								<dd className="mt-1">
									<SaveIndicator
										status={state.status}
										onRetry={autosave.retry}
									/>
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground text-xs">Fact Lock</dt>
								<dd className="mt-1">
									<Badge variant={readiness ? "success" : "warning"}>
										{readiness
											? "Sẵn sàng cho Fact Lock"
											: "Chưa sẵn sàng cho Fact Lock"}
									</Badge>
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground text-xs">
									Nguồn bản nháp
								</dt>
								<dd className="mt-1 font-medium text-sm">Bản AI đã chọn</dd>
							</div>
						</dl>
					</EditorCard>
					<ClaimsPanel
						onRefreshClaims={() => void refreshClaims()}
						refreshNotice={claimRefreshNotice}
						refreshPending={claimRefreshMutation.isPending}
						snapshot={state.snapshot}
					/>
				</aside>
			</div>

			<HistoryDrawer
				open={historyOpen}
				onOpenChange={changeHistoryOpen}
				items={
					(historyQuery.data as ScriptVersionHistoryItem[] | undefined) ?? []
				}
				loading={historyQuery.isPending || historyQuery.isFetching}
				selected={selectedVersion}
				selectedLoading={getVersionMutation.isPending}
				onSelect={(versionId) => void selectVersion(versionId)}
				onRestore={(version) => void requestRestore(version)}
				restorePending={restoreMutation.isPending}
			/>
			<Dialog
				open={restoreTarget !== null}
				onOpenChange={(open) => {
					if (!open && !restoreMutation.isPending) setRestoreTarget(null);
				}}
			>
				<DialogPortal>
					<DialogBackdrop />
					<DialogPopup>
						<DialogTitle>Khôi phục bản lưu?</DialogTitle>
						<DialogDescription>
							Bản nháp hiện tại sẽ được thay bằng snapshot của bản lưu #
							{restoreTarget?.versionNumber}. Lịch sử phiên bản vẫn được giữ
							nguyên và thao tác này dùng revision hiện tại để tránh ghi đè thay
							đổi từ phiên khác.
						</DialogDescription>
						<div className="mt-6 flex justify-end gap-2">
							<DialogClose
								disabled={restoreMutation.isPending}
								render={<Button variant="outline" />}
							>
								Hủy
							</DialogClose>
							<Button
								disabled={restoreMutation.isPending}
								onClick={() => void restoreVersion()}
								type="button"
							>
								{restoreMutation.isPending ? (
									<RefreshCw className="animate-spin" />
								) : (
									<RotateCcw />
								)}
								Khôi phục bản này
							</Button>
						</div>
					</DialogPopup>
				</DialogPortal>
			</Dialog>
		</div>
	);
}
