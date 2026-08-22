import { randomUUID } from "node:crypto";
import { channelSettingsSchema } from "@affichannel/core";
import { channelSettings, db } from "@affichannel/db";
import { eq } from "drizzle-orm";
import type { WorkspaceActor } from "./workspace";

export async function getChannelSettings(actor: WorkspaceActor) {
	const [settings] = await db
		.select({
			niche: channelSettings.niche,
			targetAudience: channelSettings.targetAudience,
			tone: channelSettings.tone,
			contentPillar: channelSettings.contentPillar,
			defaultCta: channelSettings.defaultCta,
			affiliateDisclosure: channelSettings.affiliateDisclosure,
			avoidWords: channelSettings.avoidWords,
		})
		.from(channelSettings)
		.where(eq(channelSettings.workspaceId, actor.workspaceId))
		.limit(1);
	return settings ?? null;
}

export async function upsertChannelSettings(
	actor: WorkspaceActor,
	input: unknown,
) {
	const settings = channelSettingsSchema.parse(input);
	const [saved] = await db
		.insert(channelSettings)
		.values({
			id: randomUUID(),
			workspaceId: actor.workspaceId,
			...settings,
			createdByUserId: actor.userId,
			updatedByUserId: actor.userId,
		})
		.onConflictDoUpdate({
			target: channelSettings.workspaceId,
			set: {
				...settings,
				updatedByUserId: actor.userId,
				updatedAt: new Date(),
			},
		})
		.returning();
	if (!saved) throw new Error("Channel Settings upsert returned no row.");
	return {
		niche: saved.niche,
		targetAudience: saved.targetAudience,
		tone: saved.tone,
		contentPillar: saved.contentPillar,
		defaultCta: saved.defaultCta,
		affiliateDisclosure: saved.affiliateDisclosure,
		avoidWords: saved.avoidWords,
	};
}
