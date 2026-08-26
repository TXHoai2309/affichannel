import { sha256Hex } from "../claim-manifest/canonicalization";
import type { ClaimManifest } from "../claim-manifest/types";
import type { OutputRules } from "../script-generation/input-contract";
import { FACT_LOCK_MANIFEST_INPUT_MODE } from "./manifest-contract";
import {
	FACT_LOCK_MANIFEST_INPUT_VERSION,
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

export type ManifestFactLockInputSnapshot = Readonly<{
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

export function buildManifestFactLockInputSnapshot(input: {
	manifest: Pick<
		ClaimManifest,
		"id" | "fingerprint" | "source" | "claimCount" | "isEmpty"
	>;
	productFacts: readonly ManifestProductFactSnapshot[];
	productFactsFingerprint?: string;
	policy: FactLockPolicySnapshot | null;
	outputRules: OutputRules | null;
}): ManifestFactLockInputSnapshot {
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

export function computeManifestFactLockInputHash(
	snapshot: ManifestFactLockInputSnapshot,
): Promise<string> {
	return sha256Hex(snapshot);
}
