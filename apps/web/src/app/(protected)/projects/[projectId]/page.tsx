import { notFound, redirect } from "next/navigation";

import { getProjectFixture } from "@/features/project-navigation/project-fixtures";
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
		redirect(`/projects/${fixture.id}/${fixture.currentStepKey}`);
	}

	const project = await getProjectForCurrentUser(projectId);

	if (!project) {
		notFound();
	}

	redirect(`/projects/${project.id}/${project.currentStepKey}`);
}
