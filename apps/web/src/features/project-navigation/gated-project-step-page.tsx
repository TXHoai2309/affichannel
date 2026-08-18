import { evaluateFactLockGate } from "@affichannel/core";

import { getFactLockGateForCurrentUser } from "@/lib/project-loader";
import { getProjectFixture } from "./project-fixtures";
import ProjectStepPage from "./project-step-page";
import type { ProjectStepKey } from "./project-steps";

export default async function GatedProjectStepPage({
	projectId,
	stepKey,
}: {
	projectId: string;
	stepKey: Extract<ProjectStepKey, "voice" | "video" | "preview">;
}) {
	const gate = getProjectFixture(projectId)
		? evaluateFactLockGate({ currentScriptVersion: null, runs: [] })
		: await getFactLockGateForCurrentUser(projectId);

	return (
		<ProjectStepPage gate={gate} projectId={projectId} stepKey={stepKey} />
	);
}
