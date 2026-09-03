import { z } from "zod";
import { claimSubjectSchema } from "../claim-subject/schema";
import { claimOccurrenceSchema } from "../script-generation/schema";
import {
	CLAIM_MANIFEST_BUILDER_VERSION,
	CLAIM_MANIFEST_BUILDER_VERSION_V2,
	CLAIM_MANIFEST_MAX_CLAIMS,
	CLAIM_MANIFEST_SCHEMA_VERSION,
	claimManifestSourceTypes,
	noScriptSourceElementKinds,
} from "./types";

const idSchema = z.string().trim().min(1).max(120);
const versionLabelSchema = z.string().trim().min(1);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const claimKeySchema = z.string().regex(/^claim_[a-f0-9]{64}$/);

export const noScriptSourceElementSchema = z
	.object({
		kind: z.enum(noScriptSourceElementKinds),
		key: idSchema,
		revision: versionLabelSchema,
		contentHash: hashSchema,
	})
	.strict();

export const scriptVersionClaimManifestSourceSchema = z
	.object({
		sourceType: z.literal("SCRIPT_VERSION"),
		scriptVersionId: idSchema,
		scriptVersionRevision: z.number().int().positive(),
		claimsSourceRevision: z.number().int().positive(),
		sourceContentHash: hashSchema,
	})
	.strict();

export const noScriptClaimManifestSourceSchema = z
	.object({
		sourceType: z.literal("NO_SCRIPT"),
		sourceSchemaVersion: versionLabelSchema,
		sourceRevision: versionLabelSchema,
		elements: z.array(noScriptSourceElementSchema),
		sourceContentHash: hashSchema,
	})
	.strict();

export const claimManifestSourceSchema = z.discriminatedUnion("sourceType", [
	scriptVersionClaimManifestSourceSchema,
	noScriptClaimManifestSourceSchema,
]);

export const scriptVersionClaimManifestLocatorSchema = z
	.object({
		sourceType: z.literal("SCRIPT_VERSION"),
		occurrence: claimOccurrenceSchema,
	})
	.strict();

export const noScriptClaimManifestLocatorSchema = z
	.object({
		sourceType: z.literal("NO_SCRIPT"),
		elementKind: z.enum(noScriptSourceElementKinds),
		elementKey: idSchema,
	})
	.strict();

export const claimManifestLocatorSchema = z.discriminatedUnion("sourceType", [
	scriptVersionClaimManifestLocatorSchema,
	noScriptClaimManifestLocatorSchema,
]);

export const claimManifestClaimSchema = z
	.object({
		claimKey: claimKeySchema,
		claimText: z
			.string()
			.min(1)
			.max(4_000)
			.refine((value) => value === value.trim(), {
				message: "Claim text must already be validated and outer-trimmed.",
			}),
		locator: claimManifestLocatorSchema,
		sourceTextHash: hashSchema,
	})
	.strict();

export const builtClaimManifestSchema = z
	.object({
		workspaceId: idSchema,
		projectId: idSchema,
		source: claimManifestSourceSchema,
		productId: idSchema.nullable(),
		schemaVersion: z.literal(CLAIM_MANIFEST_SCHEMA_VERSION),
		builderVersion: z.literal(CLAIM_MANIFEST_BUILDER_VERSION),
		claims: z.array(claimManifestClaimSchema).max(CLAIM_MANIFEST_MAX_CLAIMS),
		claimCount: z.number().int().min(0).max(CLAIM_MANIFEST_MAX_CLAIMS),
		isEmpty: z.boolean(),
		fingerprint: hashSchema,
	})
	.strict()
	.superRefine((manifest, context) => {
		if (manifest.claimCount !== manifest.claims.length) {
			context.addIssue({
				code: "custom",
				path: ["claimCount"],
				message: "CLAIM_COUNT_MISMATCH",
			});
		}
		if (manifest.isEmpty !== (manifest.claims.length === 0)) {
			context.addIssue({
				code: "custom",
				path: ["isEmpty"],
				message: "CLAIM_EMPTY_MISMATCH",
			});
		}
		if (
			new Set(manifest.claims.map((claim) => claim.claimKey)).size !==
			manifest.claims.length
		) {
			context.addIssue({
				code: "custom",
				path: ["claims"],
				message: "DUPLICATE_CLAIM_KEY",
			});
		}
		for (const [index, claim] of manifest.claims.entries()) {
			if (claim.locator.sourceType !== manifest.source.sourceType) {
				context.addIssue({
					code: "custom",
					path: ["claims", index, "locator"],
					message: "CLAIM_REFERENCE_INVALID",
				});
			}
			if (
				manifest.source.sourceType === "NO_SCRIPT" &&
				claim.locator.sourceType === "NO_SCRIPT"
			) {
				const locator = claim.locator;
				if (
					!manifest.source.elements.some(
						(element) =>
							element.kind === locator.elementKind &&
							element.key === locator.elementKey,
					)
				) {
					context.addIssue({
						code: "custom",
						path: ["claims", index, "locator"],
						message: "CLAIM_REFERENCE_INVALID",
					});
				}
			}
		}
	});

/** Organic subject-aware manifest payload. The v1 envelope is retained. */
export const subjectAwareClaimManifestClaimSchema = claimManifestClaimSchema
	.extend({
		subject: claimSubjectSchema,
		subjectStatus: z.literal("CONFIRMED"),
		subjectSource: z.enum(["USER", "STRUCTURED_SOURCE"]),
	})
	.strict();

export const builtSubjectAwareClaimManifestSchema = z
	.object({
		workspaceId: idSchema,
		projectId: idSchema,
		source: scriptVersionClaimManifestSourceSchema,
		productId: idSchema.nullable(),
		schemaVersion: z.literal(CLAIM_MANIFEST_SCHEMA_VERSION),
		builderVersion: z.literal(CLAIM_MANIFEST_BUILDER_VERSION_V2),
		claims: z
			.array(subjectAwareClaimManifestClaimSchema)
			.max(CLAIM_MANIFEST_MAX_CLAIMS),
		claimCount: z.number().int().min(0).max(CLAIM_MANIFEST_MAX_CLAIMS),
		isEmpty: z.boolean(),
		fingerprint: hashSchema,
	})
	.strict()
	.superRefine((manifest, context) => {
		if (manifest.claimCount !== manifest.claims.length) {
			context.addIssue({
				code: "custom",
				path: ["claimCount"],
				message: "CLAIM_COUNT_MISMATCH",
			});
		}
		if (manifest.isEmpty !== (manifest.claims.length === 0)) {
			context.addIssue({
				code: "custom",
				path: ["isEmpty"],
				message: "CLAIM_EMPTY_MISMATCH",
			});
		}
		if (
			new Set(manifest.claims.map((claim) => claim.claimKey)).size !==
			manifest.claims.length
		) {
			context.addIssue({
				code: "custom",
				path: ["claims"],
				message: "DUPLICATE_CLAIM_KEY",
			});
		}
		for (const [index, claim] of manifest.claims.entries()) {
			if (claim.locator.sourceType !== manifest.source.sourceType) {
				context.addIssue({
					code: "custom",
					path: ["claims", index, "locator"],
					message: "CLAIM_REFERENCE_INVALID",
				});
			}
		}
	});

export const buildClaimManifestFromScriptVersionInputSchema = z
	.object({
		workspaceId: idSchema,
		projectId: idSchema,
		productId: idSchema.nullable(),
		scriptVersionId: idSchema,
		scriptVersionRevision: z.number().int().positive(),
		snapshot: z.unknown(),
	})
	.strict();

export const claimManifestSourceTypeSchema = z.enum(claimManifestSourceTypes);
