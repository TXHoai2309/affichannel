import { observeProjectApplicabilityShadowFromSnapshot } from "@affichannel/api/services/applicability-shadow-service";
import { FactLockGate } from "@affichannel/api/services/fact-lock-gate-service";
import { getProjectDetails } from "@affichannel/api/services/project-repository";
import { getProjectWorkflowSnapshot } from "@affichannel/api/services/project-workflow-read-service";
import { reconcileVoiceStep } from "@affichannel/api/services/voice-step-workflow-service";
import { getWorkspaceActor } from "@affichannel/api/services/workspace";
import { auth } from "@affichannel/auth";
import { headers } from "next/headers";
import { cache } from "react";

export const getCurrentSession = cache(async () =>
	auth.api.getSession({ headers: await headers() }),
);

export const getCurrentWorkspaceActor = cache(async () => {
	const session = await getCurrentSession();
	return session?.user ? getWorkspaceActor(session.user.id) : undefined;
});

export const getProjectForCurrentUser = cache(async (projectId: string) => {
	const actor = await getCurrentWorkspaceActor();
	return actor ? getProjectDetails(actor.workspaceId, projectId) : undefined;
});

/** Request-scoped adaptive presentation source for the Project shell. */
export const getAdaptiveWorkflowForCurrentUser = cache(
	async (projectId: string) => {
		const actor = await getCurrentWorkspaceActor();
		if (!actor) return undefined;
		const snapshot = await getProjectWorkflowSnapshot(actor, projectId);
		if (!snapshot) return undefined;
		observeProjectApplicabilityShadowFromSnapshot(actor, snapshot);
		return snapshot.adaptiveWorkflow;
	},
);

export const getFactLockGateForCurrentUser = cache(
	async (projectId: string) => {
		const actor = await getCurrentWorkspaceActor();
		return actor ? FactLockGate.evaluate(actor, projectId) : undefined;
	},
);

export const getVoiceStepSummaryForCurrentUser = cache(
	async (projectId: string) => {
		const actor = await getCurrentWorkspaceActor();
		if (!actor) return undefined;
		return (await reconcileVoiceStep(actor, projectId))?.summary;
	},
);
