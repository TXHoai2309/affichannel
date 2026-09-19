"use client";

import type { CompositionPreviewDescriptorV2 } from "@affichannel/core";
import {
	resolveQuickImageCoverGeometry,
	resolveQuickImageFrameIndex,
	resolveQuickImageZoomForFrame,
} from "@affichannel/core";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { Pause, Play, RotateCcw } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import QuickImageRenderController from "../render/quick-image-render-controller";
import {
	createQuickImagePlaybackState,
	type QuickImagePlaybackAction,
	type QuickImagePlaybackState,
	reduceQuickImagePlaybackState,
} from "./quick-image-preview-player-state";

type ImageLoadState = "loading" | "ready" | "error";

export function getQuickImagePreviewDependencyUrl(token: string) {
	return `/api/compositions/preview/dependencies/${encodeURIComponent(token)}`;
}

function formatPreviewTime(seconds: number) {
	const minutes = Math.floor(seconds / 60);
	const remainder = (seconds % 60).toFixed(2).padStart(5, "0");
	return `${minutes}:${remainder}`;
}

function imageStyleForGeometry(
	geometry: NonNullable<ReturnType<typeof resolveQuickImageCoverGeometry>>,
	profile: CompositionPreviewDescriptorV2["profile"],
): CSSProperties {
	return {
		height: `${(geometry.renderedHeight / profile.logicalHeight) * 100}%`,
		left: `${(geometry.x / profile.logicalWidth) * 100}%`,
		top: `${(geometry.y / profile.logicalHeight) * 100}%`,
		width: `${(geometry.renderedWidth / profile.logicalWidth) * 100}%`,
	};
}

export default function QuickImagePreviewPlayer({
	descriptor,
	projectId,
}: {
	descriptor: CompositionPreviewDescriptorV2;
	projectId?: string;
}) {
	const totalFrames = descriptor.timeline.totalFrames;
	const imageIdentity = `${descriptor.compositionVersionId}:${descriptor.dependency.token}`;
	const dependencyUrl = getQuickImagePreviewDependencyUrl(
		descriptor.dependency.token,
	);
	const [imageState, setImageState] = useState<ImageLoadState>("loading");
	const [playback, dispatch] = useReducer(
		(state: QuickImagePlaybackState, action: QuickImagePlaybackAction) =>
			reduceQuickImagePlaybackState(state, action, totalFrames),
		createQuickImagePlaybackState(),
	);
	const [playbackRevision, setPlaybackRevision] = useState(0);
	const playbackRef = useRef(playback);
	const playbackRevisionRef = useRef(playbackRevision);
	const imageIdentityRef = useRef(imageIdentity);
	const rafRef = useRef<number | null>(null);
	const playbackOriginRef = useRef({ elapsedSeconds: 0, startedAt: 0 });

	imageIdentityRef.current = imageIdentity;
	playbackRevisionRef.current = playbackRevision;

	const cancelScheduledFrame = useCallback(() => {
		if (rafRef.current === null) return;
		window.cancelAnimationFrame(rafRef.current);
		rafRef.current = null;
	}, []);

	const dispatchPlayback = useCallback(
		(action: QuickImagePlaybackAction) => {
			const next = reduceQuickImagePlaybackState(
				playbackRef.current,
				action,
				totalFrames,
			);
			playbackRef.current = next;
			dispatch(action);
		},
		[totalFrames],
	);

	useEffect(() => {
		cancelScheduledFrame();
		imageIdentityRef.current = imageIdentity;
		playbackRef.current = createQuickImagePlaybackState();
		dispatch({ type: "reset" });
		setImageState("loading");
		setPlaybackRevision((revision) => revision + 1);
	}, [cancelScheduledFrame, imageIdentity]);

	useEffect(() => {
		playbackRef.current = playback;
	}, [playback]);

	useEffect(() => {
		if (
			imageState !== "ready" ||
			playback.status !== "playing" ||
			playbackRef.current.status !== "playing"
		)
			return;

		let active = true;
		const loopRevision = playbackRevision;
		const { elapsedSeconds: originElapsedSeconds, startedAt } =
			playbackOriginRef.current;

		const tick = (timestamp: number) => {
			if (
				!active ||
				playbackRef.current.status !== "playing" ||
				playbackRevisionRef.current !== loopRevision
			)
				return;
			const elapsedSeconds =
				originElapsedSeconds + Math.max(0, (timestamp - startedAt) / 1000);
			const frameIndex = resolveQuickImageFrameIndex({
				elapsedSeconds,
				totalFrames,
				fps: descriptor.timeline.fps,
			});
			if (frameIndex === null) {
				cancelScheduledFrame();
				dispatchPlayback({ type: "pause" });
				return;
			}

			if (frameIndex !== playbackRef.current.currentFrame)
				dispatchPlayback({ type: "tick", frameIndex });

			if (elapsedSeconds >= descriptor.timeline.durationSeconds) {
				dispatchPlayback({ type: "finish" });
				cancelScheduledFrame();
				return;
			}
			rafRef.current = window.requestAnimationFrame(tick);
		};

		rafRef.current = window.requestAnimationFrame(tick);
		return () => {
			active = false;
			cancelScheduledFrame();
		};
	}, [
		cancelScheduledFrame,
		descriptor.timeline.durationSeconds,
		descriptor.timeline.fps,
		imageState,
		playback.status,
		playbackRevision,
		totalFrames,
		dispatchPlayback,
	]);

	const handlePlay = () => {
		if (imageState !== "ready" || playbackRef.current.status !== "paused")
			return;
		playbackOriginRef.current = {
			elapsedSeconds:
				playbackRef.current.currentFrame / descriptor.timeline.fps.numerator,
			startedAt: performance.now(),
		};
		dispatchPlayback({ type: "play" });
		setPlaybackRevision((revision) => revision + 1);
	};

	const handlePause = () => {
		if (playbackRef.current.status !== "playing") return;
		cancelScheduledFrame();
		dispatchPlayback({ type: "pause" });
	};

	const handleReplay = () => {
		cancelScheduledFrame();
		if (imageState !== "ready") {
			dispatchPlayback({ type: "reset" });
			return;
		}
		playbackOriginRef.current = {
			elapsedSeconds: 0,
			startedAt: performance.now(),
		};
		dispatchPlayback({ type: "replay" });
		setPlaybackRevision((revision) => revision + 1);
	};

	const handleImageLoad = () => {
		if (imageIdentityRef.current !== imageIdentity) return;
		setImageState("ready");
	};

	const handleImageError = () => {
		if (imageIdentityRef.current !== imageIdentity) return;
		cancelScheduledFrame();
		dispatchPlayback({ type: "pause" });
		setImageState("error");
	};

	const geometry = resolveQuickImageCoverGeometry({
		frameIndex: playback.currentFrame,
		totalFrames,
		sourceWidth: descriptor.source.width,
		sourceHeight: descriptor.source.height,
		profile: descriptor.profile,
	});
	const zoom = resolveQuickImageZoomForFrame(
		playback.currentFrame,
		totalFrames,
	);
	const currentSeconds =
		playback.status === "ended"
			? descriptor.timeline.durationSeconds
			: playback.currentFrame / descriptor.timeline.fps.numerator;
	const geometryError = geometry === null || zoom === null;

	return (
		<Card data-testid="quick-image-preview-player">
			<CardHeader>
				<CardTitle>Quick Image preview</CardTitle>
				<CardDescription>
					Frozen CompositionVersion {descriptor.compositionVersionId}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div
					aria-busy={imageState === "loading"}
					className="relative mx-auto aspect-[9/16] w-full max-w-sm overflow-hidden rounded-2xl bg-muted"
					data-frame-index={playback.currentFrame}
					data-playback-state={playback.status}
					data-preview-zoom={zoom ?? ""}
					data-testid="quick-image-preview-viewport"
				>
					{imageState !== "error" && geometry ? (
						<img
							alt="Frozen preview frame"
							className="pointer-events-none absolute max-w-none select-none"
							decoding="async"
							draggable={false}
							onError={handleImageError}
							onLoad={handleImageLoad}
							src={dependencyUrl}
							style={imageStyleForGeometry(geometry, descriptor.profile)}
						/>
					) : null}
					{imageState === "loading" ? (
						<p
							aria-live="polite"
							className="absolute inset-0 flex items-center justify-center bg-background/60 p-4 text-center text-muted-foreground text-sm"
							role="status"
						>
							Đang tải preview đã khóa...
						</p>
					) : imageState === "error" || geometryError ? (
						<p
							aria-live="assertive"
							className="absolute inset-0 flex items-center justify-center bg-background p-4 text-center text-destructive text-sm"
							role="alert"
						>
							Không thể tải preview Quick Image này.
						</p>
					) : null}
				</div>

				<div
					aria-live="polite"
					className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs"
					data-testid="quick-image-preview-progress"
				>
					<span>
						{formatPreviewTime(currentSeconds)} /{" "}
						{formatPreviewTime(descriptor.timeline.durationSeconds)}
					</span>
					<span>
						Frame {playback.currentFrame + 1} / {totalFrames}
					</span>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Button
						aria-label="Phát preview Quick Image"
						disabled={imageState !== "ready" || playback.status !== "paused"}
						onClick={handlePlay}
						variant="default"
					>
						<Play aria-hidden="true" />
						Phát
					</Button>
					<Button
						aria-label="Tạm dừng preview Quick Image"
						disabled={imageState !== "ready" || playback.status !== "playing"}
						onClick={handlePause}
						variant="outline"
					>
						<Pause aria-hidden="true" />
						Tạm dừng
					</Button>
					<Button
						aria-label="Phát lại preview Quick Image"
						disabled={imageState !== "ready"}
						onClick={handleReplay}
						variant="outline"
					>
						<RotateCcw aria-hidden="true" />
						Phát lại
					</Button>
				</div>
				<p
					className="text-muted-foreground text-xs"
					data-testid="quick-image-preview-status"
				>
					Trạng thái:{" "}
					{playback.status === "playing"
						? "Đang phát"
						: playback.status === "ended"
							? "Đã kết thúc"
							: "Đang tạm dừng"}
				</p>
				{projectId ? (
					<QuickImageRenderController
						compositionVersionId={descriptor.compositionVersionId}
						projectId={projectId}
					/>
				) : null}
			</CardContent>
		</Card>
	);
}
