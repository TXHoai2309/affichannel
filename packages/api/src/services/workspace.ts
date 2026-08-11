import { INTERNAL_WORKSPACE_ID } from "@affichannel/core/workspace";
import { db, workspaceMember } from "@affichannel/db";
import { and, eq } from "drizzle-orm";

export type WorkspaceActor = {
	workspaceId: string;
	userId: string;
};

export async function getWorkspaceActor(
	userId: string,
): Promise<WorkspaceActor | undefined> {
	const [membership] = await db
		.select({ workspaceId: workspaceMember.workspaceId })
		.from(workspaceMember)
		.where(
			and(
				eq(workspaceMember.userId, userId),
				eq(workspaceMember.workspaceId, INTERNAL_WORKSPACE_ID),
			),
		)
		.limit(1);

	if (!membership) {
		return undefined;
	}

	return {
		workspaceId: membership.workspaceId,
		userId,
	};
}
