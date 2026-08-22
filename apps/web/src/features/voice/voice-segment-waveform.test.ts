import { describe, expect, it, vi } from "vitest";

import {
	clearWaveformPeaksCache,
	loadWaveformPeaks,
} from "./voice-segment-waveform";

class FakeAudioBuffer {
	readonly length = 4;
	readonly numberOfChannels = 1;
	getChannelData() {
		return new Float32Array([0, 0.5, -1, 0.25]);
	}
}

class FakeAudioContext {
	async decodeAudioData() {
		return new FakeAudioBuffer() as unknown as AudioBuffer;
	}
	async close() {}
}

describe("VoiceSegmentWaveform cache", () => {
	it("shares an owned loader across aborted consumers and caches resolved peaks", async () => {
		clearWaveformPeaksCache();
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
		const previousWindow = globalThis.window;
		Object.assign(globalThis, {
			window: { AudioContext: FakeAudioContext },
		});

		try {
			const first = loadWaveformPeaks("artifact/checksum", "/audio");
			// Consumer A unmounting only stops its state update; it cannot abort the
			// shared decode owned by the cache.
			const second = loadWaveformPeaks("artifact/checksum", "/audio");
			const [firstPeaks, secondPeaks] = await Promise.all([first, second]);
			expect(firstPeaks).toEqual(secondPeaks);
			expect(fetchMock).toHaveBeenCalledTimes(1);

			const third = await loadWaveformPeaks("artifact/checksum", "/audio");
			expect(third).toEqual(firstPeaks);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		} finally {
			Object.assign(globalThis, { window: previousWindow });
			fetchMock.mockRestore();
			clearWaveformPeaksCache();
		}
	});

	it("does not permanently cache a failed decode", async () => {
		clearWaveformPeaksCache();
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValueOnce(new Error("temporary decode failure"))
			.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
		const previousWindow = globalThis.window;
		Object.assign(globalThis, {
			window: { AudioContext: FakeAudioContext },
		});

		try {
			await expect(
				loadWaveformPeaks("retry/checksum", "/audio"),
			).rejects.toThrow("temporary decode failure");
			await expect(
				loadWaveformPeaks("retry/checksum", "/audio"),
			).resolves.toHaveLength(48);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
			Object.assign(globalThis, { window: previousWindow });
			fetchMock.mockRestore();
			clearWaveformPeaksCache();
		}
	});
});
