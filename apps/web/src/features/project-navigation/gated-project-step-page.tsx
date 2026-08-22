import { evaluateFactLockGate } from "@affichannel/core";
import type { ReactNode } from "react";

import {
	getFactLockGateForCurrentUser,
	getVoiceStepSummaryForCurrentUser,
} from "@/lib/project-loader";
import { getProjectFixture } from "./project-fixtures";
import ProjectStepPage from "./project-step-page";
import type { ProjectStepKey } from "./project-steps";

export default async function GatedProjectStepPage({
	projectId,
	stepKey,
	children,
}: {
	projectId: string;
	stepKey: Extract<ProjectStepKey, "voice" | "video" | "preview">;
	children?: ReactNode;
}) {
	const gate = getProjectFixture(projectId)
		? evaluateFactLockGate({ currentScriptVersion: null, runs: [] })
		: await getFactLockGateForCurrentUser(projectId);
	const voiceSummary =
		stepKey === "video" && !getProjectFixture(projectId)
			? await getVoiceStepSummaryForCurrentUser(projectId)
			: undefined;

	return (
		<ProjectStepPage
			content={children}
			gate={gate}
			projectId={projectId}
			stepKey={stepKey}
			voiceReady={
				stepKey === "video" ? (voiceSummary?.ready ?? false) : undefined
			}
			voiceSummary={voiceSummary}
		/>
	);
}
