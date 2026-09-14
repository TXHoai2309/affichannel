import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { type T09OutputReady, t09OutputReadySchema } from "@affichannel/core";
import type { RenderOutputStorage } from "../storage/render-output-storage";
import {
	finalizeRenderArtifact,
	reconcileRenderArtifact,
} from "./render-artifact-repository";
import {
	assertT09ServerOwnedStagingPath,
	createT09AttemptOutputStagingPath,
	type T09ServerOwnedStagingPath,
} from "./render-prototype-staging";

export type T09StagedOutputHandoff = Readonly<{
	outputReady: T09OutputReady;
	outputPath: T09ServerOwnedStagingPath;
	storage: RenderOutputStorage;
}>;

export function assertT09StagedOutputHandoff(input: T09StagedOutputHandoff) {
	if (input.storage.provider !== "local")
		throw new Error("T09_STAGING_HANDOFF_REQUIRES_LOCAL_STORAGE");
	const outputPath = assertT09ServerOwnedStagingPath(
		input.outputPath,
		"T09 staged output",
	);
	const outputReady = t09OutputReadySchema.parse(input.outputReady);
	const expected = createT09AttemptOutputStagingPath({
		rootPath: input.outputPath.rootPath,
		jobId: outputReady.jobId,
		attemptId: outputReady.attemptId,
		attemptNumber: outputReady.attemptNumber,
		outputReservationId: outputReady.outputReservationId,
	});
	if (expected.absolutePath !== outputPath)
		throw new Error("T09_STAGED_OUTPUT_IDENTITY_MISMATCH");
	return { outputPath, outputReady };
}

async function removeAfterProof(path: string) {
	await rm(path, { force: true });
}

/**
 * Hands an exact private staging output to the 21D normal-finalize path.
 * Staging is removed only after storage-backed validation and atomic
 * RenderArtifact/job finalization have succeeded.
 */
export async function finalizeT09StagedOutput(
	input: T09StagedOutputHandoff & Readonly<{ leaseOwner: string }>,
) {
	const { outputPath, outputReady } = assertT09StagedOutputHandoff(input);
	const artifact = await finalizeRenderArtifact({
		jobId: outputReady.jobId,
		attemptId: outputReady.attemptId,
		attemptNumber: outputReady.attemptNumber,
		leaseOwner: input.leaseOwner,
		storage: input.storage,
		body: createReadStream(outputPath),
	});
	await removeAfterProof(outputPath);
	return artifact;
}

/**
 * Hands an exact private staging output to the trusted 21D reconciliation
 * path. No current lease is required by reconciliation, but the exact
 * reservation and immutable proof still are.
 */
export async function reconcileT09StagedOutput(input: T09StagedOutputHandoff) {
	const { outputPath, outputReady } = assertT09StagedOutputHandoff(input);
	const artifact = await reconcileRenderArtifact({
		jobId: outputReady.jobId,
		attemptId: outputReady.attemptId,
		attemptNumber: outputReady.attemptNumber,
		storage: input.storage,
		body: createReadStream(outputPath),
	});
	await removeAfterProof(outputPath);
	return artifact;
}
