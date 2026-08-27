import type { ClaimManifest, FactLockStoredClaim } from "@affichannel/core";
import { type db, factLockClaim, factLockClaimFact } from "@affichannel/db";
import { and, eq, inArray } from "drizzle-orm";

import type { WorkspaceActor } from "./workspace";

type FactLockTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Reads persisted claim metadata while keeping Manifest identity authoritative.
 * The optional Manifest also determines the returned order and locator/text;
 * stored rows only contribute verdict and review metadata.
 */
export async function loadFactLockClaimsInTransaction(
	transaction: FactLockTransaction,
	actor: WorkspaceActor,
	runId: string,
	manifest?: ClaimManifest,
): Promise<FactLockStoredClaim[]> {
	const rows = await transaction
		.select()
		.from(factLockClaim)
		.where(
			and(
				eq(factLockClaim.workspaceId, actor.workspaceId),
				eq(factLockClaim.runId, runId),
			),
		)
		.orderBy(factLockClaim.claimKey);
	if (rows.length === 0) return [];

	const mappings = await transaction
		.select()
		.from(factLockClaimFact)
		.where(
			inArray(
				factLockClaimFact.claimId,
				rows.map((claim) => claim.id),
			),
		);
	const mappingsByClaim = new Map<
		string,
		FactLockStoredClaim["factMappings"]
	>();
	for (const mapping of mappings) {
		const list = mappingsByClaim.get(mapping.claimId) ?? [];
		list.push({
			factId: mapping.factId,
			factRevision: mapping.factRevision,
			relation:
				mapping.relation as FactLockStoredClaim["factMappings"][number]["relation"],
		});
		mappingsByClaim.set(mapping.claimId, list);
	}

	const byKey = new Map(rows.map((claim) => [claim.claimKey, claim]));
	if (manifest) {
		if (byKey.size !== rows.length)
			throw new Error("FACT_LOCK_DUPLICATE_CLAIM_KEY");
		if (
			rows.some(
				(row) =>
					!manifest.claims.some((claim) => claim.claimKey === row.claimKey),
			)
		) {
			throw new Error("FACT_LOCK_MANIFEST_CLAIM_NOT_IN_MANIFEST");
		}
		return manifest.claims.flatMap((manifestClaim) => {
			const row = byKey.get(manifestClaim.claimKey);
			if (!row) return [];
			return [
				{
					id: row.id,
					claimKey: manifestClaim.claimKey,
					claimText: manifestClaim.claimText,
					occurrence:
						manifestClaim.locator.sourceType === "SCRIPT_VERSION"
							? manifestClaim.locator.occurrence
							: (row.occurrenceJson as FactLockStoredClaim["occurrence"]),
					classificationStatus:
						row.classificationStatus as FactLockStoredClaim["classificationStatus"],
					reason: row.reason,
					confidence: row.confidence,
					suggestionText: row.suggestionText,
					factMappings: mappingsByClaim.get(row.id) ?? [],
					reviewStatus: row.reviewStatus as FactLockStoredClaim["reviewStatus"],
					checkedAt: row.checkedAt,
					reviewedByUserId: row.reviewedByUserId,
					reviewedAt: row.reviewedAt,
					reviewNote: row.reviewNote,
				},
			];
		});
	}

	return rows.map((claim) => ({
		id: claim.id,
		claimKey: claim.claimKey,
		claimText: claim.claimText,
		occurrence: claim.occurrenceJson as FactLockStoredClaim["occurrence"],
		classificationStatus:
			claim.classificationStatus as FactLockStoredClaim["classificationStatus"],
		reason: claim.reason,
		confidence: claim.confidence,
		suggestionText: claim.suggestionText,
		factMappings: mappingsByClaim.get(claim.id) ?? [],
		reviewStatus: claim.reviewStatus as FactLockStoredClaim["reviewStatus"],
		checkedAt: claim.checkedAt,
		reviewedByUserId: claim.reviewedByUserId,
		reviewedAt: claim.reviewedAt,
		reviewNote: claim.reviewNote,
	}));
}
