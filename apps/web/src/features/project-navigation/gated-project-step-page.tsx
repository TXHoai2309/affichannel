import type { ReactNode } from "react";

import { getAdaptiveWorkflowForCurrentUser } from "@/lib/project-loader";
import type { AdaptiveProjectRouteKey } from "./adaptive-workflow-presentation";
import { getProjectFixture } from "./project-fixtures";
import ProjectStepPage from "./project-step-page";

export default async function GatedProjectStepPage({
	projectId,
	stepKey,
	children,
}: {
	projectId: string;
	stepKey: AdaptiveProjectRouteKey;
	children?: ReactNode;
}) {
	const workflow =
		getProjectFixture(projectId)?.workflow ??
		(await getAdaptiveWorkflowForCurrentUser(projectId));
	if (!workflow) return null;

	return (
		<ProjectStepPage
			content={children}
			projectId={projectId}
			stepKey={stepKey}
			workflow={workflow}
		/>
	);
}
