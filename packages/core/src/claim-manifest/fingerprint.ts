import { canonicalClaimSourceText, sha256Hex } from "./canonicalization";
import type {
	BuiltClaimManifest,
	ClaimManifestClaim,
	ClaimManifestFingerprintProjection,
	ClaimManifestSource,
} from "./types";
import {
	CLAIM_MANIFEST_BUILDER_VERSION,
	CLAIM_MANIFEST_SCHEMA_VERSION,
} from "./types";

export function claimManifestFingerprintProjection(input: {
	workspaceId: string;
	projectId: string;
	source: ClaimManifestSource;
	productId: string | null;
	claims: readonly ClaimManifestClaim[];
}): ClaimManifestFingerprintProjection {
	return {
		domain: CLAIM_MANIFEST_SCHEMA_VERSION,
		builderVersion: CLAIM_MANIFEST_BUILDER_VERSION,
		workspaceId: input.workspaceId,
		projectId: input.projectId,
		source: input.source,
		productId: input.productId,
		claims: input.claims.map((claim) => ({
			claimKey: claim.claimKey,
			claimText: canonicalClaimSourceText(claim.claimText),
			locator: claim.locator,
			sourceTextHash: claim.sourceTextHash,
		})),
	};
}

export async function claimManifestFingerprint(input: {
	workspaceId: string;
	projectId: string;
	source: ClaimManifestSource;
	productId: string | null;
	claims: readonly ClaimManifestClaim[];
}): Promise<string> {
	return sha256Hex(claimManifestFingerprintProjection(input));
}

export async function hasValidClaimManifestFingerprint(
	manifest: BuiltClaimManifest,
): Promise<boolean> {
	return (await claimManifestFingerprint(manifest)) === manifest.fingerprint;
}
