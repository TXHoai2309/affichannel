import type { ProjectStepKey } from "@affichannel/core";

export const VIDEO_STUDIO_TAB_KEYS = [
	"content",
	"resources",
	"compose",
	"export",
] as const;

export type VideoStudioTabKey = (typeof VIDEO_STUDIO_TAB_KEYS)[number];

export const VIDEO_STUDIO_TABS = [
	{
		key: "content",
		label: "Content",
		description: "Nội dung, sản phẩm, claim và Fact Lock.",
	},
	{
		key: "resources",
		label: "Resources",
		description: "Media Library và các artifact tài nguyên của project.",
	},
	{
		key: "compose",
		label: "Compose",
		description: "CompositionVersion và preview đã được lưu.",
	},
	{
		key: "export",
		label: "Export",
		description: "Preflight, render status và output bất biến.",
	},
] as const satisfies readonly {
	key: VideoStudioTabKey;
	label: string;
	description: string;
}[];

/** Presentation-only mapping. These are existing persisted keys, never new DB values. */
export const PERSISTED_STEP_TO_VIDEO_STUDIO_TAB: Readonly<
	Record<ProjectStepKey, VideoStudioTabKey>
> = {
	product: "content",
	content: "content",
	"fact-lock": "content",
	voice: "resources",
	video: "compose",
	preview: "export",
	completed: "export",
};

export function isVideoStudioTabKey(
	value: string | null | undefined,
): value is VideoStudioTabKey {
	return (
		value !== null &&
		value !== undefined &&
		VIDEO_STUDIO_TAB_KEYS.includes(value as VideoStudioTabKey)
	);
}

export function resolveVideoStudioTab(
	value: string | null | undefined,
): VideoStudioTabKey {
	return isVideoStudioTabKey(value) ? value : "content";
}

export function mapPersistedStepToVideoStudioTab(
	stepKey: string,
): VideoStudioTabKey | null {
	return Object.hasOwn(PERSISTED_STEP_TO_VIDEO_STUDIO_TAB, stepKey)
		? PERSISTED_STEP_TO_VIDEO_STUDIO_TAB[stepKey as ProjectStepKey]
		: null;
}
