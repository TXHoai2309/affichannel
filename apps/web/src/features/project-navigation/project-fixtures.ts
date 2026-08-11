export type DemoProject = {
	id: string;
	name: string;
	productName: string;
};

export const DEMO_PROJECT: DemoProject = {
	id: "demo",
	name: "Video Affiliate Tai nghe",
	productName: "Tai nghe không dây",
};

export function getProjectFixture(projectId: string) {
	return projectId === DEMO_PROJECT.id ? DEMO_PROJECT : undefined;
}
