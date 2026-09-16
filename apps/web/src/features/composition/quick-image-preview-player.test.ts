import { CENTER_ZOOM_IN_V1 } from "@affichannel/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import QuickImagePreviewPlayer, {
	getQuickImagePreviewDependencyUrl,
} from "./quick-image-preview-player";
import {
	createQuickImagePlaybackState,
	reduceQuickImagePlaybackState,
} from "./quick-image-preview-player-state";

const descriptor = {
	schemaVersion: "composition-preview-descriptor.v2",
	access: "protected",
	compositionVersionId: "composition-version-a",
	compositionFingerprint: "a".repeat(64),
	sourceKind: "QUICK_IMAGE",
	profile: {
		id: "vertical-standard-v1",
		logicalWidth: 1080,
		logicalHeight: 1920,
		aspectRatio: "9:16",
	},
	timeline: {
		durationSeconds: 5,
		fps: { numerator: 30, denominator: 1 },
		totalFrames: 150,
	},
	motion: CENTER_ZOOM_IN_V1,
	source: {
		width: 800,
		height: 600,
		mimeType: "image/png",
	},
	dependency: {
		dependencyKey: "quick-image-source",
		token: "opaque/token?value=1",
		contentType: "image/png",
		byteSize: 3,
		checksum: "b".repeat(64),
		expiresAt: "2026-01-01T00:01:00.000Z",
	},
} as const;

describe("Quick Image browser preview player", () => {
	it("renders one protected dependency in the initial paused frame", () => {
		const markup = renderToStaticMarkup(
			createElement(QuickImagePreviewPlayer, { descriptor }),
		);

		expect(markup).toContain('data-playback-state="paused"');
		expect(markup).toContain('data-frame-index="0"');
		expect(markup).toContain('data-preview-zoom="1"');
		expect(markup).toContain('class="relative mx-auto aspect-[9/16]');
		expect(markup.match(/<img\b/g)).toHaveLength(1);
		expect(markup).toContain(
			`src="${getQuickImagePreviewDependencyUrl(descriptor.dependency.token)}"`,
		);
		expect(markup).toContain("Đang tải preview đã khóa");
		expect(markup).not.toContain("autoplay");
	});

	it("keeps playback deterministic across play, pause, resume, end, and replay", () => {
		let state = createQuickImagePlaybackState();
		state = reduceQuickImagePlaybackState(state, { type: "play" }, 150);
		expect(reduceQuickImagePlaybackState(state, { type: "play" }, 150)).toBe(
			state,
		);
		state = reduceQuickImagePlaybackState(
			state,
			{ type: "tick", frameIndex: 45 },
			150,
		);
		expect(state).toEqual({ status: "playing", currentFrame: 45 });

		state = reduceQuickImagePlaybackState(state, { type: "pause" }, 150);
		expect(state).toEqual({ status: "paused", currentFrame: 45 });
		expect(
			reduceQuickImagePlaybackState(
				state,
				{ type: "tick", frameIndex: 90 },
				150,
			),
		).toEqual(state);

		state = reduceQuickImagePlaybackState(state, { type: "play" }, 150);
		state = reduceQuickImagePlaybackState(
			state,
			{ type: "tick", frameIndex: 149 },
			150,
		);
		expect(state).toEqual({ status: "playing", currentFrame: 149 });
		state = reduceQuickImagePlaybackState(state, { type: "finish" }, 150);
		expect(state).toEqual({ status: "ended", currentFrame: 149 });

		state = reduceQuickImagePlaybackState(state, { type: "replay" }, 150);
		expect(state).toEqual({ status: "playing", currentFrame: 0 });
	});

	it("does not expose a raw storage key through the browser URL", () => {
		const url = getQuickImagePreviewDependencyUrl("opaque-token");
		expect(url).toBe("/api/compositions/preview/dependencies/opaque-token");
		expect(url).not.toContain("storage");
	});
});
