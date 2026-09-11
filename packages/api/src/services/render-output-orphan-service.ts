import { db, renderArtifact, renderAttempt, renderJob } from "@affichannel/db";
import { and, eq, gt } from "drizzle-orm";
import {
	createRenderOutputStorageKey,
	type RenderOutputStorage,
} from "../storage/render-output-storage";

export type RenderOutputOrphanInspection = Readonly<{
	status: "MISSING" | "REFERENCED" | "PROTECTED" | "PROVEN_ORPHAN";
	storageKey: string;
	byteSize: number | null;
	checksumSha256: string | null;
}>;

async function proveOrphanEligibility(input: {
	storage: RenderOutputStorage;
	workspaceId: string;
	projectId: string;
	renderJobId: string;
	renderAttemptId: string;
	attemptNumber: number;
	outputReservationId: string;
	storageKey: string;
}) {
	return db.transaction(async (transaction) => {
		const [job] = await transaction
			.select({ id: renderJob.id, status: renderJob.status })
			.from(renderJob)
			.where(
				and(
					eq(renderJob.id, input.renderJobId),
					eq(renderJob.workspaceId, input.workspaceId),
					eq(renderJob.projectId, input.projectId),
				),
			)
			.limit(1)
			.for("update", { of: renderJob });
		const [attempt] = await transaction
			.select({ id: renderAttempt.id, status: renderAttempt.status })
			.from(renderAttempt)
			.where(
				and(
					eq(renderAttempt.id, input.renderAttemptId),
					eq(renderAttempt.renderJobId, input.renderJobId),
					eq(renderAttempt.workspaceId, input.workspaceId),
					eq(renderAttempt.attemptNumber, input.attemptNumber),
					eq(renderAttempt.outputReservationId, input.outputReservationId),
				),
			)
			.limit(1)
			.for("update", { of: renderAttempt });
		const [artifact] = await transaction
			.select({ id: renderArtifact.id })
			.from(renderArtifact)
			.where(
				and(
					eq(renderArtifact.workspaceId, input.workspaceId),
					eq(renderArtifact.projectId, input.projectId),
					eq(renderArtifact.renderJobId, input.renderJobId),
					eq(renderArtifact.renderAttemptId, input.renderAttemptId),
					eq(renderArtifact.outputReservationId, input.outputReservationId),
					eq(renderArtifact.storageProvider, input.storage.provider),
					eq(renderArtifact.storageKey, input.storageKey),
				),
			)
			.limit(1);
		if (artifact) return "REFERENCED" as const;
		if (
			!job ||
			!attempt ||
			attempt.status === "RUNNING" ||
			attempt.status === "INDETERMINATE" ||
			attempt.status === "COMPLETED"
		)
			return "PROTECTED" as const;
		const [newerAttempt] = await transaction
			.select({ id: renderAttempt.id })
			.from(renderAttempt)
			.where(
				and(
					eq(renderAttempt.renderJobId, input.renderJobId),
					gt(renderAttempt.attemptNumber, input.attemptNumber),
				),
			)
			.limit(1);
		return newerAttempt ? ("PROTECTED" as const) : ("PROVEN_ORPHAN" as const);
	});
}

export async function inspectRenderOutputOwnership(input: {
	storage: RenderOutputStorage;
	workspaceId: string;
	projectId: string;
	renderJobId: string;
	renderAttemptId: string;
	attemptNumber: number;
	outputReservationId: string;
}) {
	const storageKey = createRenderOutputStorageKey(input);
	const stored = await input.storage.head(storageKey);
	if (!stored)
		return {
			status: "MISSING" as const,
			storageKey,
			byteSize: null,
			checksumSha256: null,
		};
	const status = await proveOrphanEligibility({
		...input,
		storageKey,
	});
	return {
		status,
		storageKey,
		byteSize: stored.byteSize,
		checksumSha256: stored.checksumSha256,
	};
}

export async function deleteProvenRenderOutputOrphan(input: {
	storage: RenderOutputStorage;
	workspaceId: string;
	projectId: string;
	renderJobId: string;
	renderAttemptId: string;
	attemptNumber: number;
	outputReservationId: string;
	byteSize: number;
	checksumSha256: string;
}) {
	const storageKey = createRenderOutputStorageKey(input);
	const stored = await input.storage.head(storageKey);
	if (
		!stored ||
		stored.byteSize !== input.byteSize ||
		(stored.checksumSha256 !== null &&
			stored.checksumSha256 !== input.checksumSha256)
	)
		throw new Error("RENDER_OUTPUT_ORPHAN_NOT_PROVEN");
	const status = await proveOrphanEligibility({
		...input,
		storageKey,
	});
	if (status !== "PROVEN_ORPHAN")
		throw new Error("RENDER_OUTPUT_ORPHAN_NOT_PROVEN");
	await input.storage.deleteProvenOrphan({
		storageKey,
		byteSize: input.byteSize,
		checksumSha256: input.checksumSha256,
	});
}
