import { canonicalClaimSourceText, sha256Hex } from "./canonicalization";
import type {
	BuiltClaimManifest,
	ClaimManifestClaim,
	ClaimManifestFingerprintProjection,
	ClaimManifestSource,
	SubjectAwareClaimManifestClaim,
	SubjectAwareClaimManifestFingerprintProjection,
} from "./types";
import {
	CLAIM_MANIFEST_BUILDER_VERSION,
	CLAIM_MANIFEST_BUILDER_VERSION_V2,
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

/** Fingerprint projection for Organic subject-aware manifests (builder v2). */
export function subjectAwareClaimManifestFingerprintProjection(input: {
	workspaceId: string;
	projectId: string;
	source: ClaimManifestSource;
	productId: string | null;
	claims: readonly SubjectAwareClaimManifestClaim[];
}): SubjectAwareClaimManifestFingerprintProjection {
	return {
		domain: CLAIM_MANIFEST_SCHEMA_VERSION,
		builderVersion: CLAIM_MANIFEST_BUILDER_VERSION_V2,
		workspaceId: input.workspaceId,
		projectId: input.projectId,
		source: input.source,
		productId: input.productId,
		claims: input.claims.map((claim) => ({
			claimKey: claim.claimKey,
			claimText: canonicalClaimSourceText(claim.claimText),
			locator: claim.locator,
			sourceTextHash: claim.sourceTextHash,
			subject: claim.subject,
			subjectStatus: claim.subjectStatus,
			subjectSource: claim.subjectSource,
		})),
	};
}

export async function subjectAwareClaimManifestFingerprint(input: {
	workspaceId: string;
	projectId: string;
	source: ClaimManifestSource;
	productId: string | null;
	claims: readonly SubjectAwareClaimManifestClaim[];
}): Promise<string> {
	return sha256Hex(subjectAwareClaimManifestFingerprintProjection(input));
}

export async function hasValidSubjectAwareClaimManifestFingerprint(
	manifest: BuiltClaimManifest,
): Promise<boolean> {
	if (manifest.builderVersion !== CLAIM_MANIFEST_BUILDER_VERSION_V2)
		return false;
	return (
		(await subjectAwareClaimManifestFingerprint({
			workspaceId: manifest.workspaceId,
			projectId: manifest.projectId,
			source: manifest.source,
			productId: manifest.productId,
			claims: manifest.claims as readonly SubjectAwareClaimManifestClaim[],
		})) === manifest.fingerprint
	);
}
