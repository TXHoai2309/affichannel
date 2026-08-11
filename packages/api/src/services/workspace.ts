import { db, workspaceMember } from "@affichannel/db";
import { asc, eq } from "drizzle-orm";

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
		.where(eq(workspaceMember.userId, userId))
		.orderBy(asc(workspaceMember.createdAt))
		.limit(1);

	if (!membership) {
		return undefined;
	}

	return {
		workspaceId: membership.workspaceId,
		userId,
	};
}
