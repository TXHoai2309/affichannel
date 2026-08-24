import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getProjectFixture } from "@/features/project-navigation/project-fixtures";
import ProjectStepper from "@/features/project-navigation/project-stepper";
import {
	getAdaptiveWorkflowForCurrentUser,
	getCurrentWorkspaceActor,
} from "@/lib/project-loader";

export default async function ProjectLayout({
	children,
	params,
}: {
	children: ReactNode;
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
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
				<ProjectStepper projectId={fixture.id} workflow={fixture.workflow} />
				{children}
			</div>
		);
	}

	const workflow = await getAdaptiveWorkflowForCurrentUser(projectId);

	if (!workflow) {
		notFound();
	}

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
			<ProjectStepper projectId={projectId} workflow={workflow} />
			{children}
		</div>
	);
}
