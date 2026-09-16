import { quickImageDurationSecondsSchema } from "@affichannel/core";
import { db, quickImageSettings } from "@affichannel/db";
import { and, eq } from "drizzle-orm";
import type { WorkspaceActor } from "./workspace";

export type QuickImageSettingsSnapshot = Readonly<{
	workspaceId: string;
	projectId: string;
	durationSeconds: 5 | 10 | 15;
	revision: number;
}>;

/** Read-only composition authority for the persisted Quick Image settings row. */
export async function findQuickImageSettings(
	actor: WorkspaceActor,
	projectId: string,
): Promise<QuickImageSettingsSnapshot | undefined> {
	const [row] = await db
		.select({
			workspaceId: quickImageSettings.workspaceId,
			projectId: quickImageSettings.projectId,
			durationSeconds: quickImageSettings.durationSeconds,
			revision: quickImageSettings.revision,
		})
		.from(quickImageSettings)
		.where(
			and(
				eq(quickImageSettings.workspaceId, actor.workspaceId),
				eq(quickImageSettings.projectId, projectId),
			),
		)
		.limit(1);
	if (!row || row.revision <= 0) return undefined;
	const duration = quickImageDurationSecondsSchema.safeParse(
		row.durationSeconds,
	);
	if (!duration.success) return undefined;
	return Object.freeze({
		workspaceId: row.workspaceId,
		projectId: row.projectId,
		durationSeconds: duration.data,
		revision: row.revision,
	});
}
