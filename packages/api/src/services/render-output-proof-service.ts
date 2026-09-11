import type {
	CompositionInputV1,
	RenderRequestSpecV1,
} from "@affichannel/core";
import {
	createRenderOutputStorageKey,
	type RenderOutputBody,
	type RenderOutputStorage,
} from "../storage/render-output-storage";
import {
	RENDER_OUTPUT_PROOF_VERSION,
	RENDER_OUTPUT_VALIDATION_VERSION,
	type StoredRenderOutputProofV1,
	validateRenderOutputStream,
} from "./render-output-validator";

export async function persistAndValidateRenderOutput(input: {
	storage: RenderOutputStorage;
	workspaceId: string;
	projectId: string;
	renderJobId: string;
	renderAttemptId: string;
	outputReservationId: string;
	requestSpec: RenderRequestSpecV1;
	compositionInput: CompositionInputV1;
	body: RenderOutputBody;
}): Promise<StoredRenderOutputProofV1> {
	const storageKey = createRenderOutputStorageKey({
		workspaceId: input.workspaceId,
		projectId: input.projectId,
		renderJobId: input.renderJobId,
		renderAttemptId: input.renderAttemptId,
		outputReservationId: input.outputReservationId,
	});
	const stored = await input.storage.createOnce({
		storageKey,
		body: input.body,
	});
	const validation = await validateRenderOutputStream(
		await input.storage.open(storageKey),
		{
			requestSpec: input.requestSpec,
			compositionInput: input.compositionInput,
		},
	);
	if (
		validation.byteSize !== stored.proof.byteSize ||
		validation.checksumSha256 !== stored.proof.checksumSha256
	)
		throw new Error("RENDER_OUTPUT_STORAGE_PROOF_MISMATCH");
	return {
		schemaVersion: RENDER_OUTPUT_PROOF_VERSION,
		outputReservationId: input.outputReservationId,
		storageProvider: input.storage.provider,
		storageKey,
		mimeType: "video/mp4",
		byteSize: validation.byteSize,
		checksumSha256: validation.checksumSha256,
		validationVersion: RENDER_OUTPUT_VALIDATION_VERSION,
		validatedMetadata: validation.validatedMetadata,
	};
}
