import type {
	CompositionInput,
	CompositionInputV1,
	CompositionInputV2,
	QuickImageRenderRequest,
	RenderRequestSpec,
	RenderRequestSpecV1,
} from "@affichannel/core";
import {
	createRenderOutputStorageKey,
	type RenderOutputBody,
	type RenderOutputStorage,
} from "../storage/render-output-storage";
import {
	type QuickImageRenderOutputExpectation,
	RENDER_OUTPUT_PROOF_VERSION,
	RENDER_OUTPUT_VALIDATION_VERSION,
	type StoredRenderOutputProofV1,
	validateRenderOutputStream,
} from "./render-output-validator";

export type RenderOutputAuthority =
	| Readonly<{
			requestSpec: RenderRequestSpecV1;
			compositionInput: CompositionInputV1;
	  }>
	| Readonly<{
			requestSpec: QuickImageRenderRequest;
			compositionInput: CompositionInputV2;
	  }>;

function validationExpectation(input: RenderOutputAuthority) {
	if (input.requestSpec.schemaVersion === "render-request.quick-image.v1") {
		if (input.compositionInput.schemaVersion !== "composition-input.v2")
			throw new Error("RENDER_OUTPUT_PROVENANCE_INVALID");
		return {
			kind: "QUICK_IMAGE",
			compositionInput: input.compositionInput,
			outputProfile: input.requestSpec.outputProfile,
			outputProfileFingerprint: input.requestSpec.outputProfileFingerprint,
			outputContractVersion: input.requestSpec.outputContractVersion,
			expectedColorRange: "LIMITED_TV",
		} satisfies QuickImageRenderOutputExpectation;
	}
	if (input.compositionInput.schemaVersion !== "composition-input.v1")
		throw new Error("RENDER_OUTPUT_PROVENANCE_INVALID");
	return {
		requestSpec: input.requestSpec,
		compositionInput: input.compositionInput,
	};
}

export async function persistAndValidateRenderOutput(input: {
	storage: RenderOutputStorage;
	workspaceId: string;
	projectId: string;
	renderJobId: string;
	renderAttemptId: string;
	outputReservationId: string;
	requestSpec: RenderRequestSpec;
	compositionInput: CompositionInput;
	body: RenderOutputBody;
}): Promise<StoredRenderOutputProofV1> {
	const authority = {
		requestSpec: input.requestSpec,
		compositionInput: input.compositionInput,
	} as RenderOutputAuthority;
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
	const validation = await validateStoredRenderOutput({
		storage: input.storage,
		storageKey,
		outputReservationId: input.outputReservationId,
		requestSpec: authority.requestSpec,
		compositionInput: authority.compositionInput,
	});
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

export async function validateStoredRenderOutput(input: {
	storage: RenderOutputStorage;
	storageKey: string;
	outputReservationId: string;
	requestSpec: RenderRequestSpec;
	compositionInput: CompositionInput;
}): Promise<StoredRenderOutputProofV1> {
	const authority = {
		requestSpec: input.requestSpec,
		compositionInput: input.compositionInput,
	} as RenderOutputAuthority;
	const validation = await validateRenderOutputStream(
		await input.storage.open(input.storageKey),
		validationExpectation(authority),
	);
	const stored = await input.storage.verifyExact({
		storageKey: input.storageKey,
		byteSize: validation.byteSize,
		checksumSha256: validation.checksumSha256,
	});
	if (
		stored.provider !== input.storage.provider ||
		stored.storageKey !== input.storageKey ||
		stored.contentType !== "video/mp4"
	)
		throw new Error("RENDER_OUTPUT_STORAGE_IDENTITY_MISMATCH");
	return {
		schemaVersion: RENDER_OUTPUT_PROOF_VERSION,
		outputReservationId: input.outputReservationId,
		storageProvider: stored.provider,
		storageKey: stored.storageKey,
		mimeType: stored.contentType,
		byteSize: stored.byteSize,
		checksumSha256: stored.checksumSha256,
		validationVersion: RENDER_OUTPUT_VALIDATION_VERSION,
		validatedMetadata: validation.validatedMetadata,
	};
}
