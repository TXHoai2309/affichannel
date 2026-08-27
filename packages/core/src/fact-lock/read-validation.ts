import { z } from "zod";
import { claimManifestSourceSchema } from "../claim-manifest/schema";
import {
	factEvidenceStatuses,
	factFreshnessReasons,
	factFreshnessStatuses,
	factGenerationUsabilities,
} from "../product-fact/freshness";
import { productFactTypes } from "../product-fact/types";
import { outputRulesSchema } from "../script-generation/input-contract";
import { scriptVersionEditableSnapshotSchema } from "../script-version/schema";
import { FACT_LOCK_MANIFEST_INPUT_MODE } from "./manifest-contract";
import { FACT_LOCK_MANIFEST_INPUT_VERSION } from "./manifest-request-hash";
import { FACT_LOCK_SNAPSHOT_VERSION } from "./types";

const idSchema = z.string().trim().min(1).max(120);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const factAssessmentSchema = z
	.object({
		verification: z.literal("verified"),
		evidence: z.enum(factEvidenceStatuses),
		freshness: z.enum(factFreshnessStatuses),
		freshnessReason: z.enum(factFreshnessReasons),
	})
	.strict();

const factSourceSchema = z
	.object({
		type: z.string().trim().min(1).nullable(),
		label: z.string().nullable(),
		url: z.string().nullable(),
		confirmedAt: z.string().nullable(),
		expiresAt: z.string().nullable(),
	})
	.strict();

const factSnapshotSchema = z
	.object({
		id: idSchema,
		revision: z.number().int().positive(),
		content: z.string().min(1),
		type: z.enum(productFactTypes),
		status: z.literal("verified"),
		assessment: factAssessmentSchema,
		generationUsability: z.enum(factGenerationUsabilities),
		source: factSourceSchema,
	})
	.strict();

const legacyPolicySchema = z
	.object({
		avoidWords: z.array(z.string()),
		affiliateDisclosure: z.string(),
		language: z.literal("vi-VN"),
	})
	.strict();

export const factLockInputSnapshotSchema = z
	.object({
		snapshotVersion: z.literal(FACT_LOCK_SNAPSHOT_VERSION),
		scriptVersion: z
			.object({
				id: idSchema,
				revision: z.number().int().positive(),
				snapshot: scriptVersionEditableSnapshotSchema,
			})
			.strict(),
		productFacts: z.array(factSnapshotSchema),
		policy: legacyPolicySchema,
		outputRules: outputRulesSchema,
	})
	.strict();

const manifestPolicySchema = z
	.object({
		avoidWords: z.array(z.string()),
		affiliateDisclosure: z.string(),
		language: z.literal("vi-VN"),
	})
	.strict();

const manifestZeroClaimSchema = z
	.object({
		status: z.literal("passed"),
		providerRequired: z.literal(false),
		dependenciesRequired: z.literal(false),
	})
	.strict();

export const manifestFactLockInputSnapshotSchema = z
	.object({
		inputMode: z.literal(FACT_LOCK_MANIFEST_INPUT_MODE),
		inputVersion: z.literal(FACT_LOCK_MANIFEST_INPUT_VERSION),
		claimManifest: z.object({ id: idSchema, fingerprint: hashSchema }).strict(),
		source: claimManifestSourceSchema,
		productFacts: z.array(
			factSnapshotSchema.extend({
				generationUsability: z.enum(["allowed", "allowed_with_warning"]),
			}),
		),
		productFactsFingerprint: hashSchema.optional(),
		policy: manifestPolicySchema.nullable(),
		outputRules: outputRulesSchema.nullable(),
		zeroClaim: manifestZeroClaimSchema.nullable(),
	})
	.strict()
	.superRefine((snapshot, context) => {
		const isZeroClaim = snapshot.zeroClaim !== null;
		if (isZeroClaim && snapshot.productFacts.length > 0) {
			context.addIssue({
				code: "custom",
				path: ["productFacts"],
				message: "ZERO_CLAIM_FACTS_NOT_EMPTY",
			});
		}
		if (isZeroClaim && snapshot.productFactsFingerprint !== undefined) {
			context.addIssue({
				code: "custom",
				path: ["productFactsFingerprint"],
				message: "ZERO_CLAIM_FACT_FINGERPRINT_PRESENT",
			});
		}
		if (!isZeroClaim) {
			if (snapshot.productFacts.length === 0)
				context.addIssue({
					code: "custom",
					path: ["productFacts"],
					message: "NON_EMPTY_FACTS_MISSING",
				});
			if (!snapshot.productFactsFingerprint)
				context.addIssue({
					code: "custom",
					path: ["productFactsFingerprint"],
					message: "NON_EMPTY_FACT_FINGERPRINT_MISSING",
				});
			if (!snapshot.policy || !snapshot.outputRules)
				context.addIssue({
					code: "custom",
					path: ["policy"],
					message: "NON_EMPTY_POLICY_MISSING",
				});
		}
		if (snapshot.source.sourceType !== "SCRIPT_VERSION") {
			context.addIssue({
				code: "custom",
				path: ["source"],
				message: "MANIFEST_SOURCE_UNSUPPORTED",
			});
		}
	});

export type ParsedFactLockInputSnapshot = z.infer<
	typeof factLockInputSnapshotSchema
>;
export type ParsedManifestFactLockInputSnapshot = z.infer<
	typeof manifestFactLockInputSnapshotSchema
>;
