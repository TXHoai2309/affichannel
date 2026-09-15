export const CENTER_ZOOM_IN_V1 = Object.freeze({
	kind: "CENTER_ZOOM_IN_V1",
	anchor: "CENTER",
	startScale: 1,
	endScale: 1.08,
	interpolation: "LINEAR_BY_FRAME",
	timing: "INTEGER_FRAME_INDEX",
	randomness: "NONE",
	pan: "NONE",
	customization: "NONE",
} as const);

export type QuickImageMotion = typeof CENTER_ZOOM_IN_V1;
