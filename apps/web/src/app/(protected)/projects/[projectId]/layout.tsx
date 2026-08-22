import { evaluateFactLockGate } from "@affichannel/core";
import type {
	PersistedProjectStepStatus,
	ProjectStepKey,
} from "@affichannel/core/project/project-types";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getProjectFixture } from "@/features/project-navigation/project-fixtures";
import ProjectStepper from "@/features/project-navigation/project-stepper";
import {
	getCurrentWorkspaceActor,
	getFactLockGateForCurrentUser,
	getProjectForCurrentUser,
	getVoiceStepSummaryForCurrentUser,
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
			<div className="mx-auto w-full max-w-6xl space-y-6">
				<ProjectStepper
					currentStepKey={fixture.currentStepKey}
					factLockGate={evaluateFactLockGate({
						currentScriptVersion: null,
						runs: [],
					})}
					projectId={fixture.id}
				/>
				{children}
			</div>
		);
	}

	const project = await getProjectForCurrentUser(projectId);

	if (!project) {
		notFound();
	}

	const factLockGate = await getFactLockGateForCurrentUser(project.id);
	const voiceSummary = await getVoiceStepSummaryForCurrentUser(project.id);

	const persistedStatuses = Object.fromEntries(
		project.stepStatuses.map((step) => [step.stepKey, step.status]),
	) as Record<ProjectStepKey, PersistedProjectStepStatus>;

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6">
			<ProjectStepper
				currentStepKey={project.currentStepKey}
				factLockGate={factLockGate ?? null}
				persistedStatuses={persistedStatuses}
				projectId={project.id}
				voiceReady={voiceSummary?.ready ?? false}
			/>
			{children}
		</div>
	);
}
