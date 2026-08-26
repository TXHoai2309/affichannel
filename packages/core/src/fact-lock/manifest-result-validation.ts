import { z } from "zod";
import { claimOccurrenceSchema } from "../script-generation/schema";
import { parseSingleJsonObject } from "../script-generation/structured-json";
import type { ManifestFactLockVerificationInput } from "./manifest-contract";
import {
	FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	type FactLockClassification,
	type FactLockFactRelation,
	factLockClassifications,
	factLockFactRelations,
} from "./types";

const providerClaimKeySchema = z.string().trim().min(1).max(120);

const manifestProviderResultClaimSchema = z
	.object({
		claimKey: providerClaimKeySchema,
		classificationStatus: z.enum(factLockClassifications),
		reason: z.string().trim().min(1).max(2_000),
		confidence: z.number().min(0).max(1).nullable().optional().default(null),
		suggestionText: z
			.string()
			.trim()
			.max(4_000)
			.nullable()
			.optional()
			.default(null),
		factMappings: z
			.array(
				z
					.object({
						factId: z.string().trim().min(1).max(120),
						relation: z.enum(factLockFactRelations),
					})
					.strict(),
			)
			.max(32),
		// These fields are accepted only for compatibility with the legacy
		// output envelope. They never become Manifest authority.
		claimText: z.string().trim().min(1).max(4_000).optional(),
		occurrence: claimOccurrenceSchema.optional(),
	})
	.strict();

export const manifestFactLockProviderResultSchema = z
	.object({
		schemaVersion: z.literal(FACT_LOCK_OUTPUT_SCHEMA_VERSION),
		claims: z.array(manifestProviderResultClaimSchema).max(64),
	})
	.strict()
	.superRefine((output, context) => {
		const keys = output.claims.map((claim) => claim.claimKey);
		if (new Set(keys).size !== keys.length) {
			context.addIssue({
				code: "custom",
				path: ["claims"],
				message: "DUPLICATE_CLAIM_KEY",
			});
		}
		for (const [index, claim] of output.claims.entries()) {
			const mappings = claim.factMappings.map(
				(mapping) => `${mapping.factId}:${mapping.relation}`,
			);
			if (new Set(mappings).size !== mappings.length) {
				context.addIssue({
					code: "custom",
					path: ["claims", index, "factMappings"],
					message: "DUPLICATE_FACT_MAPPING",
				});
			}
		}
	});

export type ManifestFactLockProviderResultInput = z.input<
	typeof manifestFactLockProviderResultSchema
>;

export const manifestFactLockProviderResultIssueCodes = [
	"MALFORMED_RESULT",
	"RESULT_COUNT_MISMATCH",
	"MISSING_CLAIM",
	"EXTRA_CLAIM",
	"UNKNOWN_CLAIM_KEY",
	"DUPLICATE_CLAIM_KEY",
	"INVALID_FACT_REFERENCE",
	"DUPLICATE_FACT_MAPPING",
	"CLAIM_TEXT_MISMATCH",
	"CLAIM_LOCATOR_MISMATCH",
] as const;

export type ManifestFactLockProviderResultIssueCode =
	(typeof manifestFactLockProviderResultIssueCodes)[number];

export type ManifestFactLockCanonicalClaimResult = Readonly<{
	claimKey: string;
	claimText: string;
	locator: ManifestFactLockVerificationInput["claims"][number]["locator"];
	sourceTextHash: string;
	classificationStatus: FactLockClassification;
	reason: string;
	confidence: number | null;
	suggestionText: string | null;
	factMappings: ReadonlyArray<{
		factId: string;
		factRevision: number;
		relation: FactLockFactRelation;
	}>;
}>;

export type ManifestFactLockProviderResultValidation =
	| {
			success: true;
			claims: readonly ManifestFactLockCanonicalClaimResult[];
	  }
	| {
			success: false;
			code: "FACT_LOCK_PROVIDER_RESULT_MISMATCH";
			issueCodes: readonly ManifestFactLockProviderResultIssueCode[];
	  };

function invalidResult(
	...issueCodes: ManifestFactLockProviderResultIssueCode[]
): ManifestFactLockProviderResultValidation {
	return {
		success: false,
		code: "FACT_LOCK_PROVIDER_RESULT_MISMATCH",
		issueCodes: [...new Set(issueCodes)],
	};
}

function schemaIssueCodes(error: z.ZodError) {
	const known = new Set<ManifestFactLockProviderResultIssueCode>([
		"DUPLICATE_CLAIM_KEY",
		"DUPLICATE_FACT_MAPPING",
	]);
	const codes = error.issues
		.filter((issue) =>
			known.has(issue.message as ManifestFactLockProviderResultIssueCode),
		)
		.map((issue) => issue.message as ManifestFactLockProviderResultIssueCode);
	return codes.length > 0 ? codes : ["MALFORMED_RESULT" as const];
}

/**
 * Validates a Manifest-mode provider result and returns results in Manifest
 * order. Provider claimText/occurrence fields are compatibility input only;
 * Manifest claimText/locator/sourceTextHash remain authoritative.
 */
export function validateManifestFactLockProviderResult(
	raw: unknown,
	input: ManifestFactLockVerificationInput,
): ManifestFactLockProviderResultValidation {
	const parsedRoot = parseSingleJsonObject(raw);
	if (!parsedRoot.success) return invalidResult("MALFORMED_RESULT");
	const parsed = manifestFactLockProviderResultSchema.safeParse(
		parsedRoot.data,
	);
	if (!parsed.success) return invalidResult(...schemaIssueCodes(parsed.error));

	const expectedKeys = input.claims.map((claim) => claim.claimKey);
	const expectedSet = new Set(expectedKeys);
	const receivedKeys = parsed.data.claims.map((claim) => claim.claimKey);
	const receivedSet = new Set(receivedKeys);
	const setIssues: ManifestFactLockProviderResultIssueCode[] = [];
	if (parsed.data.claims.length !== input.claims.length)
		setIssues.push("RESULT_COUNT_MISMATCH");
	if (parsed.data.claims.length < input.claims.length)
		setIssues.push("MISSING_CLAIM");
	if (parsed.data.claims.length > input.claims.length)
		setIssues.push("EXTRA_CLAIM");
	if (new Set(receivedKeys).size !== receivedKeys.length)
		setIssues.push("DUPLICATE_CLAIM_KEY");
	if (receivedKeys.some((key) => !expectedSet.has(key)))
		setIssues.push("UNKNOWN_CLAIM_KEY");
	if (expectedKeys.some((key) => !receivedSet.has(key)))
		setIssues.push("MISSING_CLAIM");
	if (setIssues.length > 0) return invalidResult(...setIssues);

	const facts = new Map(input.productFacts.map((fact) => [fact.id, fact]));
	const byKey = new Map(
		parsed.data.claims.map((claim) => [claim.claimKey, claim]),
	);
	const canonicalByKey = new Map<
		string,
		ManifestFactLockCanonicalClaimResult
	>();
	for (const manifestClaim of input.claims) {
		const providerClaim = byKey.get(manifestClaim.claimKey);
		if (!providerClaim) return invalidResult("MISSING_CLAIM");
		const factMappings = providerClaim.factMappings.map((mapping) => {
			const fact = facts.get(mapping.factId);
			return fact
				? {
						factId: fact.id,
						factRevision: fact.revision,
						relation: mapping.relation,
					}
				: null;
		});
		if (factMappings.some((mapping) => mapping === null))
			return invalidResult("INVALID_FACT_REFERENCE");
		canonicalByKey.set(manifestClaim.claimKey, {
			claimKey: manifestClaim.claimKey,
			claimText: manifestClaim.claimText,
			locator: manifestClaim.locator,
			sourceTextHash: manifestClaim.sourceTextHash,
			classificationStatus: providerClaim.classificationStatus,
			reason: providerClaim.reason,
			confidence: providerClaim.confidence,
			suggestionText: providerClaim.suggestionText,
			factMappings: factMappings as Array<{
				factId: string;
				factRevision: number;
				relation: FactLockFactRelation;
			}>,
		});
	}

	const orderedClaims: ManifestFactLockCanonicalClaimResult[] = [];
	for (const claim of input.claims) {
		const canonical = canonicalByKey.get(claim.claimKey);
		if (!canonical) return invalidResult("MISSING_CLAIM");
		orderedClaims.push(canonical);
	}
	return { success: true, claims: orderedClaims };
}
