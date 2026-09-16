export type QuickImagePlaybackStatus = "paused" | "playing" | "ended";

export type QuickImagePlaybackState = Readonly<{
	status: QuickImagePlaybackStatus;
	currentFrame: number;
}>;

export type QuickImagePlaybackAction =
	| { type: "play" }
	| { type: "pause" }
	| { type: "replay" }
	| { type: "reset" }
	| { type: "finish" }
	| { type: "tick"; frameIndex: number };

export function createQuickImagePlaybackState(): QuickImagePlaybackState {
	return { status: "paused", currentFrame: 0 };
}

function clampFrame(frameIndex: number, totalFrames: number) {
	const finalFrame = Math.max(0, totalFrames - 1);
	return Math.min(finalFrame, Math.max(0, frameIndex));
}

export function reduceQuickImagePlaybackState(
	state: QuickImagePlaybackState,
	action: QuickImagePlaybackAction,
	totalFrames: number,
): QuickImagePlaybackState {
	switch (action.type) {
		case "play":
			return state.status === "ended" || state.status === "playing"
				? state
				: { ...state, status: "playing" };
		case "pause":
			return state.status === "playing"
				? { ...state, status: "paused" }
				: state;
		case "replay":
			return { status: "playing", currentFrame: 0 };
		case "reset":
			return createQuickImagePlaybackState();
		case "finish":
			return {
				status: "ended",
				currentFrame: Math.max(0, totalFrames - 1),
			};
		case "tick":
			if (state.status !== "playing") return state;
			return {
				status: "playing",
				currentFrame: clampFrame(action.frameIndex, totalFrames),
			};
	}
}
