"use client";

import type { VoiceConfig, VoicePreset } from "@affichannel/core";
import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { Label } from "@affichannel/ui/components/label";
import { Skeleton } from "@affichannel/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	LockKeyhole,
	RefreshCw,
	Save,
	Volume2,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { orpc } from "@/utils/orpc";
import { requestVoicePreview } from "./voice-preview-client";
import {
	createVoiceStudioDraft,
	getVoiceStudioErrorMessage,
	isVoiceStudioFactLockError,
	releaseVoicePreviewUrl,
	type VoiceStudioDraft,
	voiceStudioDraftEquals,
} from "./voice-studio-state";

function StudioSkeleton() {
	return (
		<div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
			<Skeleton className="h-[620px] rounded-2xl" />
			<Skeleton className="h-[360px] rounded-2xl" />
		</div>
	);
}

function StudioError({ onRetry }: { onRetry: () => void }) {
	return (
		<Card className="border-destructive/25 bg-destructive/5">
			<CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
				<div className="flex items-start gap-3">
					<AlertTriangle
						className="mt-0.5 size-5 text-destructive"
						aria-hidden="true"
					/>
					<div>
						<p className="font-medium">Không thể tải Voice Studio</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Hãy thử tải lại cấu hình.
						</p>
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

function LockedStudio({
	projectId,
	onRefresh,
}: {
	projectId: string;
	onRefresh: () => void;
}) {
	return (
		<Card className="border-amber-200/80 bg-amber-50/45">
			<CardContent className="flex flex-wrap items-start justify-between gap-4 p-6">
				<div className="flex items-start gap-3">
					<div className="rounded-full bg-amber-100 p-2 text-amber-700">
						<LockKeyhole className="size-5" aria-hidden="true" />
					</div>
					<div>
						<p className="font-medium">Voice Studio đang bị khóa</p>
						<p className="mt-1 max-w-xl text-muted-foreground text-sm">
							Script hoặc Product Facts đã thay đổi. Hãy chạy lại Fact Lock để
							tiếp tục; cấu hình voice đã lưu sẽ được giữ nguyên.
						</p>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button onClick={onRefresh} variant="outline">
						<RefreshCw aria-hidden="true" />
						Tải lại
					</Button>
					<Button
						nativeButton={false}
						render={<Link href={`/projects/${projectId}/fact-lock` as Route} />}
					>
						Mở Fact Lock
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

export default function VoiceStudio({ projectId }: { projectId: string }) {
	const router = useRouter();
	const presetsQuery = useQuery(
		orpc.voice.listPresets.queryOptions({
			meta: { suppressGlobalErrorToast: true },
			retry: false,
		}),
	);
	const configQuery = useQuery(
		orpc.voice.getConfig.queryOptions({
			input: { projectId },
			meta: { suppressGlobalErrorToast: true },
			retry: false,
		}),
	);
	const saveMutation = useMutation(orpc.voice.saveConfig.mutationOptions());
	const [draft, setDraft] = useState<VoiceStudioDraft | null>(null);
	const [savedConfig, setSavedConfig] = useState<VoiceConfig | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [stale, setStale] = useState(false);
	const [reloading, setReloading] = useState(false);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const hydratedRef = useRef(false);
	const mountedRef = useRef(true);
	const objectUrlRef = useRef<string | null>(null);
	const previewAbortRef = useRef<AbortController | null>(null);

	const presets = presetsQuery.data ?? [];
	const selectedPreset = presets.find((preset) => preset.id === draft?.voiceId);
	const dirty = Boolean(draft && !voiceStudioDraftEquals(draft, savedConfig));
	const saveLoading = saveMutation.isPending;

	function replacePreviewUrl(nextUrl: string | null) {
		releaseVoicePreviewUrl(objectUrlRef.current, URL.revokeObjectURL);
		objectUrlRef.current = nextUrl;
		setPreviewUrl(nextUrl);
	}

	const hydrate = useCallback(
		(config: VoiceConfig | null, availablePresets: VoicePreset[]) => {
			setSavedConfig(config);
			setDraft(createVoiceStudioDraft(availablePresets, config));
			hydratedRef.current = true;
		},
		[],
	);

	useEffect(() => {
		if (!hydratedRef.current && presetsQuery.data && configQuery.isSuccess) {
			hydrate(configQuery.data, presetsQuery.data);
		}
	}, [configQuery.data, configQuery.isSuccess, hydrate, presetsQuery.data]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			previewAbortRef.current?.abort();
			releaseVoicePreviewUrl(objectUrlRef.current, URL.revokeObjectURL);
			objectUrlRef.current = null;
		};
	}, []);

	function updateDraft(nextDraft: VoiceStudioDraft) {
		setDraft(nextDraft);
		setFormError(null);
		setPreviewError(null);
		setStatusMessage(null);
		if (objectUrlRef.current) replacePreviewUrl(null);
	}

	function selectVoice(voiceId: string) {
		const preset = presets.find((candidate) => candidate.id === voiceId);
		if (!preset || !draft) return;
		const language = preset.supportedLanguages.some(
			(candidateLanguage) => candidateLanguage === draft.language,
		)
			? draft.language
			: (preset.supportedLanguages[0] ?? "");
		const speed = Math.min(
			preset.maxSpeed,
			Math.max(preset.minSpeed, draft.speed),
		);
		updateDraft({ voiceId, language, speed });
	}

	function handleError(error: unknown, fallback?: string) {
		if (isVoiceStudioFactLockError(error)) {
			setStale(true);
			replacePreviewUrl(null);
			setFormError(null);
			setPreviewError(null);
			return;
		}
		return getVoiceStudioErrorMessage(error, fallback);
	}

	async function saveConfig() {
		if (!draft || !selectedPreset || saveLoading) return;
		setFormError(null);
		setStatusMessage(null);
		try {
			const saved = await saveMutation.mutateAsync({
				projectId,
				baseRevision: savedConfig?.revision ?? null,
				voiceId: draft.voiceId,
				language: draft.language,
				speed: draft.speed,
			});
			if (!mountedRef.current) return;
			setSavedConfig(saved);
			setDraft({
				voiceId: saved.voiceId,
				language: saved.language,
				speed: saved.speed,
			});
			setStatusMessage("Đã lưu");
		} catch (error) {
			const message = handleError(error);
			if (message) setFormError(message);
		}
	}

	async function reloadConfig() {
		setReloading(true);
		setFormError(null);
		setPreviewError(null);
		try {
			const result = await configQuery.refetch();
			if (result.data !== undefined && presetsQuery.data) {
				hydrate(result.data, presetsQuery.data);
				replacePreviewUrl(null);
				setStatusMessage("Đã tải cấu hình mới nhất");
			}
		} finally {
			if (mountedRef.current) setReloading(false);
		}
	}

	async function refreshAfterFactLock() {
		setStale(false);
		hydratedRef.current = false;
		setFormError(null);
		setPreviewError(null);
		setStatusMessage(null);
		replacePreviewUrl(null);
		router.refresh();
		await Promise.all([presetsQuery.refetch(), configQuery.refetch()]);
	}

	async function preview() {
		if (dirty || !savedConfig || previewLoading || saveLoading) return;
		setPreviewLoading(true);
		setPreviewError(null);
		setStatusMessage(null);
		const controller = new AbortController();
		previewAbortRef.current = controller;
		try {
			const blob = await requestVoicePreview(
				projectId,
				fetch,
				controller.signal,
			);
			if (!mountedRef.current) return;
			const nextUrl = URL.createObjectURL(blob);
			replacePreviewUrl(nextUrl);
			setStatusMessage("Đã tạo bản nghe thử");
		} catch (error) {
			if (!mountedRef.current || controller.signal.aborted) return;
			const message = handleError(error);
			if (message) setPreviewError(message);
		} finally {
			if (previewAbortRef.current === controller) {
				previewAbortRef.current = null;
				if (mountedRef.current) setPreviewLoading(false);
			}
		}
	}

	if (presetsQuery.isPending || configQuery.isPending) {
		return <StudioSkeleton />;
	}
	if (
		stale ||
		isVoiceStudioFactLockError(presetsQuery.error) ||
		isVoiceStudioFactLockError(configQuery.error)
	) {
		return (
			<LockedStudio
				onRefresh={() => void refreshAfterFactLock()}
				projectId={projectId}
			/>
		);
	}
	if (
		presetsQuery.isError ||
		configQuery.isError ||
		!draft ||
		!selectedPreset
	) {
		return <StudioError onRetry={() => void reloadConfig()} />;
	}

	const languageOptions = selectedPreset.supportedLanguages;
	const formDisabled = saveLoading || previewLoading;

	return (
		<section aria-labelledby="voice-studio-title" className="space-y-5 pb-8">
			<div className="space-y-2">
				<div className="flex flex-wrap items-center gap-2">
					<Volume2 className="size-5 text-primary" aria-hidden="true" />
					<h1
						className="font-semibold text-2xl tracking-tight"
						id="voice-studio-title"
					>
						Voice Studio
					</h1>
				</div>
				<p className="max-w-2xl text-muted-foreground text-sm">
					Chọn giọng đọc, ngôn ngữ và tốc độ rồi nghe thử trước khi tạo
					voiceover.
				</p>
			</div>

			<div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
				<Card className="rounded-2xl">
					<CardHeader className="border-b">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div>
								<CardTitle>Cấu hình giọng đọc</CardTitle>
								<CardDescription className="mt-1">
									Cấu hình được lưu riêng cho project hiện tại.
								</CardDescription>
							</div>
							<Badge variant={dirty ? "warning" : "success"}>
								{dirty ? "Chưa lưu" : "Đã lưu"}
							</Badge>
						</div>
					</CardHeader>
					<CardContent className="space-y-7 pt-5">
						<div className="space-y-2">
							<Label htmlFor="voice-language">Ngôn ngữ</Label>
							<select
								aria-describedby="voice-language-help"
								className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
								disabled={formDisabled || languageOptions.length <= 1}
								id="voice-language"
								value={draft.language}
								onChange={(event) =>
									updateDraft({ ...draft, language: event.target.value })
								}
							>
								{languageOptions.map((language) => (
									<option key={language} value={language}>
										{language === "vi" ? "Tiếng Việt" : language}
									</option>
								))}
							</select>
							<p
								className="text-muted-foreground text-xs"
								id="voice-language-help"
							>
								Ngôn ngữ được cung cấp bởi catalog server.
							</p>
						</div>

						<fieldset className="space-y-3" disabled={formDisabled}>
							<legend className="font-medium text-sm">Giọng đọc</legend>
							<div
								aria-label="Các preset giọng đọc"
								className="grid gap-3 sm:grid-cols-2"
								role="radiogroup"
							>
								{presets.map((preset) => (
									<label
										className="group relative flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
										key={preset.id}
									>
										<input
											checked={draft.voiceId === preset.id}
											className="sr-only"
											name="voice-preset"
											type="radio"
											value={preset.id}
											onChange={() => selectVoice(preset.id)}
										/>
										<span className="mt-0.5 flex size-4 items-center justify-center rounded-full border border-muted-foreground/50 group-has-[:checked]:border-primary">
											<span className="size-2 rounded-full bg-primary opacity-0 group-has-[:checked]:opacity-100" />
										</span>
										<span className="min-w-0">
											<span className="block font-medium text-sm">
												{preset.displayName}
											</span>
											<span className="mt-1 block text-muted-foreground text-xs">
												{preset.id} · {preset.supportedLanguages.join(", ")}
											</span>
										</span>
									</label>
								))}
							</div>
						</fieldset>

						<div className="space-y-3">
							<div className="flex items-center justify-between gap-3">
								<Label htmlFor="voice-speed">Tốc độ</Label>
								<output
									className="font-semibold text-primary"
									htmlFor="voice-speed"
								>
									{draft.speed.toFixed(1)}x
								</output>
							</div>
							<input
								aria-label="Tốc độ giọng đọc"
								className="w-full accent-primary"
								disabled={formDisabled}
								id="voice-speed"
								max={selectedPreset.maxSpeed}
								min={selectedPreset.minSpeed}
								step={0.1}
								type="range"
								value={draft.speed}
								onChange={(event) =>
									updateDraft({ ...draft, speed: Number(event.target.value) })
								}
							/>
							<div className="flex justify-between text-muted-foreground text-xs">
								<span>{selectedPreset.minSpeed.toFixed(1)}x</span>
								<span>{selectedPreset.maxSpeed.toFixed(1)}x</span>
							</div>
						</div>

						{formError ? (
							<p className="text-destructive text-sm" role="alert">
								{formError}
							</p>
						) : null}
						{formError ? (
							<Button
								disabled={reloading || formDisabled}
								onClick={() => void reloadConfig()}
								variant="ghost"
							>
								<RefreshCw aria-hidden="true" />
								{reloading ? "Đang tải..." : "Tải cấu hình mới nhất"}
							</Button>
						) : null}
						<div className="flex flex-wrap items-center gap-3">
							<Button
								disabled={!dirty || formDisabled}
								onClick={() => void saveConfig()}
							>
								<Save aria-hidden="true" />
								{saveLoading ? "Đang lưu..." : "Lưu cấu hình"}
							</Button>
							{savedConfig ? (
								<span className="text-muted-foreground text-xs">
									Revision {savedConfig.revision}
								</span>
							) : null}
						</div>
					</CardContent>
				</Card>

				<Card className="h-fit rounded-2xl">
					<CardHeader className="border-b">
						<CardTitle>Nghe thử</CardTitle>
						<CardDescription className="mt-1">
							Lưu cấu hình trước khi tạo bản nghe thử.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5 pt-5">
						<Button
							className="w-full"
							disabled={!savedConfig || dirty || formDisabled}
							onClick={() => void preview()}
							variant="outline"
						>
							<Volume2 aria-hidden="true" />
							{previewLoading ? "Đang tạo bản nghe thử..." : "Nghe thử"}
						</Button>
						{dirty && !previewLoading ? (
							<p className="text-muted-foreground text-xs">
								Lưu cấu hình trước khi nghe thử.
							</p>
						) : null}
						{previewError ? (
							<p className="text-destructive text-sm" role="alert">
								{previewError}
							</p>
						) : null}
						{previewUrl ? (
							// biome-ignore lint/a11y/useMediaCaption: The preview transcript is provider-owned and is not exposed in Phase 3.
							<audio
								aria-label="Bản nghe thử giọng đọc"
								className="w-full"
								controls
								key={previewUrl}
								src={previewUrl}
							/>
						) : (
							<div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed bg-muted/30 p-5 text-center text-muted-foreground text-sm">
								{previewLoading
									? "Đang chuẩn bị audio..."
									: "Bản nghe thử sẽ xuất hiện ở đây."}
							</div>
						)}
						{statusMessage ? (
							<p
								aria-live="polite"
								className="text-muted-foreground text-xs"
								role="status"
							>
								{statusMessage}
							</p>
						) : null}
					</CardContent>
				</Card>
			</div>
		</section>
	);
}
