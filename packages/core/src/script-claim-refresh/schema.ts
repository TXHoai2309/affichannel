import { z } from "zod";

import { scriptClaimRefreshRunStatuses } from "./types";

const nonEmptyText = z
	.string()
	.min(1)
	.refine((value) => value === value.trim());
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const nullableNonNegativeInteger = z.number().int().nonnegative().nullable();
const nullableDate = z.date().nullable();

export const scriptClaimRefreshRunRecordSchema = z
	.object({
		id: nonEmptyText,
		workspaceId: nonEmptyText,
		projectId: nonEmptyText,
		scriptVersionId: nonEmptyText,
		sourceScriptRevision: z.number().int().positive(),
		idempotencyKey: z
			.string()
			.min(8)
			.max(200)
			.refine((value) => value === value.trim()),
		requestHash: hash,
		inputSnapshotJson: z.unknown().refine((value) => value !== undefined),
		inputHash: hash,
		sourceContentHash: hash,
		promptHash: hash,
		provider: nonEmptyText,
		model: nonEmptyText,
		promptVersion: nonEmptyText,
		outputSchemaVersion: nonEmptyText,
		status: z.enum(scriptClaimRefreshRunStatuses),
		providerRequestId: z.string().nullable(),
		inputTokens: nullableNonNegativeInteger,
		outputTokens: nullableNonNegativeInteger,
		estimatedCostMicros: z.bigint().nonnegative().nullable(),
		actualCostMicros: z.bigint().nonnegative().nullable(),
		currency: z
			.string()
			.regex(/^[A-Z]{3}$/)
			.nullable(),
		errorCode: z.string().nullable(),
		errorMessage: z.string().nullable(),
		executionClaimedAt: nullableDate,
		createdByUserId: nonEmptyText,
		createdAt: z.date(),
		finishedAt: nullableDate,
		resultScriptRevision: z.number().int().positive().nullable(),
	})
	.strict()
	.superRefine((run, context) => {
		if (
			run.resultScriptRevision !== null &&
			run.resultScriptRevision !== run.sourceScriptRevision + 1
		) {
			context.addIssue({
				code: "custom",
				path: ["resultScriptRevision"],
				message: "Result revision must be source revision plus one.",
			});
		}
		const errorPairValid =
			(run.errorCode === null && run.errorMessage === null) ||
			(run.errorCode !== null && run.errorMessage !== null);
		if (!errorPairValid) {
			context.addIssue({
				code: "custom",
				path: ["errorCode"],
				message: "Error code and message must be populated together.",
			});
		}
		if (
			run.status === "pending" &&
			(run.finishedAt !== null || run.resultScriptRevision !== null)
		) {
			context.addIssue({
				code: "custom",
				path: ["status"],
				message: "Pending runs cannot have a terminal result.",
			});
		}
		if (
			run.status === "completed" &&
			(run.finishedAt === null ||
				run.resultScriptRevision === null ||
				run.errorCode !== null ||
				run.errorMessage !== null)
		) {
			context.addIssue({
				code: "custom",
				path: ["status"],
				message: "Completed runs require a clean terminal result.",
			});
		}
		if (
			(run.status === "failed" || run.status === "indeterminate") &&
			(run.finishedAt === null || run.resultScriptRevision !== null)
		) {
			context.addIssue({
				code: "custom",
				path: ["status"],
				message: "Failed runs require a terminal timestamp and no result.",
			});
		}
	});

export type ScriptClaimRefreshRunRecord = z.infer<
	typeof scriptClaimRefreshRunRecordSchema
>;

export function parseScriptClaimRefreshRunRecord(
	value: unknown,
): ScriptClaimRefreshRunRecord {
	const result = scriptClaimRefreshRunRecordSchema.safeParse(value);
	if (!result.success) {
		throw new TypeError("Invalid persisted Script Claim Refresh run.");
	}
	return result.data;
}
