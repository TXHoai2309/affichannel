import type { ScriptVersionReadModel } from "@affichannel/core";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { ScriptClaimRefreshRepositoryError } from "./script-claim-refresh-repository";
import type { ScriptClaimRefreshExecutionResult } from "./script-claim-refresh-service";

const idSchema = z.string().trim().min(1).max(120);

export const scriptClaimRefreshInputSchema = z
	.object({
		projectId: idSchema,
		scriptVersionId: idSchema,
		expectedScriptVersionRevision: z.number().int().positive(),
		idempotencyKey: z.string().trim().min(8).max(200),
	})
	.strict();

export type ScriptClaimRefreshPublicInput = z.infer<
	typeof scriptClaimRefreshInputSchema
>;

export type ScriptClaimRefreshPublicResult =
	| Readonly<{
			kind: "not_required";
			scriptVersion: ScriptVersionReadModel;
	  }>
	| Readonly<{
			kind: "completed";
			runId: string;
			status: "completed";
			resultScriptRevision: number;
			scriptVersion: ScriptVersionReadModel;
	  }>
	| Readonly<{
			kind: "pending";
			runId: string;
			status: "pending";
	  }>
	| Readonly<{
			kind: "failed" | "indeterminate";
			runId: string;
			status: "failed" | "indeterminate";
			errorCode: string;
	  }>;

export function toPublicScriptClaimRefreshResult(
	result: ScriptClaimRefreshExecutionResult,
): ScriptClaimRefreshPublicResult {
	if (result.kind === "not_required") {
		return {
			kind: "not_required",
			scriptVersion: result.scriptVersion,
		};
	}
	if (result.kind === "completed") {
		return {
			kind: "completed",
			runId: result.run.id,
			status: "completed",
			resultScriptRevision: result.resultingScriptVersion.revision,
			scriptVersion: result.resultingScriptVersion,
		};
	}
	if (result.kind === "pending") {
		return {
			kind: "pending",
			runId: result.run.id,
			status: "pending",
		};
	}
	return {
		kind: result.kind,
		runId: result.run.id,
		status: result.kind,
		errorCode:
			result.run.errorCode ??
			`SCRIPT_CLAIM_REFRESH_${result.kind.toUpperCase()}`,
	};
}

type PublicError = {
	code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST" | "INTERNAL_SERVER_ERROR";
	message: string;
	data: { code: string };
};

function publicError(
	code: PublicError["code"],
	message: string,
	publicCode: string,
): never {
	throw new ORPCError(code, {
		message,
		data: { code: publicCode },
	});
}

function serviceCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? typeof (error as { code?: unknown }).code === "string"
			? (error as { code: string }).code
			: undefined
		: undefined;
}

export function toScriptClaimRefreshPublicError(error: unknown): never {
	const code = serviceCode(error);
	if (
		code === "SCRIPT_CLAIM_REFRESH_PROJECT_NOT_FOUND" ||
		code === "SCRIPT_CLAIM_REFRESH_SOURCE_NOT_FOUND" ||
		code === "SCRIPT_CLAIM_REFRESH_PRODUCT_NOT_FOUND" ||
		code === "SCRIPT_CLAIM_REFRESH_NOT_FOUND"
	) {
		return publicError(
			"NOT_FOUND",
			"SCRIPT_CLAIM_REFRESH_NOT_FOUND",
			"SCRIPT_CLAIM_REFRESH_NOT_FOUND",
		);
	}
	if (
		code === "SCRIPT_CLAIM_REFRESH_SOURCE_REVISION_CONFLICT" ||
		code === "SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED" ||
		code === "SCRIPT_CLAIM_REFRESH_IDEMPOTENCY_CONFLICT"
	) {
		return publicError("CONFLICT", code, code);
	}
	if (
		code === "SCRIPT_CLAIM_REFRESH_NOT_ELIGIBLE" ||
		code === "SCRIPT_CLAIM_REFRESH_SOURCE_NOT_USABLE" ||
		code === "SCRIPT_CLAIM_REFRESH_CLAIMS_STATE_INVALID"
	) {
		return publicError("CONFLICT", code, code);
	}
	if (
		code === "SCRIPT_CLAIM_REFRESH_INPUT_INVALID" ||
		code === "SCRIPT_CLAIM_REFRESH_PROVIDER_NOT_CONFIGURED"
	) {
		return publicError("BAD_REQUEST", code, code);
	}
	if (
		error instanceof ScriptClaimRefreshRepositoryError ||
		code === "SCRIPT_CLAIM_REFRESH_PERSISTED_DATA_INVALID"
	) {
		return publicError(
			"INTERNAL_SERVER_ERROR",
			"SCRIPT_CLAIM_REFRESH_FAILED",
			"SCRIPT_CLAIM_REFRESH_FAILED",
		);
	}
	throw error;
}
