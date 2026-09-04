import { z } from "zod";
import {
	hasValidClaimManifestFingerprint,
	hasValidSubjectAwareClaimManifestFingerprint,
} from "../claim-manifest/fingerprint";
import {
	builtClaimManifestSchema,
	builtSubjectAwareClaimManifestSchema,
	claimManifestClaimSchema,
	subjectAwareClaimManifestClaimSchema,
} from "../claim-manifest/schema";
import type {
	ClaimManifest,
	ClaimManifestClaim,
	ClaimManifestLocator,
	SubjectAwareClaimManifestClaim,
} from "../claim-manifest/types";
import type { ContentType, CreationPath } from "../project/channel-first-types";
import type { ScriptVersionStatus } from "../script-version/types";
import { FactLockError } from "./errors";
import {
	FACT_LOCK_MANIFEST_INPUT_VERSION,
	FACT_LOCK_MANIFEST_INPUT_VERSION_V2,
	type ManifestProductFactsSnapshot,
	manifestProductFactsSnapshotSchema,
	sha256HashSchema,
} from "./manifest-request-hash";

export const FACT_LOCK_MANIFEST_INPUT_MODE = "MANIFEST_V1" as const;
export const factLockInputModeSchema = z.union([
	z.null(),
	z.literal(FACT_LOCK_MANIFEST_INPUT_MODE),
]);
export type FactLockInputMode = null | typeof FACT_LOCK_MANIFEST_INPUT_MODE;

export type LegacyFactLockInput = Readonly<{
	inputMode: null;
}>;

export type ManifestFactLockInput = Readonly<{
	inputMode: typeof FACT_LOCK_MANIFEST_INPUT_MODE;
	claimManifestId: string;
	claimManifestFingerprint: string;
}>;

const idSchema = z.string().trim().min(1).max(120);

export const manifestFactLockManifestSchema = z.union([
	builtClaimManifestSchema.extend({ id: idSchema }).strict(),
	builtSubjectAwareClaimManifestSchema.extend({ id: idSchema }).strict(),
]);

/** Frozen v1 public type retained for existing Affiliate callers. */
export type ManifestFactLockManifest = z.infer<
	typeof builtClaimManifestSchema
> & { id: string };
export type ManifestFactLockManifestAny = z.infer<
	typeof manifestFactLockManifestSchema
>;

export const manifestProviderClaimInputSchema = claimManifestClaimSchema;
export const manifestProviderV2ClaimInputSchema =
	subjectAwareClaimManifestClaimSchema;
export type ManifestProviderClaimInput = ClaimManifestClaim;
export type ManifestProviderV2ClaimInput = SubjectAwareClaimManifestClaim;

export const manifestFactLockVerificationInputSchema = z
	.object({
		inputVersion: z.literal(FACT_LOCK_MANIFEST_INPUT_VERSION),
		claimManifestId: idSchema,
		claimManifestFingerprint: sha256HashSchema,
		claims: z.array(manifestProviderClaimInputSchema).max(64),
		productFacts: manifestProductFactsSnapshotSchema,
	})
	.strict()
	.superRefine((input, context) => {
		const keys = input.claims.map((claim) => claim.claimKey);
		if (new Set(keys).size !== keys.length) {
			context.addIssue({
				code: "custom",
				path: ["claims"],
				message: "DUPLICATE_CLAIM_KEY",
			});
		}
	});

export const manifestFactLockVerificationInputV2Schema = z
	.object({
		inputVersion: z.literal(FACT_LOCK_MANIFEST_INPUT_VERSION_V2),
		claimManifestId: idSchema,
		claimManifestFingerprint: sha256HashSchema,
		claims: z.array(manifestProviderV2ClaimInputSchema).min(1).max(64),
		productFacts: manifestProductFactsSnapshotSchema.min(1),
	})
	.strict()
	.superRefine((input, context) => {
		const keys = input.claims.map((claim) => claim.claimKey);
		if (new Set(keys).size !== keys.length)
			context.addIssue({
				code: "custom",
				path: ["claims"],
				message: "DUPLICATE_CLAIM_KEY",
			});
		if (input.claims.some((claim) => claim.subject.kind !== "PRODUCT"))
			context.addIssue({
				code: "custom",
				path: ["claims"],
				message: "PRODUCT_SUBSET_INVALID",
			});
	});

export const manifestFactLockVerificationInputAnySchema = z.union([
	manifestFactLockVerificationInputSchema,
	manifestFactLockVerificationInputV2Schema,
]);

type ManifestFactLockVerificationInputShape = z.infer<
	typeof manifestFactLockVerificationInputSchema
>;
export type ManifestFactLockVerificationInputV1 = Readonly<
	Omit<ManifestFactLockVerificationInputShape, "claims" | "productFacts"> & {
		claims: readonly ManifestFactLockVerificationInputShape["claims"][number][];
		productFacts: readonly ManifestFactLockVerificationInputShape["productFacts"][number][];
	}
>;

type ManifestFactLockVerificationInputV2Shape = z.infer<
	typeof manifestFactLockVerificationInputV2Schema
>;
export type ManifestFactLockVerificationInputV2 = Readonly<
	Omit<ManifestFactLockVerificationInputV2Shape, "claims" | "productFacts"> & {
		claims: readonly ManifestFactLockVerificationInputV2Shape["claims"][number][];
		productFacts: readonly ManifestFactLockVerificationInputV2Shape["productFacts"][number][];
	}
>;

export type ManifestFactLockVerificationInput =
	| ManifestFactLockVerificationInputV1
	| ManifestFactLockVerificationInputV2;

const manifestFactLockVerificationInputSourceSchema = z
	.object({
		manifest: manifestFactLockManifestSchema,
		productFacts: manifestProductFactsSnapshotSchema,
	})
	.strict();

export type BuildManifestFactLockVerificationInput = z.input<
	typeof manifestFactLockVerificationInputSourceSchema
>;

function freezeObject<T extends object>(value: T): Readonly<T> {
	return Object.freeze(value);
}

function freezeVerificationInput<T extends ManifestFactLockVerificationInput>(
	input: T,
): T {
	return freezeObject({
		...input,
		claims: Object.freeze(
			input.claims.map((claim) =>
				freezeObject({
					...claim,
					locator: freezeObject({ ...claim.locator }),
					...("subject" in claim &&
					claim.subject &&
					typeof claim.subject === "object"
						? { subject: freezeObject({ ...claim.subject }) }
						: {}),
				}),
			),
		),
		productFacts: Object.freeze(
			input.productFacts.map((fact) =>
				freezeObject({
					...fact,
					assessment: freezeObject({ ...fact.assessment }),
					source: freezeObject({ ...fact.source }),
				}),
			),
		),
	}) as T;
}

/**
 * Builds the provider input from a validated server-owned Manifest. The
 * inputVersion is deliberately absent from the builder input and is inserted
 * here, so callers cannot choose semantic authority.
 */
export function buildManifestFactLockVerificationInput(
	input: unknown,
): ManifestFactLockVerificationInputV1 {
	const source = manifestFactLockVerificationInputSourceSchema.parse(input);
	return freezeVerificationInput(
		manifestFactLockVerificationInputSchema.parse({
			inputVersion: FACT_LOCK_MANIFEST_INPUT_VERSION,
			claimManifestId: source.manifest.id,
			claimManifestFingerprint: source.manifest.fingerprint,
			claims: source.manifest.claims,
			productFacts: source.productFacts,
		}),
	);
}

export function buildOrganicManifestFactLockVerificationInput(input: {
	manifest: ManifestExecutionEligibilityManifest;
	productClaims: readonly SubjectAwareClaimManifestClaim[];
	productFacts: readonly ManifestProductFactsSnapshot[number][];
}): ManifestFactLockVerificationInputV2 {
	return freezeVerificationInput(
		manifestFactLockVerificationInputV2Schema.parse({
			inputVersion: FACT_LOCK_MANIFEST_INPUT_VERSION_V2,
			claimManifestId: input.manifest.id,
			claimManifestFingerprint: input.manifest.fingerprint,
			claims: input.productClaims,
			productFacts: input.productFacts,
		}),
	) as ManifestFactLockVerificationInputV2;
}

export type ManifestExecutionEligibilityManifest = Pick<
	ClaimManifest,
	| "workspaceId"
	| "projectId"
	| "source"
	| "productId"
	| "fingerprint"
	| "claims"
	| "claimCount"
	| "isEmpty"
	| "schemaVersion"
	| "builderVersion"
> & { id: string };

export type ManifestExecutionEligibilityInput = Readonly<{
	manifest: ManifestExecutionEligibilityManifest;
	project: {
		id: string;
		workspaceId: string;
		contentType: ContentType;
		creationPath: CreationPath;
		contentFormatKey: string | null;
		contentFormatVersion: number | null;
		productId: string | null;
		currentScriptVersionId: string | null;
	};
	currentScriptVersion: {
		id: string;
		revision: number;
		status: ScriptVersionStatus;
		/** Required for Organic v2; optional to preserve Affiliate call sites. */
		schemaVersion?: string | null;
		claimsSourceRevision?: number | null;
		claimsStatus?: "current" | "stale" | null;
	} | null;
}>;

export type ManifestFactLockStrategy = "AFFILIATE_V1" | "ORGANIC_PRODUCT_V2";

export type ManifestExecutionEligibilityFailureReason =
	| "INVALID_MANIFEST"
	| "INVALID_MANIFEST_FINGERPRINT"
	| "WORKSPACE_MISMATCH"
	| "PROJECT_MISMATCH"
	| "CONTENT_TYPE_MISMATCH"
	| "CREATION_PATH_MISMATCH"
	| "CONTENT_FORMAT_MISMATCH"
	| "PRODUCT_MISMATCH"
	| "SCRIPT_VERSION_MISSING"
	| "SCRIPT_VERSION_MISMATCH"
	| "SCRIPT_VERSION_REVISION_MISMATCH"
	| "SCRIPT_VERSION_NOT_ACTIVE_DRAFT"
	| "SOURCE_TYPE_UNSUPPORTED"
	| "PRODUCT_CLAIM_SUBSET_EMPTY";

export type ManifestExecutionEligibilitySuccess = {
	eligible: true;
	reason: "ELIGIBLE";
	strategy?: ManifestFactLockStrategy;
};

export type ManifestExecutionEligibilityResult =
	| ManifestExecutionEligibilitySuccess
	| {
			eligible: false;
			code:
				| "CLAIM_MANIFEST_NOT_EXECUTABLE"
				| "CLAIM_MANIFEST_FINGERPRINT_MISMATCH";
			reason: ManifestExecutionEligibilityFailureReason;
	  };

function eligibilityFailure(
	reason: ManifestExecutionEligibilityFailureReason,
	code:
		| "CLAIM_MANIFEST_NOT_EXECUTABLE"
		| "CLAIM_MANIFEST_FINGERPRINT_MISMATCH" = "CLAIM_MANIFEST_NOT_EXECUTABLE",
): ManifestExecutionEligibilityResult {
	return { eligible: false, code, reason };
}

function isSha256Hash(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/**
 * Pure predicate over already-loaded values. It performs no lookup and never
 * resolves a moving "latest" source.
 */
export async function evaluateManifestExecutionEligibility(
	input: ManifestExecutionEligibilityInput,
): Promise<ManifestExecutionEligibilityResult> {
	const parsedManifest = manifestFactLockManifestSchema.safeParse(
		input.manifest,
	);
	if (!parsedManifest.success) return eligibilityFailure("INVALID_MANIFEST");
	if (!isSha256Hash(parsedManifest.data.fingerprint))
		return eligibilityFailure(
			"INVALID_MANIFEST_FINGERPRINT",
			"CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
		);
	const isOrganic =
		input.project.contentType === "ORGANIC" &&
		parsedManifest.data.builderVersion === "claim-manifest-builder.v2";
	const isAffiliate =
		input.project.contentType === "AFFILIATE" &&
		parsedManifest.data.builderVersion === "claim-manifest-builder.v1";
	if (!isOrganic && !isAffiliate)
		return eligibilityFailure("CONTENT_TYPE_MISMATCH");
	if (
		!(await (isOrganic
			? hasValidSubjectAwareClaimManifestFingerprint(parsedManifest.data)
			: hasValidClaimManifestFingerprint(parsedManifest.data)))
	)
		return eligibilityFailure(
			"INVALID_MANIFEST_FINGERPRINT",
			"CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
		);
	if (parsedManifest.data.source.sourceType !== "SCRIPT_VERSION")
		return eligibilityFailure("SOURCE_TYPE_UNSUPPORTED");
	if (parsedManifest.data.workspaceId !== input.project.workspaceId)
		return eligibilityFailure("WORKSPACE_MISMATCH");
	if (parsedManifest.data.projectId !== input.project.id)
		return eligibilityFailure("PROJECT_MISMATCH");
	if (input.project.creationPath !== "SCRIPTED")
		return eligibilityFailure("CREATION_PATH_MISMATCH");
	if (
		input.project.contentFormatKey !== "SCRIPTED_STANDARD" ||
		input.project.contentFormatVersion !== 1
	)
		return eligibilityFailure("CONTENT_FORMAT_MISMATCH");
	if (
		!input.project.productId ||
		parsedManifest.data.productId !== input.project.productId
	)
		return eligibilityFailure("PRODUCT_MISMATCH");
	if (!input.currentScriptVersion)
		return eligibilityFailure("SCRIPT_VERSION_MISSING");
	if (
		input.project.currentScriptVersionId !== input.currentScriptVersion.id ||
		parsedManifest.data.source.scriptVersionId !== input.currentScriptVersion.id
	)
		return eligibilityFailure("SCRIPT_VERSION_MISMATCH");
	if (
		parsedManifest.data.source.scriptVersionRevision !==
		input.currentScriptVersion.revision
	)
		return eligibilityFailure("SCRIPT_VERSION_REVISION_MISMATCH");
	if (input.currentScriptVersion.status !== "draft")
		return eligibilityFailure("SCRIPT_VERSION_NOT_ACTIVE_DRAFT");
	if (isOrganic) {
		if (input.currentScriptVersion.schemaVersion !== "script-draft.v3")
			return eligibilityFailure("CONTENT_FORMAT_MISMATCH");
		if (input.currentScriptVersion.claimsStatus !== "current")
			return eligibilityFailure("SCRIPT_VERSION_REVISION_MISMATCH");
		if (
			input.currentScriptVersion.claimsSourceRevision !==
			parsedManifest.data.source.claimsSourceRevision
		)
			return eligibilityFailure("SCRIPT_VERSION_REVISION_MISMATCH");
		const claims = parsedManifest.data
			.claims as readonly SubjectAwareClaimManifestClaim[];
		if (
			claims.length === 0 ||
			!claims.some(
				(claim) =>
					claim.subject.kind === "PRODUCT" &&
					claim.subjectStatus === "CONFIRMED",
			)
		)
			return eligibilityFailure("PRODUCT_CLAIM_SUBSET_EMPTY");
		return {
			eligible: true,
			reason: "ELIGIBLE",
			strategy: "ORGANIC_PRODUCT_V2",
		};
	}
	return { eligible: true, reason: "ELIGIBLE" };
}

export const manifestFactLockResolutionActions = [
	"status_only_manual_approval",
] as const;

export type ManifestFactLockResolutionPolicy = Readonly<{
	sourceMutationAllowed: false;
	allowedActions: readonly ["status_only_manual_approval"];
}>;

export function getManifestFactLockResolutionPolicy(): ManifestFactLockResolutionPolicy {
	return {
		sourceMutationAllowed: false,
		allowedActions: manifestFactLockResolutionActions,
	};
}

export type ManifestZeroClaimOutcome = Readonly<{
	status: "passed";
	providerRequired: false;
	claimResults: readonly [];
	dependenciesRequired: false;
}>;

export function buildManifestZeroClaimOutcome(
	input: unknown,
): ManifestZeroClaimOutcome {
	const parsed = manifestFactLockManifestSchema.safeParse(
		(input as { manifest?: unknown } | null)?.manifest,
	);
	if (!parsed.success || parsed.data.claims.length !== 0) {
		throw new FactLockError(
			"CLAIM_MANIFEST_NOT_EXECUTABLE",
			"Only a validated zero-claim Manifest can use the zero-claim outcome.",
		);
	}
	const eligibility = (input as { eligibility?: unknown } | null)?.eligibility;
	if (
		!eligibility ||
		typeof eligibility !== "object" ||
		(eligibility as { eligible?: unknown }).eligible !== true
	) {
		throw new FactLockError(
			"CLAIM_MANIFEST_NOT_EXECUTABLE",
			"The Manifest must be execution-eligible before zero-claim evaluation.",
		);
	}
	return {
		status: "passed",
		providerRequired: false,
		claimResults: [],
		dependenciesRequired: false,
	};
}

export type ManifestClaimLocator = ClaimManifestLocator;
export type ManifestFactLockProductFacts = ManifestProductFactsSnapshot;
