import { notFound } from "next/navigation";

import { getProjectFixture } from "@/features/project-navigation/project-fixtures";
import ProjectOverview from "@/features/project-navigation/project-overview";
import {
	getCurrentWorkspaceActor,
	getProjectForCurrentUser,
} from "@/lib/project-loader";

export default async function ProjectOverviewPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	const actor = await getCurrentWorkspaceActor();

	if (!actor) {
		notFound();
	}

	const fixture = getProjectFixture(projectId);

	if (fixture) {
		return <ProjectOverview project={fixture} />;
	}

	const project = await getProjectForCurrentUser(projectId);

	if (!project) {
		notFound();
	}

	return (
		<ProjectOverview
			project={{
				name: project.name,
				productName: project.product.name,
				currentStepKey: project.currentStepKey,
				brief: project.brief,
			}}
		/>
	);
}
