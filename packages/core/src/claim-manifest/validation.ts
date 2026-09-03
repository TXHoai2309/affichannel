import type { z } from "zod";
import { ClaimManifestError, type ClaimManifestIssueCode } from "./errors";
import {
	hasValidClaimManifestFingerprint,
	hasValidSubjectAwareClaimManifestFingerprint,
} from "./fingerprint";
import {
	builtClaimManifestSchema,
	builtSubjectAwareClaimManifestSchema,
} from "./schema";
import type { BuiltClaimManifest } from "./types";
import {
	CLAIM_MANIFEST_BUILDER_VERSION,
	CLAIM_MANIFEST_BUILDER_VERSION_V2,
} from "./types";

function immutable<T>(value: T): Readonly<T> {
	if (!value || typeof value !== "object" || Object.isFrozen(value))
		return value;
	for (const child of Object.values(value)) immutable(child);
	return Object.freeze(value);
}

function issueCodesFromZodError(error: z.ZodError): ClaimManifestIssueCode[] {
	const mapped = error.issues.flatMap((issue) => {
		if (issue.message === "CLAIM_COUNT_MISMATCH")
			return ["CLAIM_COUNT_MISMATCH" as const];
		if (issue.message === "CLAIM_EMPTY_MISMATCH")
			return ["CLAIM_EMPTY_MISMATCH" as const];
		if (issue.message === "DUPLICATE_CLAIM_KEY")
			return ["DUPLICATE_CLAIM_KEY" as const];
		if (issue.message === "CLAIM_REFERENCE_INVALID")
			return ["CLAIM_REFERENCE_INVALID" as const];
		if (issue.path[0] === "schemaVersion")
			return ["UNSUPPORTED_SCHEMA_VERSION" as const];
		if (issue.path[0] === "claims" && issue.code === "too_big")
			return ["CLAIM_LIMIT_EXCEEDED" as const];
		return ["INVALID_SOURCE" as const];
	});
	return [...new Set(mapped)];
}

export async function validateBuiltClaimManifest(
	raw: unknown,
): Promise<
	| { success: true; data: BuiltClaimManifest }
	| { success: false; error: ClaimManifestError }
> {
	const parsed = builtClaimManifestSchema.safeParse(raw);
	if (!parsed.success) {
		return {
			success: false,
			error: new ClaimManifestError(
				"INVALID_CLAIM_MANIFEST",
				issueCodesFromZodError(parsed.error),
			),
		};
	}
	const data = immutable(parsed.data) as BuiltClaimManifest;
	if (!(await hasValidClaimManifestFingerprint(data))) {
		return {
			success: false,
			error: new ClaimManifestError("INVALID_CLAIM_MANIFEST", [
				"FINGERPRINT_MISMATCH",
			]),
		};
	}
	return { success: true, data };
}

export async function parseBuiltClaimManifest(
	raw: unknown,
): Promise<BuiltClaimManifest> {
	const result = await validateBuiltClaimManifest(raw);
	if (!result.success) throw result.error;
	return result.data;
}

/** Version-aware parser. Unknown builders and malformed v2 rows fail closed. */
export async function validateClaimManifestByBuilderVersion(
	raw: unknown,
): Promise<
	| { success: true; data: BuiltClaimManifest }
	| { success: false; error: ClaimManifestError }
> {
	const builderVersion =
		raw && typeof raw === "object" && "builderVersion" in raw
			? (raw as { builderVersion?: unknown }).builderVersion
			: undefined;
	if (builderVersion === CLAIM_MANIFEST_BUILDER_VERSION) {
		return validateBuiltClaimManifest(raw);
	}
	if (builderVersion !== CLAIM_MANIFEST_BUILDER_VERSION_V2) {
		return {
			success: false,
			error: new ClaimManifestError("INVALID_CLAIM_MANIFEST", [
				"UNSUPPORTED_SCHEMA_VERSION",
			]),
		};
	}
	const parsed = builtSubjectAwareClaimManifestSchema.safeParse(raw);
	if (!parsed.success) {
		return {
			success: false,
			error: new ClaimManifestError(
				"INVALID_CLAIM_MANIFEST",
				issueCodesFromZodError(parsed.error),
			),
		};
	}
	const data = immutable(parsed.data) as BuiltClaimManifest;
	if (!(await hasValidSubjectAwareClaimManifestFingerprint(data))) {
		return {
			success: false,
			error: new ClaimManifestError("INVALID_CLAIM_MANIFEST", [
				"FINGERPRINT_MISMATCH",
			]),
		};
	}
	return { success: true, data };
}

export async function parseClaimManifestByBuilderVersion(
	raw: unknown,
): Promise<BuiltClaimManifest> {
	const result = await validateClaimManifestByBuilderVersion(raw);
	if (!result.success) throw result.error;
	return result.data;
}
