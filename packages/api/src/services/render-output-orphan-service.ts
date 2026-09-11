import { db, renderArtifact, renderAttempt } from "@affichannel/db";
import { and, eq, inArray } from "drizzle-orm";
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
	const [artifact] = await db
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
				eq(renderArtifact.storageKey, storageKey),
			),
		)
		.limit(1);
	if (artifact)
		return {
			status: "REFERENCED" as const,
			storageKey,
			byteSize: stored.byteSize,
			checksumSha256: stored.checksumSha256,
		};
	const [protectedAttempt] = await db
		.select({ id: renderAttempt.id })
		.from(renderAttempt)
		.where(
			and(
				eq(renderAttempt.workspaceId, input.workspaceId),
				eq(renderAttempt.renderJobId, input.renderJobId),
				eq(renderAttempt.id, input.renderAttemptId),
				eq(renderAttempt.attemptNumber, input.attemptNumber),
				eq(renderAttempt.outputReservationId, input.outputReservationId),
				inArray(renderAttempt.status, ["RUNNING", "INDETERMINATE"]),
			),
		)
		.limit(1);
	return {
		status: protectedAttempt
			? ("PROTECTED" as const)
			: ("PROVEN_ORPHAN" as const),
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
	const inspection = await inspectRenderOutputOwnership(input);
	if (inspection.status !== "PROVEN_ORPHAN")
		throw new Error("RENDER_OUTPUT_ORPHAN_NOT_PROVEN");
	await input.storage.deleteProvenOrphan({
		storageKey: inspection.storageKey,
		byteSize: input.byteSize,
		checksumSha256: input.checksumSha256,
	});
}
