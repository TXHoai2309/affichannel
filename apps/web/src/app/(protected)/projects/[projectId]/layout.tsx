import { getProjectDetails } from "@affichannel/api/services/project-repository";
import { getWorkspaceActor } from "@affichannel/api/services/workspace";
import { auth } from "@affichannel/auth";
import type {
	PersistedProjectStepStatus,
	ProjectStepKey,
} from "@affichannel/core/project/project-types";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getProjectFixture } from "@/features/project-navigation/project-fixtures";
import ProjectStepper from "@/features/project-navigation/project-stepper";

export default async function ProjectLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	const fixture = getProjectFixture(projectId);

	if (fixture) {
		return (
			<div className="mx-auto w-full max-w-6xl space-y-6">
				<ProjectStepper
					currentStepKey={fixture.currentStepKey}
					projectId={fixture.id}
				/>
				{children}
			</div>
		);
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

	const persistedStatuses = Object.fromEntries(
		project.stepStatuses.map((step) => [step.stepKey, step.status]),
	) as Record<ProjectStepKey, PersistedProjectStepStatus>;

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6">
			<ProjectStepper
				currentStepKey={project.currentStepKey}
				persistedStatuses={persistedStatuses}
				projectId={project.id}
			/>
			{children}
		</div>
	);
}
