import { randomUUID } from "node:crypto";
import {
	deriveVoiceSegmentReadModel,
	evaluateVoiceStepReadiness,
	type VoiceSegmentArtifact,
	type VoiceStepSegmentEvaluation,
	type VoiceStepSummary,
	validateVoiceConfigFields,
	validateVoiceSegmentText,
} from "@affichannel/core";
import { db, project, projectStepStatus, voiceConfig } from "@affichannel/db";
import { and, eq, isNull } from "drizzle-orm";

import { FactLockGate } from "./fact-lock-gate-service";
import { findCurrentScriptVersion } from "./script-version-repository";
import { hashVoiceSegmentText } from "./voice-segment-hashing";
import {
	listVoiceSegmentArtifacts,
	reconcileExpiredPendingVoiceSegmentArtifacts,
} from "./voice-segment-repository";
import type { WorkspaceActor } from "./workspace";

export type VoiceStepWorkflowEvaluation = {
	summary: VoiceStepSummary;
	segments: VoiceStepSegmentEvaluation[];
};

function sortArtifacts(
	left: VoiceSegmentArtifact,
	right: VoiceSegmentArtifact,
) {
	return (
		right.createdAt.getTime() - left.createdAt.getTime() ||
		right.id.localeCompare(left.id)
	);
}

async function findCurrentVoiceConfig(
	actor: WorkspaceActor,
	projectId: string,
) {
	const [record] = await db
		.select({
			provider: voiceConfig.provider,
			voiceId: voiceConfig.voiceId,
			language: voiceConfig.language,
			speed: voiceConfig.speed,
			revision: voiceConfig.revision,
		})
		.from(voiceConfig)
		.where(
			and(
				eq(voiceConfig.workspaceId, actor.workspaceId),
				eq(voiceConfig.projectId, projectId),
			),
		)
		.limit(1);
	return record ?? null;
}

async function loadEvaluation(
	actor: WorkspaceActor,
	projectId: string,
): Promise<VoiceStepWorkflowEvaluation> {
	const [factLockGate, currentScriptVersion, currentVoiceConfig] =
		await Promise.all([
			FactLockGate.evaluate(actor, projectId),
			findCurrentScriptVersion(actor, projectId),
			findCurrentVoiceConfig(actor, projectId),
		]);
	const artifacts = await listVoiceSegmentArtifacts(actor, projectId);
	const segments: VoiceStepSegmentEvaluation[] = [];

	if (currentScriptVersion) {
		const fields = currentVoiceConfig
			? validateVoiceConfigFields({
					voiceId: currentVoiceConfig.voiceId,
					language: currentVoiceConfig.language,
					speed: currentVoiceConfig.speed,
				})
			: null;
		const voiceoverSegments = Array.isArray(
			currentScriptVersion.editableSnapshot.voiceoverSegments,
		)
			? currentScriptVersion.editableSnapshot.voiceoverSegments
			: [];
		for (const segment of voiceoverSegments) {
			const text = validateVoiceSegmentText(segment.text);
			const fingerprint = {
				workspaceId: actor.workspaceId,
				projectId,
				sourceScriptVersionId: currentScriptVersion.id,
				sourceScriptRevision: currentScriptVersion.revision,
				segmentKey: segment.key,
				textHash: hashVoiceSegmentText(text),
				voiceConfigRevision: currentVoiceConfig?.revision ?? 0,
				provider: currentVoiceConfig?.provider ?? "unconfigured",
				voiceId: fields?.voiceId ?? "unconfigured",
				language: fields?.language ?? "vi",
				speed: fields?.speed ?? 1,
			};
			segments.push({
				segmentKey: segment.key,
				text,
				fingerprint,
				readModel: deriveVoiceSegmentReadModel(
					artifacts
						.filter((artifact) => artifact.segmentKey === segment.key)
						.sort(sortArtifacts),
					fingerprint,
				),
			});
		}
	}

	return {
		segments,
		summary: evaluateVoiceStepReadiness({
			factLockPassed: factLockGate.allowed,
			voiceConfigPresent: currentVoiceConfig !== null,
			currentScriptVersionPresent: currentScriptVersion !== null,
			segments,
		}),
	};
}

export async function getVoiceStepWorkflowEvaluation(
	actor: WorkspaceActor,
	projectId: string,
) {
	await reconcileExpiredPendingVoiceSegmentArtifacts(actor);
	return loadEvaluation(actor, projectId);
}

function hasVoiceSetup(evaluation: VoiceStepWorkflowEvaluation) {
	return (
		evaluation.summary.voiceConfigPresent ||
		evaluation.summary.currentScriptVersionPresent ||
		evaluation.summary.totalSegments > 0 ||
		evaluation.summary.completedSegments > 0 ||
		evaluation.summary.pendingSegments > 0 ||
		evaluation.summary.staleSegments > 0
	);
}

function getVoiceStatus(evaluation: VoiceStepWorkflowEvaluation) {
	if (!evaluation.summary.factLockPassed) return "blocked" as const;
	if (evaluation.summary.ready) return "completed" as const;
	return hasVoiceSetup(evaluation) ? ("needs_review" as const) : "not_started";
}

async function getProjectForUpdate(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	actor: WorkspaceActor,
	projectId: string,
) {
	const [record] = await transaction
		.select({
			id: project.id,
			currentStepKey: project.currentStepKey,
		})
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

async function upsertProjectStepStatus(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	projectId: string,
	stepKey: "voice" | "video",
	status: "completed" | "needs_review" | "blocked" | "not_started",
) {
	await transaction
		.insert(projectStepStatus)
		.values({ id: randomUUID(), projectId, stepKey, status })
		.onConflictDoUpdate({
			target: [projectStepStatus.projectId, projectStepStatus.stepKey],
			set: { status, updatedAt: new Date() },
		});
}

/**
 * Reconcile Voice workflow state from a freshly read server snapshot. The
 * project row lock serializes this business action with Script/VoiceConfig
 * mutations that can change the fingerprint.
 */
export async function reconcileVoiceStep(
	actor: WorkspaceActor,
	projectId: string,
): Promise<VoiceStepWorkflowEvaluation | undefined> {
	await reconcileExpiredPendingVoiceSegmentArtifacts(actor);
	return db.transaction(async (transaction) => {
		const projectRecord = await getProjectForUpdate(
			transaction,
			actor,
			projectId,
		);
		if (!projectRecord) return undefined;

		const evaluation = await loadEvaluation(actor, projectId);
		const voiceStatus = getVoiceStatus(evaluation);
		const nextCurrentStepKey =
			evaluation.summary.ready && projectRecord.currentStepKey === "voice"
				? "video"
				: projectRecord.currentStepKey;
		const [existingVideoStatus] = await transaction
			.select({ status: projectStepStatus.status })
			.from(projectStepStatus)
			.where(
				and(
					eq(projectStepStatus.projectId, projectId),
					eq(projectStepStatus.stepKey, "video"),
				),
			)
			.limit(1);
		const videoStatus = evaluation.summary.ready
			? existingVideoStatus?.status === "completed"
				? "completed"
				: "not_started"
			: "blocked";

		await upsertProjectStepStatus(transaction, projectId, "voice", voiceStatus);
		await upsertProjectStepStatus(transaction, projectId, "video", videoStatus);

		await transaction
			.update(project)
			.set({ currentStepKey: nextCurrentStepKey, updatedAt: new Date() })
			.where(
				and(
					eq(project.id, projectId),
					eq(project.workspaceId, actor.workspaceId),
				),
			);
		return evaluation;
	});
}

export async function reconcileVoiceStepBestEffort(
	actor: WorkspaceActor,
	projectId: string,
) {
	try {
		return await reconcileVoiceStep(actor, projectId);
	} catch (error) {
		console.warn("voice_step_reconcile_failed", {
			projectId,
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}
