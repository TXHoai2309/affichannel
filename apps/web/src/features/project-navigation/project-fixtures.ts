import type { ProjectStepKey } from "./project-steps";

export type DemoProject = {
	id: string;
	name: string;
	productName: string;
	currentStepKey: ProjectStepKey;
};

export const DEMO_PROJECT: DemoProject = {
	id: "demo",
	name: "Video Affiliate Tai nghe",
	productName: "Tai nghe không dây",
	currentStepKey: "fact-lock",
};

export function getProjectFixture(projectId: string) {
	if (process.env.NODE_ENV === "production") {
		return undefined;
	}

	return projectId === DEMO_PROJECT.id ? DEMO_PROJECT : undefined;
}
