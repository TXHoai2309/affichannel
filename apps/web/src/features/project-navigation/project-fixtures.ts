import {
	type AdaptiveWorkflowReadModel,
	mapAdaptiveWorkflowReadModel,
	type ProjectApplicabilityInput,
	resolveProjectApplicability,
} from "@affichannel/core";

export type DemoProject = {
	id: string;
	name: string;
	productName: string;
	workflow: AdaptiveWorkflowReadModel;
	brief: {
		platform: "tiktok";
		goal: string;
		durationSeconds: number;
		angle: string;
		description: string | null;
	};
};

function createDemoWorkflow() {
	const input: ProjectApplicabilityInput = {
		projectIdentity: {
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
			hasProduct: true,
		},
		product: { accessible: true },
		script: {
			generationStatus: "USABLE",
			usableGenerationPresent: true,
			sourceDependencyCurrent: true,
			currentVersionPresent: true,
			currentVersionFactLockReady: true,
			channelSettingsComplete: true,
			productFactsUsable: true,
		},
		factLock: { gateReason: "FACT_LOCK_NOT_RUN" },
		voice: {
			configPresent: false,
			previewPresent: false,
			totalSegments: 0,
			attemptedSegments: 0,
			usableSegments: 0,
			pendingSegments: 0,
			failedSegments: 0,
			indeterminateSegments: 0,
			staleSegments: 0,
		},
		render: { featureImplemented: false, inputsStale: false },
	};
	return mapAdaptiveWorkflowReadModel(resolveProjectApplicability(input));
}

export const DEMO_PROJECT: DemoProject = {
	id: "demo",
	name: "Video Affiliate Tai nghe",
	productName: "Tai nghe không dây",
	workflow: createDemoWorkflow(),
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
