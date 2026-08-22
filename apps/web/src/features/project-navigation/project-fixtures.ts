import type { ProjectStepKey } from "./project-steps";

export type DemoProject = {
	id: string;
	name: string;
	productName: string;
	currentStepKey: ProjectStepKey;
	brief: {
		platform: "tiktok";
		goal: string;
		durationSeconds: number;
		angle: string;
		description: string | null;
	};
};

export const DEMO_PROJECT: DemoProject = {
	id: "demo",
	name: "Video Affiliate Tai nghe",
	productName: "Tai nghe không dây",
	currentStepKey: "fact-lock",
	brief: {
		platform: "tiktok",
		goal: "Tạo nội dung affiliate giới thiệu sản phẩm",
		durationSeconds: 30,
		angle: "Nêu trải nghiệm sử dụng thực tế",
		description: null,
	},
};

export function getProjectFixture(projectId: string) {
	if (process.env.NODE_ENV === "production") {
		return undefined;
	}

	return projectId === DEMO_PROJECT.id ? DEMO_PROJECT : undefined;
}
