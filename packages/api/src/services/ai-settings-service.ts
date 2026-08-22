import { randomUUID } from "node:crypto";
import { aiSettingsSchema } from "@affichannel/core";
import { aiSettings, db } from "@affichannel/db";
import { eq } from "drizzle-orm";
import type { WorkspaceActor } from "./workspace";

export async function getAiSettings(actor: WorkspaceActor) {
	const [settings] = await db
		.select({
			textProvider: aiSettings.textProvider,
			textModel: aiSettings.textModel,
		})
		.from(aiSettings)
		.where(eq(aiSettings.workspaceId, actor.workspaceId))
		.limit(1);
	return settings ?? null;
}

export async function upsertAiSettings(actor: WorkspaceActor, input: unknown) {
	const settings = aiSettingsSchema.parse(input);
	const [saved] = await db
		.insert(aiSettings)
		.values({
			id: randomUUID(),
			workspaceId: actor.workspaceId,
			...settings,
			createdByUserId: actor.userId,
			updatedByUserId: actor.userId,
		})
		.onConflictDoUpdate({
			target: aiSettings.workspaceId,
			set: {
				...settings,
				updatedByUserId: actor.userId,
				updatedAt: new Date(),
			},
		})
		.returning();
	if (!saved) throw new Error("AI Settings upsert returned no row.");
	return {
		textProvider: saved.textProvider,
		textModel: saved.textModel,
	};
}
