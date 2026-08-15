import { randomUUID } from "node:crypto";
import { defaultOutputRules, outputRulesSchema } from "@affichannel/core";
import { db, outputRules } from "@affichannel/db";
import { eq } from "drizzle-orm";
import type { WorkspaceActor } from "./workspace";

export async function getOutputRules(actor: WorkspaceActor) {
	const [settings] = await db
		.select({
			language: outputRules.language,
			aspectRatio: outputRules.aspectRatio,
			subtitleSafeArea: outputRules.subtitleSafeArea,
			claimLimit: outputRules.claimLimit,
			requireFinalCta: outputRules.requireFinalCta,
		})
		.from(outputRules)
		.where(eq(outputRules.workspaceId, actor.workspaceId))
		.limit(1);
	return settings ? outputRulesSchema.parse(settings) : defaultOutputRules;
}

export async function upsertOutputRules(actor: WorkspaceActor, input: unknown) {
	const settings = outputRulesSchema.parse(input);
	const [saved] = await db
		.insert(outputRules)
		.values({
			id: randomUUID(),
			workspaceId: actor.workspaceId,
			...settings,
			createdByUserId: actor.userId,
			updatedByUserId: actor.userId,
		})
		.onConflictDoUpdate({
			target: outputRules.workspaceId,
			set: {
				...settings,
				updatedByUserId: actor.userId,
				updatedAt: new Date(),
			},
		})
		.returning();
	if (!saved) throw new Error("Output Rules upsert returned no row.");
	return outputRulesSchema.parse({
		language: saved.language,
		aspectRatio: saved.aspectRatio,
		subtitleSafeArea: saved.subtitleSafeArea,
		claimLimit: saved.claimLimit,
		requireFinalCta: saved.requireFinalCta,
	});
}
