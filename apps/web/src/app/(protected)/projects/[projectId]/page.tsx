import { notFound } from "next/navigation";

import { getProjectFixture } from "@/features/project-navigation/project-fixtures";
import ProjectOverview from "@/features/project-navigation/project-overview";
import {
	getAdaptiveWorkflowForCurrentUser,
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
		return (
			<ProjectOverview
				project={fixture}
				projectId={fixture.id}
				workflow={fixture.workflow}
			/>
		);
	}

	const [project, workflow] = await Promise.all([
		getProjectForCurrentUser(projectId),
		getAdaptiveWorkflowForCurrentUser(projectId),
	]);

	if (!project || !workflow) {
		notFound();
	}

	return (
		<ProjectOverview
			projectId={project.id}
			project={{
				name: project.name,
				productName: project.product.name,
				brief: project.brief,
			}}
			workflow={workflow}
		/>
	);
}
