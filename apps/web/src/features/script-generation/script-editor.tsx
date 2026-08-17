"use client";

import { validateScriptVersionForFactLock } from "@affichannel/core";
import type { ScriptGenerationArtifact } from "@affichannel/core/script-generation/types";
import type {
	ScriptVersionEditableSnapshot,
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
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { Textarea } from "@affichannel/ui/components/textarea";
import {
	AlertTriangle,
	Check,
	CircleAlert,
	Clock3,
	LockKeyhole,
	RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
	getScriptVersionErrorMessage,
	type ScriptAutosaveRequest,
	type ScriptAutosaveResult,
	useScriptAutosave,
} from "./script-editor-autosave";

type ScriptEditorProps = {
	draft: ScriptVersionReadModel;
	sourceArtifact: ScriptGenerationArtifact | null;
	hasNewerGeneration: boolean;
	onReloadLatest: () => Promise<ScriptVersionReadModel | null>;
	save: (request: ScriptAutosaveRequest) => Promise<ScriptAutosaveResult>;
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
}: {
	snapshot: ScriptVersionEditableSnapshot;
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
						<p className="mt-1 text-xs">
							Nội dung script đã thay đổi. Danh sách claim hiện tại cần được cập
							nhật trước bước Fact Lock.
						</p>
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

export default function ScriptEditor({
	draft,
	sourceArtifact,
	hasNewerGeneration,
	onReloadLatest,
	save,
}: ScriptEditorProps) {
	const autosave = useScriptAutosave({
		scriptVersionId: draft.id,
		initialSnapshot: draft.editableSnapshot,
		initialRevision: draft.revision,
		save,
	});
	const { state } = autosave;
	const [selectedHookKey, setSelectedHookKey] = useState(
		draft.editableSnapshot.selectedHookKey,
	);
	const [reloadPending, setReloadPending] = useState(false);
	const [reloadError, setReloadError] = useState<string | null>(null);
	const [durationInputs, setDurationInputs] = useState<Record<number, string>>(
		{},
	);
	useEffect(() => {
		setSelectedHookKey(draft.editableSnapshot.selectedHookKey);
	}, [draft.editableSnapshot.selectedHookKey]);
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
			setSelectedHookKey(latest.editableSnapshot.selectedHookKey);
			autosave.resetFromServer(latest.editableSnapshot, latest.revision);
		} catch {
			setReloadError("Không thể tải bản mới nhất. Hãy thử lại.");
		} finally {
			setReloadPending(false);
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
				<SaveIndicator status={state.status} onRetry={autosave.retry} />
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
						description="Chọn một hook và chỉnh nội dung. Key hook được giữ cố định."
					>
						<div aria-label="Chọn hook" className="space-y-3" role="radiogroup">
							{state.snapshot.hookVariants.map((hook, index) => (
								<div
									className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${
										selectedHookKey === hook.key
											? "border-primary bg-primary/5"
											: ""
									}`}
									key={hook.key}
								>
									<Button
										aria-checked={selectedHookKey === hook.key}
										aria-label={`Hook ${index + 1}`}
										className="mt-0.5 shrink-0"
										onClick={() => {
											setSelectedHookKey(hook.key);
											updateSnapshot((current) => ({
												...current,
												selectedHookKey: hook.key,
											}));
										}}
										role="radio"
										size="icon"
										type="button"
										variant="outline"
									>
										<span
											aria-hidden="true"
											className={`size-2.5 rounded-full ${
												selectedHookKey === hook.key
													? "bg-primary"
													: "bg-muted-foreground/30"
											}`}
										/>
									</Button>
									<span className="min-w-0 flex-1">
										<p className="font-medium text-sm">Hook {index + 1}</p>
										<Textarea
											aria-label={`Nội dung Hook ${index + 1}`}
											className="mt-2 bg-background"
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
									</span>
								</div>
							))}
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
					<ClaimsPanel snapshot={state.snapshot} />
				</aside>
			</div>
		</div>
	);
}
