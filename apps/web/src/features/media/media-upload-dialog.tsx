"use client";

import { Button } from "@affichannel/ui/components/button";
import {
	Dialog,
	DialogBackdrop,
	DialogDescription,
	DialogPopup,
	DialogPortal,
	DialogTitle,
} from "@affichannel/ui/components/dialog";
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, FileUp, Loader2, UploadCloud } from "lucide-react";
import { useEffect, useReducer, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import {
	getMediaErrorMessage,
	getMediaFailureMessage,
	getMediaFileDetails,
	getMediaFilenameWithoutExtension,
	MEDIA_FILE_ACCEPT,
	mediaAssetUploadUrl,
	parseMediaTags,
} from "./media-library-helpers";

import {
	initialMediaUploadState,
	isTerminalMediaUploadError,
	type MediaPreparedUpload,
	type MediaUploadPhase,
	mediaUploadReducer,
} from "./media-upload-state";

const phaseCopy: Record<MediaUploadPhase, string> = {
	idle: "Chọn một tệp để bắt đầu.",
	preparing: "Đang chuẩn bị phiên tải lên...",
	uploading: "Đang tải tệp lên...",
	validating: "Đang kiểm tra tệp...",
	validating_wait:
		"Media vẫn đang được kiểm tra. Hãy kiểm tra lại khi sẵn sàng.",
	complete: "Media đã sẵn sàng trong thư viện.",
	error: "Tải lên chưa hoàn tất.",
};

export function MediaUploadDialog({
	open,
	onOpenChange,
	onCompleted,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCompleted: () => Promise<void> | void;
}) {
	const [file, setFile] = useState<File | null>(null);
	const [displayName, setDisplayName] = useState("");
	const [tagsInput, setTagsInput] = useState("");
	const [usageRights, setUsageRights] = useState<
		"owned" | "licensed" | "unknown" | "restricted"
	>("unknown");
	const [uploadState, dispatch] = useReducer(
		mediaUploadReducer,
		initialMediaUploadState,
	);
	const [error, setError] = useState<string | null>(null);
	const prepareUpload = useMutation(
		orpc.media.prepareUpload.mutationOptions({ retry: false }),
	);
	const finalizeUpload = useMutation(
		orpc.media.finalizeUpload.mutationOptions({ retry: false }),
	);
	const { phase } = uploadState;
	const isProcessing =
		phase === "preparing" || phase === "uploading" || phase === "validating";
	const isFormLocked = isProcessing || phase === "validating_wait";

	useEffect(() => {
		if (!open) return;
		setFile(null);
		setDisplayName("");
		setTagsInput("");
		setUsageRights("unknown");
		dispatch({ type: "reset" });
		setError(null);
	}, [open]);

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen && isProcessing) return;
		onOpenChange(nextOpen);
	}

	function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
		const nextFile = event.target.files?.[0] ?? null;
		setError(null);
		dispatch({ type: "reset" });
		if (!nextFile) {
			setFile(null);
			return;
		}
		const details = getMediaFileDetails(nextFile);
		if (!details) {
			setFile(null);
			setError(
				"Định dạng chưa được hỗ trợ. Chọn JPEG, PNG, WebP, MP4 hoặc MP3.",
			);
			return;
		}
		setFile(nextFile);
		setDisplayName(getMediaFilenameWithoutExtension(nextFile.name));
	}

	function createAttemptKey() {
		return typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID()
			: `media-upload-${Date.now()}-${Math.random().toString(36)}`;
	}

	function ensureAttemptKey() {
		if (uploadState.attemptKey) return uploadState.attemptKey;
		const nextKey = createAttemptKey();
		dispatch({ type: "set_attempt_key", attemptKey: nextKey });
		return nextKey;
	}

	function handleUploadError(uploadError: unknown, fallback: string) {
		dispatch({
			type: "put_failed",
			terminal: isTerminalMediaUploadError(uploadError),
		});
		setError(getMediaErrorMessage(uploadError, fallback));
	}

	async function requireUploadResponse(response: Response) {
		if (response.ok) return;
		let code: string | undefined;
		try {
			const payload: unknown = await response.clone().json();
			if (payload && typeof payload === "object") {
				const candidate = payload as { code?: unknown };
				if (typeof candidate.code === "string") code = candidate.code;
			}
		} catch {
			// Providers may return an empty/non-JSON error body.
		}
		if (!code) {
			code =
				response.status === 413
					? "MEDIA_ASSET_SIZE_LIMIT_EXCEEDED"
					: response.status === 400
						? "MEDIA_ASSET_UPLOAD_EXPIRED"
						: response.status === 401 ||
								response.status === 403 ||
								response.status === 409
							? "MEDIA_ASSET_UPLOAD_NOT_ALLOWED"
							: "MEDIA_ASSET_STORAGE_ERROR";
		}
		throw new Error(code);
	}

	async function finalizePreparedUpload(identity: MediaPreparedUpload) {
		dispatch({ type: "set_phase", phase: "validating" });
		const finalized = await finalizeUpload.mutateAsync(identity);
		if (finalized.outcome === "in_progress") {
			dispatch({ type: "finalize_in_progress" });
			setError(null);
			return;
		}
		if (finalized.asset.status !== "ready") {
			dispatch({ type: "finalize_failed" });
			setError(getMediaFailureMessage(finalized.asset));
			return;
		}
		dispatch({ type: "finalize_ready" });
		setError(null);
		try {
			await onCompleted();
			toast.success("Đã thêm media vào thư viện");
		} catch {
			toast.error("Media đã sẵn sàng nhưng danh sách chưa kịp cập nhật.");
		}
	}

	async function startUpload() {
		if (phase === "validating_wait" || phase === "complete") return;
		if (!file) {
			setError("Hãy chọn một tệp media trước.");
			return;
		}
		const details = getMediaFileDetails(file);
		if (!details) {
			setError(
				"Định dạng chưa được hỗ trợ. Chọn JPEG, PNG, WebP, MP4 hoặc MP3.",
			);
			return;
		}
		if (!displayName.trim()) {
			setError("Hãy đặt tên cho media.");
			return;
		}
		const idempotencyKey = ensureAttemptKey();
		setError(null);
		dispatch({ type: "set_phase", phase: "preparing" });
		try {
			const prepared = await prepareUpload.mutateAsync({
				mediaType: details.mediaType,
				originalFilename: file.name,
				displayName: displayName.trim(),
				declaredMimeType: details.mime,
				declaredByteSize: file.size,
				usageRights,
				tags: parseMediaTags(tagsInput),
				idempotencyKey,
			});
			const grant = prepared.uploadGrant;
			if (!grant) {
				throw new Error("MEDIA_ASSET_UPLOAD_NOT_ALLOWED");
			}
			const identity: MediaPreparedUpload = {
				assetId: prepared.assetId,
				uploadSessionId: prepared.uploadSessionId,
			};
			dispatch({ type: "prepared", prepared: identity });
			const uploadResponse = await fetch(mediaAssetUploadUrl(grant), {
				method: "PUT",
				headers: grant.contentType
					? { "content-type": grant.contentType }
					: { "content-type": details.mime },
				body: file,
				credentials: grant.provider === "r2" ? "omit" : "include",
			});
			await requireUploadResponse(uploadResponse);
			await finalizePreparedUpload(identity);
		} catch (uploadError) {
			handleUploadError(uploadError, "Tải lên không thành công. Hãy thử lại.");
		}
	}

	async function recheckFinalize() {
		if (!uploadState.prepared || isProcessing) return;
		setError(null);
		try {
			await finalizePreparedUpload(uploadState.prepared);
		} catch (finalizeError) {
			handleUploadError(
				finalizeError,
				"Không thể kiểm tra trạng thái media. Hãy thử lại.",
			);
		}
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogPortal>
				<DialogBackdrop />
				<DialogPopup className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
					<div className="flex items-start gap-3">
						<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-affi-blue-soft text-affi-blue">
							<UploadCloud aria-hidden="true" className="size-5" />
						</span>
						<div>
							<DialogTitle>Tải media lên</DialogTitle>
							<DialogDescription>
								Một lần tải lên tạo một asset mới và chỉ hoàn tất sau khi server
								kiểm tra xong.
							</DialogDescription>
						</div>
					</div>

					<div className="mt-6 space-y-4">
						<div className="space-y-2">
							<Label htmlFor="media-file">Tệp media</Label>
							<Input
								accept={MEDIA_FILE_ACCEPT}
								disabled={isFormLocked}
								id="media-file"
								onChange={handleFileChange}
								type="file"
							/>
							<p className="text-muted-foreground text-xs">
								Hỗ trợ JPEG, PNG, WebP, MP4 và MP3. Server vẫn là nơi kiểm tra
								cuối cùng.
							</p>
							{file ? (
								<p className="flex items-center gap-2 text-foreground text-xs">
									<FileUp
										aria-hidden="true"
										className="size-3.5 text-affi-blue"
									/>
									<span className="truncate">{file.name}</span>
									<span className="text-muted-foreground">
										({file.size.toLocaleString("vi-VN")} B)
									</span>
								</p>
							) : null}
						</div>

						<div className="space-y-2">
							<Label htmlFor="media-display-name">Tên hiển thị</Label>
							<Input
								disabled={isFormLocked}
								id="media-display-name"
								maxLength={240}
								onChange={(event) => setDisplayName(event.target.value)}
								placeholder="Ví dụ: Hero mùa hè"
								value={displayName}
							/>
						</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="media-rights">Quyền sử dụng</Label>
								<select
									className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
									disabled={isFormLocked}
									id="media-rights"
									onChange={(event) =>
										setUsageRights(
											event.target.value as
												| "owned"
												| "licensed"
												| "unknown"
												| "restricted",
										)
									}
									value={usageRights}
								>
									<option value="unknown">Chưa xác minh</option>
									<option value="owned">Sở hữu</option>
									<option value="licensed">Đã cấp phép</option>
									<option value="restricted">Hạn chế</option>
								</select>
							</div>
							<div className="space-y-2">
								<Label htmlFor="media-tags">Tags</Label>
								<Input
									disabled={isFormLocked}
									id="media-tags"
									onChange={(event) => setTagsInput(event.target.value)}
									placeholder="campaign, launch"
									value={tagsInput}
								/>
							</div>
						</div>
					</div>

					<div
						aria-live="polite"
						className={[
							"mt-5 rounded-xl border px-3 py-2.5 text-xs",
							error
								? "border-destructive/30 bg-destructive/5 text-destructive"
								: phase === "complete"
									? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
									: "border-affi-blue-border bg-affi-blue-soft/50 text-muted-foreground",
						].join(" ")}
						role={error ? "alert" : "status"}
					>
						<div className="flex items-center gap-2">
							{isProcessing ? (
								<Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
							) : null}
							{phase === "complete" ? (
								<CheckCircle2 aria-hidden="true" className="size-3.5" />
							) : null}
							<span>{error ?? phaseCopy[phase]}</span>
						</div>
					</div>

					<div className="mt-6 flex flex-col-reverse justify-end gap-2 sm:flex-row">
						<Button
							disabled={isProcessing}
							onClick={() => handleOpenChange(false)}
							variant="outline"
						>
							{phase === "complete" ? "Đóng" : "Hủy"}
						</Button>
						<Button
							disabled={isProcessing || phase === "complete" || !file}
							onClick={() =>
								void (phase === "validating_wait"
									? recheckFinalize()
									: startUpload())
							}
						>
							{phase === "validating_wait"
								? "Kiểm tra lại"
								: isProcessing
									? "Đang xử lý..."
									: phase === "error"
										? "Thử lại"
										: "Tải lên"}
						</Button>
					</div>
				</DialogPopup>
			</DialogPortal>
		</Dialog>
	);
}
