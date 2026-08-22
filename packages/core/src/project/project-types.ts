export const PROJECT_STEP_KEYS = [
	"product",
	"content",
	"fact-lock",
	"voice",
	"video",
	"preview",
	"completed",
] as const;

export type ProjectStepKey = (typeof PROJECT_STEP_KEYS)[number];

export const PERSISTED_PROJECT_STEP_STATUSES = [
	"completed",
	"needs_review",
	"blocked",
	"not_started",
] as const;

export type PersistedProjectStepStatus =
	(typeof PERSISTED_PROJECT_STEP_STATUSES)[number];

export const CONTENT_BRIEF_PLATFORMS = ["tiktok"] as const;

export type ContentBriefPlatform = (typeof CONTENT_BRIEF_PLATFORMS)[number];

export function isProjectStepKey(value: string): value is ProjectStepKey {
	return PROJECT_STEP_KEYS.some((stepKey) => stepKey === value);
}

export function getProjectStepRoute(
	projectId: string,
	stepKey: ProjectStepKey,
) {
	return `/projects/${projectId}/${stepKey}`;
}
