import { z } from "zod";
import { hasValidClaimManifestFingerprint } from "../claim-manifest/fingerprint";
import {
	builtClaimManifestSchema,
	claimManifestClaimSchema,
} from "../claim-manifest/schema";
import type {
	ClaimManifest,
	ClaimManifestClaim,
	ClaimManifestLocator,
} from "../claim-manifest/types";
import type { ContentType, CreationPath } from "../project/channel-first-types";
import type { ScriptVersionStatus } from "../script-version/types";
import { FactLockError } from "./errors";
import {
	FACT_LOCK_MANIFEST_INPUT_VERSION,
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

export const manifestFactLockManifestSchema = builtClaimManifestSchema
	.extend({ id: idSchema })
	.strict();

export type ManifestFactLockManifest = z.infer<
	typeof manifestFactLockManifestSchema
>;

export const manifestProviderClaimInputSchema = claimManifestClaimSchema;
export type ManifestProviderClaimInput = ClaimManifestClaim;

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

type ManifestFactLockVerificationInputShape = z.infer<
	typeof manifestFactLockVerificationInputSchema
>;
export type ManifestFactLockVerificationInput = Readonly<
	Omit<ManifestFactLockVerificationInputShape, "claims" | "productFacts"> & {
		claims: readonly ManifestFactLockVerificationInputShape["claims"][number][];
		productFacts: readonly ManifestFactLockVerificationInputShape["productFacts"][number][];
	}
>;

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

function freezeVerificationInput(
	input: ManifestFactLockVerificationInput,
): ManifestFactLockVerificationInput {
	return freezeObject({
		...input,
		claims: Object.freeze(
			input.claims.map((claim) =>
				freezeObject({
					...claim,
					locator: freezeObject({ ...claim.locator }),
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
	});
}

/**
 * Builds the provider input from a validated server-owned Manifest. The
 * inputVersion is deliberately absent from the builder input and is inserted
 * here, so callers cannot choose semantic authority.
 */
export function buildManifestFactLockVerificationInput(
	input: unknown,
): ManifestFactLockVerificationInput {
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
	} | null;
}>;

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
	| "SOURCE_TYPE_UNSUPPORTED";

export type ManifestExecutionEligibilityResult =
	| { eligible: true; reason: "ELIGIBLE" }
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
	if (!(await hasValidClaimManifestFingerprint(parsedManifest.data)))
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
	if (input.project.contentType !== "AFFILIATE")
		return eligibilityFailure("CONTENT_TYPE_MISMATCH");
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
