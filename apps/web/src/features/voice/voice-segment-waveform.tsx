"use client";

import type { VoiceSegmentArtifact } from "@affichannel/core";
import { cn } from "@affichannel/ui/lib/utils";
import { useEffect, useState } from "react";

import {
	buildVoiceSegmentAudioUrl,
	calculateWaveformPeaks,
	VOICE_SEGMENT_WAVEFORM_BAR_COUNT,
	waveformCacheKey,
} from "./voice-segment-studio-state";

const waveformPeaksCache = new Map<string, Promise<number[]>>();

type BrowserAudioContextConstructor = new () => AudioContext;
type BrowserWindow = Window & {
	AudioContext?: BrowserAudioContextConstructor;
	webkitAudioContext?: BrowserAudioContextConstructor;
};

function getAudioContextConstructor(): BrowserAudioContextConstructor {
	const browserWindow = window as BrowserWindow;
	const AudioContextConstructor =
		browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
	if (!AudioContextConstructor) {
		throw new Error("AudioContext is unavailable.");
	}
	return AudioContextConstructor;
}

async function decodeWaveform(
	url: string,
	signal: AbortSignal,
): Promise<number[]> {
	const response = await fetch(url, {
		credentials: "include",
		signal,
	});
	if (!response.ok) {
		throw new Error(`Audio request failed with status ${response.status}.`);
	}
	const bytes = await response.arrayBuffer();
	if (signal.aborted) throw new DOMException("Aborted", "AbortError");

	const AudioContextConstructor = getAudioContextConstructor();
	const context = new AudioContextConstructor();
	try {
		const decoded = await context.decodeAudioData(bytes.slice(0));
		const samples = new Float32Array(decoded.length);
		for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
			const channelSamples = decoded.getChannelData(channel);
			for (let index = 0; index < decoded.length; index += 1) {
				samples[index] += channelSamples[index] ?? 0;
			}
		}
		return calculateWaveformPeaks(samples);
	} finally {
		await context.close().catch(() => undefined);
	}
}

function getOrCreateWaveformPromise(
	cacheKey: string,
	url: string,
	signal: AbortSignal,
) {
	const cached = waveformPeaksCache.get(cacheKey);
	if (cached) return cached;
	const promise = decodeWaveform(url, signal);
	waveformPeaksCache.set(cacheKey, promise);
	void promise.catch(() => {
		if (waveformPeaksCache.get(cacheKey) === promise) {
			waveformPeaksCache.delete(cacheKey);
		}
	});
	return promise;
}

export function VoiceSegmentWaveform({
	projectId,
	artifact,
}: {
	projectId: string;
	artifact: VoiceSegmentArtifact;
}) {
	const cacheKey = waveformCacheKey(artifact.id, artifact.checksum);
	const audioUrl = buildVoiceSegmentAudioUrl(projectId, artifact.id);
	const [peaks, setPeaks] = useState<number[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const controller = new AbortController();
		let active = true;
		setPeaks(null);
		setLoading(true);
		setFailed(false);

		getOrCreateWaveformPromise(cacheKey, audioUrl, controller.signal)
			.then((nextPeaks) => {
				if (!active) return;
				setPeaks(nextPeaks);
				setLoading(false);
			})
			.catch((error: unknown) => {
				if (!active || controller.signal.aborted) return;
				setFailed(true);
				setLoading(false);
				void error;
			});

		return () => {
			active = false;
			controller.abort();
		};
	}, [audioUrl, cacheKey]);

	if (failed) {
		return (
			<p
				className="text-muted-foreground text-xs"
				data-testid="waveform-fallback"
			>
				Waveform không khả dụng, player audio vẫn có thể sử dụng.
			</p>
		);
	}

	const renderedPeaks =
		peaks ?? new Array(VOICE_SEGMENT_WAVEFORM_BAR_COUNT).fill(0.12);
	return (
		<div
			aria-busy={loading}
			aria-hidden="true"
			className="flex h-12 items-center gap-0.5 overflow-hidden rounded-lg border bg-muted/30 px-2"
			data-testid="voice-segment-waveform"
		>
			<div
				aria-hidden="true"
				className="flex h-full w-full items-center gap-0.5"
			>
				{renderedPeaks.map((peak, index) => (
					<span
						className={cn(
							"min-w-0 flex-1 rounded-full bg-primary/65 transition-[height]",
							loading && "animate-pulse bg-muted-foreground/25",
						)}
						key={`${cacheKey}-${index}`}
						style={{ height: `${Math.max(peak * 100, 8)}%` }}
					/>
				))}
			</div>
		</div>
	);
}
