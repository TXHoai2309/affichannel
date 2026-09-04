import { sha256Hex } from "../claim-manifest/canonicalization";
import type {
	ClaimManifest,
	SubjectAwareClaimManifestClaim,
} from "../claim-manifest/types";
import type { OutputRules } from "../script-generation/input-contract";
import { FACT_LOCK_MANIFEST_INPUT_MODE } from "./manifest-contract";
import {
	FACT_LOCK_MANIFEST_INPUT_VERSION,
	FACT_LOCK_MANIFEST_INPUT_VERSION_V2,
	type ManifestProductFactSnapshot,
} from "./manifest-request-hash";
import type { FactLockPolicySnapshot } from "./types";

export type ManifestFactLockSourceProvenance = Extract<
	ClaimManifest["source"],
	{ sourceType: "SCRIPT_VERSION" }
>;

export type ManifestFactLockZeroClaimSemantics = Readonly<{
	status: "passed";
	providerRequired: false;
	dependenciesRequired: false;
}>;

export type ManifestFactLockInputSnapshotV1 = Readonly<{
	inputMode: typeof FACT_LOCK_MANIFEST_INPUT_MODE;
	inputVersion: typeof FACT_LOCK_MANIFEST_INPUT_VERSION;
	claimManifest: Readonly<{
		id: string;
		fingerprint: string;
	}>;
	source: ManifestFactLockSourceProvenance;
	productFacts: readonly ManifestProductFactSnapshot[];
	productFactsFingerprint?: string;
	policy: FactLockPolicySnapshot | null;
	outputRules: OutputRules | null;
	zeroClaim: ManifestFactLockZeroClaimSemantics | null;
}>;

export type ManifestFactLockInputSnapshotV2 = Readonly<{
	inputMode: typeof FACT_LOCK_MANIFEST_INPUT_MODE;
	inputVersion: typeof FACT_LOCK_MANIFEST_INPUT_VERSION_V2;
	claimManifest: Readonly<{ id: string; fingerprint: string }>;
	source: ManifestFactLockSourceProvenance;
	productClaims: readonly SubjectAwareClaimManifestClaim[];
	productFacts: readonly ManifestProductFactSnapshot[];
	productFactsFingerprint: string;
	policy: FactLockPolicySnapshot;
	outputRules: OutputRules;
	zeroClaim: null;
}>;

export type ManifestFactLockInputSnapshot =
	| ManifestFactLockInputSnapshotV1
	| ManifestFactLockInputSnapshotV2;

export function buildManifestFactLockInputSnapshot(input: {
	manifest: Pick<
		ClaimManifest,
		"id" | "fingerprint" | "source" | "claimCount" | "isEmpty"
	>;
	productFacts: readonly ManifestProductFactSnapshot[];
	productFactsFingerprint?: string;
	policy: FactLockPolicySnapshot | null;
	outputRules: OutputRules | null;
}): ManifestFactLockInputSnapshotV1 {
	if (input.manifest.source.sourceType !== "SCRIPT_VERSION") {
		throw new Error("Manifest Fact Lock requires a ScriptVersion source.");
	}
	const isZeroClaim =
		input.manifest.claimCount === 0 && input.manifest.isEmpty === true;
	const isNonZeroClaim =
		input.manifest.claimCount > 0 && input.manifest.isEmpty === false;
	if (!isZeroClaim && !isNonZeroClaim) {
		throw new Error("Manifest claimCount/isEmpty state is inconsistent.");
	}
	if (isZeroClaim) {
		if (input.productFacts.length > 0) {
			throw new Error("Zero-claim input cannot contain Product Facts.");
		}
		if (input.productFactsFingerprint !== undefined) {
			throw new Error(
				"Zero-claim input cannot contain a Product Facts fingerprint.",
			);
		}
	}
	if (isNonZeroClaim) {
		if (input.productFacts.length === 0) {
			throw new Error("Non-zero input requires Product Facts.");
		}
		if (!input.productFactsFingerprint) {
			throw new Error("Non-empty input requires a Product Facts fingerprint.");
		}
	}
	return Object.freeze({
		inputMode: FACT_LOCK_MANIFEST_INPUT_MODE,
		inputVersion: FACT_LOCK_MANIFEST_INPUT_VERSION,
		claimManifest: Object.freeze({
			id: input.manifest.id,
			fingerprint: input.manifest.fingerprint,
		}),
		source: Object.freeze({ ...input.manifest.source }),
		productFacts: Object.freeze(
			input.productFacts.map((fact) => ({
				...fact,
				assessment: Object.freeze({ ...fact.assessment }),
				source: Object.freeze({ ...fact.source }),
			})),
		),
		...(input.productFactsFingerprint === undefined
			? {}
			: { productFactsFingerprint: input.productFactsFingerprint }),
		policy: input.policy
			? Object.freeze({
					...input.policy,
					avoidWords: [...input.policy.avoidWords],
				})
			: null,
		outputRules: input.outputRules
			? Object.freeze({ ...input.outputRules })
			: null,
		zeroClaim: isZeroClaim
			? Object.freeze({
					status: "passed" as const,
					providerRequired: false as const,
					dependenciesRequired: false as const,
				})
			: null,
	});
}

/** Builds the Organic subject-aware snapshot. The full Manifest remains
 * linked by id/fingerprint, while only the server-selected Product subset is
 * included in the provider-bound semantic input. */
export function buildOrganicManifestFactLockInputSnapshot(input: {
	manifest: Pick<ClaimManifest, "id" | "fingerprint" | "source">;
	productClaims: readonly SubjectAwareClaimManifestClaim[];
	productFacts: readonly ManifestProductFactSnapshot[];
	productFactsFingerprint: string;
	policy: FactLockPolicySnapshot;
	outputRules: OutputRules;
}): ManifestFactLockInputSnapshotV2 {
	if (input.manifest.source.sourceType !== "SCRIPT_VERSION")
		throw new Error(
			"Organic Manifest Fact Lock requires a ScriptVersion source.",
		);
	if (input.productClaims.length === 0)
		throw new Error("Organic Manifest Fact Lock requires Product claims.");
	if (input.productClaims.some((claim) => claim.subject.kind !== "PRODUCT"))
		throw new Error("Organic Manifest Fact Lock requires Product claims only.");
	if (input.productFacts.length === 0 || !input.productFactsFingerprint)
		throw new Error("Organic Manifest Fact Lock requires Product Facts.");
	return Object.freeze({
		inputMode: FACT_LOCK_MANIFEST_INPUT_MODE,
		inputVersion: FACT_LOCK_MANIFEST_INPUT_VERSION_V2,
		claimManifest: Object.freeze({
			id: input.manifest.id,
			fingerprint: input.manifest.fingerprint,
		}),
		source: Object.freeze({ ...input.manifest.source }),
		productClaims: Object.freeze(
			input.productClaims.map((claim) =>
				Object.freeze({
					...claim,
					locator: Object.freeze({ ...claim.locator }),
					subject: Object.freeze({ ...claim.subject }),
				}),
			),
		),
		productFacts: Object.freeze(
			input.productFacts.map((fact) => ({
				...fact,
				assessment: Object.freeze({ ...fact.assessment }),
				source: Object.freeze({ ...fact.source }),
			})),
		),
		productFactsFingerprint: input.productFactsFingerprint,
		policy: Object.freeze({
			...input.policy,
			avoidWords: [...input.policy.avoidWords],
		}),
		outputRules: Object.freeze({ ...input.outputRules }),
		zeroClaim: null,
	});
}

export function computeManifestFactLockInputHash(
	snapshot: ManifestFactLockInputSnapshot,
): Promise<string> {
	return sha256Hex(snapshot);
}
