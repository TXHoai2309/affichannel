import { FactLockGate } from "@affichannel/api/services/fact-lock-gate-service";
import { getProjectDetails } from "@affichannel/api/services/project-repository";
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

export const getFactLockGateForCurrentUser = cache(
	async (projectId: string) => {
		const actor = await getCurrentWorkspaceActor();
		return actor ? FactLockGate.evaluate(actor, projectId) : undefined;
	},
);
