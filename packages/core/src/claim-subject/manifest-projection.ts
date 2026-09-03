import type { ClaimManifestLocator } from "../claim-manifest/types";
import { canonicalizeJson } from "../script-generation/canonical-json";
import type {
	SubjectAwareManifestClaimProjection,
	SubjectAwareScriptClaim,
} from "./types";

/** Canonical subject-aware claim projection used by Organic Manifest v2. */
export function buildSubjectAwareManifestClaimProjection(input: {
	claimKey: string;
	claim: SubjectAwareScriptClaim;
	locator: ClaimManifestLocator;
	sourceTextHash: string;
}): SubjectAwareManifestClaimProjection {
	return Object.freeze({
		claimKey: input.claimKey,
		claimText: input.claim.text,
		locator: input.locator,
		sourceTextHash: input.sourceTextHash,
		subject: input.claim.subject,
		subjectStatus: input.claim.subjectStatus,
		subjectSource: input.claim.subjectSource,
	});
}

export function subjectAwareManifestClaimProjectionJson(
	projection: SubjectAwareManifestClaimProjection,
): string {
	return canonicalizeJson(projection);
}

export function subjectAwareScriptClaimJson(
	claim: SubjectAwareScriptClaim,
): string {
	return canonicalizeJson(claim);
}
