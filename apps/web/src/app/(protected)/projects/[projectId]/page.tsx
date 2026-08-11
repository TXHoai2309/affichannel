import { getProjectDetails } from "@affichannel/api/services/project-repository";
import { getWorkspaceActor } from "@affichannel/api/services/workspace";
import { auth } from "@affichannel/auth";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getProjectFixture } from "@/features/project-navigation/project-fixtures";

export default async function ProjectOverviewPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	const fixture = getProjectFixture(projectId);

	if (fixture) {
		redirect(`/projects/${fixture.id}/${fixture.currentStepKey}`);
	}

	const session = await auth.api.getSession({ headers: await headers() });
	const actor = session?.user
		? await getWorkspaceActor(session.user.id)
		: undefined;
	const project = actor
		? await getProjectDetails(actor.workspaceId, projectId)
		: undefined;

	if (!project) {
		notFound();
	}

	redirect(`/projects/${project.id}/${project.currentStepKey}`);
}
