import { randomUUID } from "node:crypto";
import {
	findVoicePreset,
	listVoicePresets,
	TTS_PROVIDER,
	type VoiceConfig,
	VoiceConfigError,
	validateVoiceConfigFields,
} from "@affichannel/core";
import { db, project, voiceConfig } from "@affichannel/db";
import { env } from "@affichannel/env/server";
import { and, eq, isNull, sql } from "drizzle-orm";

import { FactLockGate } from "./fact-lock-gate-service";
import { reconcileVoiceStepBestEffort } from "./voice-step-workflow-service";
import type { WorkspaceActor } from "./workspace";

type VoiceConfigRow = typeof voiceConfig.$inferSelect;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function mapVoiceConfig(record: VoiceConfigRow): VoiceConfig {
	return {
		id: record.id,
		workspaceId: record.workspaceId,
		projectId: record.projectId,
		provider: record.provider,
		voiceId: record.voiceId,
		language: record.language,
		speed: record.speed,
		revision: record.revision,
		createdBy: record.createdByUserId,
		updatedBy: record.updatedByUserId,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function resolveTtsProvider() {
	if (env.TTS_DEFAULT_PROVIDER !== TTS_PROVIDER) {
		throw new VoiceConfigError(
			"TTS_PROVIDER_UNAVAILABLE",
			"TTS provider mặc định không được hỗ trợ.",
			{ provider: env.TTS_DEFAULT_PROVIDER },
		);
	}
	return TTS_PROVIDER;
}

async function findAccessibleProject(actor: WorkspaceActor, projectId: string) {
	const [record] = await db
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				eq(project.id, projectId),
				eq(project.workspaceId, actor.workspaceId),
				isNull(project.archivedAt),
			),
		)
		.limit(1);
	return record;
}

async function lockAccessibleProject(
	transaction: DbTransaction,
	actor: WorkspaceActor,
	projectId: string,
) {
	const [record] = await transaction
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				eq(project.id, projectId),
				eq(project.workspaceId, actor.workspaceId),
				isNull(project.archivedAt),
			),
		)
		.limit(1)
		.for("update", { of: project });
	return record;
}

async function findCurrentConfig(
	query: typeof db | DbTransaction,
	actor: WorkspaceActor,
	projectId: string,
	options: { forUpdate?: boolean } = {},
) {
	const builder = query
		.select()
		.from(voiceConfig)
		.where(
			and(
				eq(voiceConfig.workspaceId, actor.workspaceId),
				eq(voiceConfig.projectId, projectId),
			),
		)
		.limit(1);
	return options.forUpdate
		? builder.for("update", { of: voiceConfig })
		: builder;
}

function isUniqueViolation(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}

export function listServerVoicePresets() {
	return listVoicePresets();
}

export async function getVoiceConfig(actor: WorkspaceActor, projectId: string) {
	await FactLockGate.assertPassed(actor, projectId);
	return findVoiceConfig(actor, projectId);
}

/** Read-only snapshot for artifact current/stale derivation after a provider call. */
export async function findVoiceConfig(
	actor: WorkspaceActor,
	projectId: string,
) {
	const accessibleProject = await findAccessibleProject(actor, projectId);
	if (!accessibleProject) {
		throw new VoiceConfigError("VOICE_CONFIG_NOT_FOUND");
	}

	const [record] = await findCurrentConfig(db, actor, projectId);
	return record ? mapVoiceConfig(record) : null;
}

export async function saveVoiceConfig(
	actor: WorkspaceActor,
	input: {
		projectId: string;
		baseRevision: number | null;
		voiceId: string;
		language: string;
		speed: number;
	},
) {
	await FactLockGate.assertPassed(actor, input.projectId);
	const fields = validateVoiceConfigFields({
		voiceId: input.voiceId,
		language: input.language,
		speed: input.speed,
	});
	const provider = resolveTtsProvider();
	const preset = findVoicePreset(fields.voiceId);
	if (!preset) {
		throw new VoiceConfigError("TTS_VOICE_NOT_FOUND");
	}

	try {
		const saved = await db.transaction(async (transaction) => {
			const accessibleProject = await lockAccessibleProject(
				transaction,
				actor,
				input.projectId,
			);
			if (!accessibleProject) {
				throw new VoiceConfigError("VOICE_CONFIG_NOT_FOUND");
			}

			const [current] = await findCurrentConfig(
				transaction,
				actor,
				input.projectId,
				{ forUpdate: true },
			);

			if (input.baseRevision === null) {
				if (current) {
					throw new VoiceConfigError(
						"VOICE_CONFIG_CONFLICT",
						"VoiceConfig đã được tạo bởi request khác.",
						{ latestRevision: current.revision },
					);
				}

				const now = new Date();
				const [created] = await transaction
					.insert(voiceConfig)
					.values({
						id: randomUUID(),
						workspaceId: actor.workspaceId,
						projectId: input.projectId,
						provider,
						voiceId: fields.voiceId,
						language: fields.language,
						speed: fields.speed,
						revision: 1,
						createdByUserId: actor.userId,
						updatedByUserId: actor.userId,
						createdAt: now,
						updatedAt: now,
					})
					.returning();
				if (!created) throw new Error("VoiceConfig insert returned no row.");
				return mapVoiceConfig(created);
			}

			if (!current || current.revision !== input.baseRevision) {
				throw new VoiceConfigError(
					"VOICE_CONFIG_CONFLICT",
					"VoiceConfig revision đã thay đổi.",
					{ latestRevision: current?.revision ?? null },
				);
			}

			const [updated] = await transaction
				.update(voiceConfig)
				.set({
					provider,
					voiceId: fields.voiceId,
					language: fields.language,
					speed: fields.speed,
					revision: sql`${voiceConfig.revision} + 1`,
					updatedByUserId: actor.userId,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(voiceConfig.id, current.id),
						eq(voiceConfig.workspaceId, actor.workspaceId),
						eq(voiceConfig.projectId, input.projectId),
						eq(voiceConfig.revision, input.baseRevision),
					),
				)
				.returning();
			if (!updated) {
				throw new VoiceConfigError("VOICE_CONFIG_CONFLICT");
			}
			return mapVoiceConfig(updated);
		});
		await reconcileVoiceStepBestEffort(actor, input.projectId);
		return saved;
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new VoiceConfigError("VOICE_CONFIG_CONFLICT");
		}
		throw error;
	}
}
