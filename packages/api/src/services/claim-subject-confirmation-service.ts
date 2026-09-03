import type { ScriptVersionReadModel } from "@affichannel/core";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
	type ConfirmClaimSubjectsDecision,
	confirmScriptVersionClaimSubjectsRecord,
} from "./script-version-repository";
import type { WorkspaceActor } from "./workspace";

const idSchema = z.string().trim().min(1).max(120);

export const claimSubjectConfirmationDecisionSchema = z
	.object({
		claimIndex: z.number().int().nonnegative(),
		subject: z.enum(["GENERAL", "PRODUCT"]),
	})
	.strict();

export const confirmClaimSubjectsInputSchema = z
	.object({
		scriptVersionId: idSchema,
		expectedScriptVersionRevision: z.number().int().positive(),
		decisions: z.array(claimSubjectConfirmationDecisionSchema).max(64),
	})
	.strict();

export type ConfirmClaimSubjectsInput = z.infer<
	typeof confirmClaimSubjectsInputSchema
>;

export type ClaimSubjectConfirmationServiceErrorCode =
	| "CLAIM_SUBJECT_CONFIRMATION_NOT_FOUND"
	| "CLAIM_SUBJECT_CONFIRMATION_IMMUTABLE"
	| "CLAIM_SUBJECT_CONFIRMATION_NOT_ELIGIBLE"
	| "SCRIPT_CLAIMS_NOT_CURRENT"
	| "CLAIM_SUBJECT_INVALID"
	| "CLAIM_SUBJECT_CONFIRMATION_REQUIRED"
	| "CLAIM_SUBJECT_DECISIONS_INVALID"
	| "SCRIPT_VERSION_CONFLICT";

export class ClaimSubjectConfirmationServiceError extends Error {
	readonly code: ClaimSubjectConfirmationServiceErrorCode;
	readonly metadata: { latestRevision?: number } | undefined;

	constructor(
		code: ClaimSubjectConfirmationServiceErrorCode,
		message: string = code,
		metadata?: { latestRevision?: number },
	) {
		super(message);
		this.name = "ClaimSubjectConfirmationServiceError";
		this.code = code;
		this.metadata = metadata;
	}
}

export type ClaimSubjectConfirmationResult =
	| Readonly<{
			kind: "not_required";
			scriptVersion: ScriptVersionReadModel;
	  }>
	| Readonly<{
			kind: "confirmed";
			previousRevision: number;
			resultRevision: number;
			scriptVersion: ScriptVersionReadModel;
	  }>;

function throwConfirmationError(
	result: Awaited<ReturnType<typeof confirmScriptVersionClaimSubjectsRecord>>,
): never {
	switch (result.kind) {
		case "not_found":
			throw new ClaimSubjectConfirmationServiceError(
				"CLAIM_SUBJECT_CONFIRMATION_NOT_FOUND",
			);
		case "immutable":
			throw new ClaimSubjectConfirmationServiceError(
				"CLAIM_SUBJECT_CONFIRMATION_IMMUTABLE",
			);
		case "not_eligible":
			throw new ClaimSubjectConfirmationServiceError(
				"CLAIM_SUBJECT_CONFIRMATION_NOT_ELIGIBLE",
			);
		case "claims_not_current":
			throw new ClaimSubjectConfirmationServiceError(
				"SCRIPT_CLAIMS_NOT_CURRENT",
			);
		case "invalid_subject":
			throw new ClaimSubjectConfirmationServiceError("CLAIM_SUBJECT_INVALID");
		case "confirmation_required":
			throw new ClaimSubjectConfirmationServiceError(
				"CLAIM_SUBJECT_CONFIRMATION_REQUIRED",
			);
		case "invalid_decisions":
			throw new ClaimSubjectConfirmationServiceError(
				"CLAIM_SUBJECT_DECISIONS_INVALID",
			);
		case "conflict":
			throw new ClaimSubjectConfirmationServiceError(
				"SCRIPT_VERSION_CONFLICT",
				"SCRIPT_VERSION_CONFLICT",
				{ latestRevision: result.latestRevision },
			);
	}
	throw new Error("Unhandled claim-subject confirmation result.");
}

export async function confirmScriptVersionClaimSubjects(
	actor: WorkspaceActor,
	input: ConfirmClaimSubjectsInput,
): Promise<ClaimSubjectConfirmationResult> {
	const parsed = confirmClaimSubjectsInputSchema.safeParse(input);
	if (!parsed.success) {
		throw new ClaimSubjectConfirmationServiceError(
			"CLAIM_SUBJECT_DECISIONS_INVALID",
		);
	}
	const decisions = parsed.data
		.decisions as readonly ConfirmClaimSubjectsDecision[];
	const result = await confirmScriptVersionClaimSubjectsRecord({
		actor,
		scriptVersionId: parsed.data.scriptVersionId,
		expectedScriptVersionRevision: parsed.data.expectedScriptVersionRevision,
		decisions,
	});
	if (result.kind === "confirmed") {
		return {
			kind: "confirmed",
			previousRevision: result.previousRevision,
			resultRevision: result.resultRevision,
			scriptVersion: result.record,
		};
	}
	if (result.kind === "not_required") {
		return { kind: "not_required", scriptVersion: result.record };
	}
	return throwConfirmationError(result);
}

type PublicErrorCode =
	| "NOT_FOUND"
	| "CONFLICT"
	| "BAD_REQUEST"
	| "INTERNAL_SERVER_ERROR";

function publicError(
	code: PublicErrorCode,
	message: string,
	publicCode: string,
	metadata?: { latestRevision?: number },
): never {
	throw new ORPCError(code, {
		message,
		data: { code: publicCode, ...metadata },
	});
}

export function toClaimSubjectConfirmationPublicError(error: unknown): never {
	if (!(error instanceof ClaimSubjectConfirmationServiceError)) throw error;
	if (error.code === "CLAIM_SUBJECT_CONFIRMATION_NOT_FOUND") {
		return publicError(
			"NOT_FOUND",
			"CLAIM_SUBJECT_CONFIRMATION_NOT_FOUND",
			error.code,
		);
	}
	if (
		error.code === "SCRIPT_VERSION_CONFLICT" ||
		error.code === "SCRIPT_CLAIMS_NOT_CURRENT" ||
		error.code === "CLAIM_SUBJECT_CONFIRMATION_IMMUTABLE" ||
		error.code === "CLAIM_SUBJECT_CONFIRMATION_NOT_ELIGIBLE"
	) {
		return publicError("CONFLICT", error.code, error.code, error.metadata);
	}
	if (
		error.code === "CLAIM_SUBJECT_DECISIONS_INVALID" ||
		error.code === "CLAIM_SUBJECT_CONFIRMATION_REQUIRED"
	) {
		return publicError("BAD_REQUEST", error.code, error.code);
	}
	return publicError(
		"INTERNAL_SERVER_ERROR",
		"CLAIM_SUBJECT_CONFIRMATION_FAILED",
		"CLAIM_SUBJECT_CONFIRMATION_FAILED",
	);
}
