import { z } from "zod";
import { sha256Hex } from "../claim-manifest/canonicalization";
import {
	factEvidenceStatuses,
	factFreshnessReasons,
	factFreshnessStatuses,
} from "../product-fact/freshness";
import { productFactTypes } from "../product-fact/types";
import {
	FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	FACT_LOCK_ZERO_CLAIM_PROMPT_VERSION,
} from "./types";

export const FACT_LOCK_MANIFEST_INPUT_VERSION_V1 =
	"fact-lock.manifest.v1" as const;
export const FACT_LOCK_MANIFEST_INPUT_VERSION_V2 =
	"fact-lock.manifest.v2" as const;
/** Historical name retained for the Affiliate v1 contract. */
export const FACT_LOCK_MANIFEST_INPUT_VERSION =
	FACT_LOCK_MANIFEST_INPUT_VERSION_V1;

export const FACT_LOCK_ZERO_CLAIM_POLICY = {
	kind: "fact-lock-zero-claim",
	inputVersion: FACT_LOCK_MANIFEST_INPUT_VERSION,
	promptVersion: FACT_LOCK_ZERO_CLAIM_PROMPT_VERSION,
	outputSchemaVersion: FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	providerRequired: false,
	dependenciesRequired: false,
	outcomeStatus: "passed",
} as const;

export function factLockZeroClaimPolicyProjection() {
	return { ...FACT_LOCK_ZERO_CLAIM_POLICY };
}

export function computeFactLockZeroClaimPolicyHash(): Promise<string> {
	return sha256Hex(factLockZeroClaimPolicyProjection());
}

export const sha256HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const productFactIdSchema = z.string().trim().min(1).max(120);
const productFactAssessmentSchema = z
	.object({
		verification: z.literal("verified"),
		evidence: z.enum(factEvidenceStatuses),
		freshness: z.enum(factFreshnessStatuses),
		freshnessReason: z.enum(factFreshnessReasons),
	})
	.strict();

export const manifestProductFactSnapshotSchema = z
	.object({
		id: productFactIdSchema,
		revision: z.number().int().positive(),
		content: z.string().min(1),
		type: z.enum(productFactTypes),
		status: z.literal("verified"),
		assessment: productFactAssessmentSchema,
		generationUsability: z.enum(["allowed", "allowed_with_warning"]),
		source: z
			.object({
				type: z.string().trim().min(1).nullable(),
				label: z.string().nullable(),
				url: z.string().nullable(),
				confirmedAt: z.string().nullable(),
				expiresAt: z.string().nullable(),
			})
			.strict(),
	})
	.strict();

export const manifestProductFactsSnapshotSchema = z
	.array(manifestProductFactSnapshotSchema)
	.superRefine((facts, context) => {
		const ids = facts.map((fact) => fact.id);
		if (new Set(ids).size !== ids.length) {
			context.addIssue({
				code: "custom",
				path: [],
				message: "DUPLICATE_PRODUCT_FACT_ID",
			});
		}
	});

export type ManifestProductFactSnapshot = z.infer<
	typeof manifestProductFactSnapshotSchema
>;
export type ManifestProductFactsSnapshot = z.infer<
	typeof manifestProductFactsSnapshotSchema
>;

const fingerprintInputProductFactSchema = manifestProductFactSnapshotSchema
	.extend({
		workspaceId: z.unknown().optional(),
		productId: z.unknown().optional(),
		notes: z.unknown().optional(),
		createdByUserId: z.unknown().optional(),
		updatedByUserId: z.unknown().optional(),
		createdAt: z.unknown().optional(),
		updatedAt: z.unknown().optional(),
	})
	.strict();

const fingerprintInputSnapshotSchema = z
	.array(fingerprintInputProductFactSchema)
	.superRefine((facts, context) => {
		const ids = facts.map((fact) => fact.id);
		if (new Set(ids).size !== ids.length) {
			context.addIssue({
				code: "custom",
				path: [],
				message: "DUPLICATE_PRODUCT_FACT_ID",
			});
		}
	});

function compareIds(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The projection intentionally copies only the Product Fact fields consumed by
 * the existing Fact Lock verification policy. Top-level facts are sorted by id;
 * nested semantic arrays are not silently reordered because this shape has none.
 */
export function productFactsFingerprintProjection(
	snapshot: unknown,
): ManifestProductFactsSnapshot {
	const parsed = fingerprintInputSnapshotSchema.parse(snapshot);
	return [...parsed]
		.sort((left, right) => compareIds(left.id, right.id))
		.map((fact) => ({
			id: fact.id,
			revision: fact.revision,
			content: fact.content,
			type: fact.type,
			status: fact.status,
			assessment: {
				verification: fact.assessment.verification,
				evidence: fact.assessment.evidence,
				freshness: fact.assessment.freshness,
				freshnessReason: fact.assessment.freshnessReason,
			},
			generationUsability: fact.generationUsability,
			source: {
				type: fact.source.type,
				label: fact.source.label,
				url: fact.source.url,
				confirmedAt: fact.source.confirmedAt,
				expiresAt: fact.source.expiresAt,
			},
		}));
}

export async function computeProductFactsFingerprint(
	snapshot: unknown,
): Promise<string> {
	return sha256Hex(productFactsFingerprintProjection(snapshot));
}

const manifestRequestHashInputSchema = z
	.object({
		claimManifestFingerprint: sha256HashSchema,
		productFactsFingerprint: sha256HashSchema,
	})
	.strict();

const zeroClaimRequestHashInputSchema = z
	.object({
		claimManifestFingerprint: sha256HashSchema,
	})
	.strict();

export type ManifestRequestHashInput = z.infer<
	typeof manifestRequestHashInputSchema
>;
export type ZeroClaimManifestRequestHashInput = z.infer<
	typeof zeroClaimRequestHashInputSchema
>;

export const manifestV2RequestHashInputSchema = manifestRequestHashInputSchema;
export type ManifestV2RequestHashInput = z.infer<
	typeof manifestV2RequestHashInputSchema
>;

export function manifestRequestHashProjection(input: unknown) {
	const parsed = manifestRequestHashInputSchema.parse(input);
	return {
		inputVersion: FACT_LOCK_MANIFEST_INPUT_VERSION,
		claimManifestFingerprint: parsed.claimManifestFingerprint,
		productFactsFingerprint: parsed.productFactsFingerprint,
	};
}

export function zeroClaimManifestRequestHashProjection(input: unknown) {
	const parsed = zeroClaimRequestHashInputSchema.parse(input);
	return {
		inputVersion: FACT_LOCK_MANIFEST_INPUT_VERSION,
		claimManifestFingerprint: parsed.claimManifestFingerprint,
		zeroClaims: true as const,
	};
}

export async function computeManifestRequestHash(
	input: ManifestRequestHashInput,
): Promise<string> {
	return sha256Hex(manifestRequestHashProjection(input));
}

export async function computeZeroClaimManifestRequestHash(
	input: ZeroClaimManifestRequestHashInput,
): Promise<string> {
	return sha256Hex(zeroClaimManifestRequestHashProjection(input));
}

export function manifestV2RequestHashProjection(input: unknown) {
	const parsed = manifestV2RequestHashInputSchema.parse(input);
	return {
		inputVersion: FACT_LOCK_MANIFEST_INPUT_VERSION_V2,
		claimManifestFingerprint: parsed.claimManifestFingerprint,
		productFactsFingerprint: parsed.productFactsFingerprint,
	};
}

export async function computeManifestV2RequestHash(
	input: ManifestV2RequestHashInput,
): Promise<string> {
	return sha256Hex(manifestV2RequestHashProjection(input));
}
