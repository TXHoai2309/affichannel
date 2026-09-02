import type { ClaimManifestLocator } from "../claim-manifest/types";
import { canonicalizeJson } from "../script-generation/canonical-json";
import type {
	SubjectAwareManifestClaimProjection,
	SubjectAwareScriptClaim,
} from "./types";

/**
 * Future Manifest builder v2 projection. The existing v1 builder is not
 * replaced by this helper in 19A.3.
 */
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
