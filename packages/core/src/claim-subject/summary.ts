import { isContentType, isCreationPath } from "../project/channel-first-types";
import {
	adaptLegacyAffiliateClaim,
	hasClaimSubjectMetadata,
} from "./compatibility";
import {
	legacyScriptClaimSchema,
	subjectAwareScriptClaimSchema,
} from "./schema";
import type {
	ClaimInventoryInput,
	ClaimInventorySummary,
	SubjectAwareScriptClaim,
} from "./types";

function unknownSummary(): ClaimInventorySummary {
	return Object.freeze({
		status: "UNKNOWN" as const,
		subjectResolution: "UNKNOWN" as const,
		productClaimState: "UNKNOWN" as const,
		productClaimCount: null,
		generalClaimCount: null,
	});
}

function staleSummary(): ClaimInventorySummary {
	return Object.freeze({
		status: "STALE" as const,
		subjectResolution: "UNKNOWN" as const,
		productClaimState: "UNKNOWN" as const,
		productClaimCount: null,
		generalClaimCount: null,
	});
}

function currentSummary(
	claims: readonly SubjectAwareScriptClaim[],
): ClaimInventorySummary {
	if (claims.some((claim) => claim.subjectStatus === "NEEDS_CONFIRMATION")) {
		return Object.freeze({
			status: "CURRENT" as const,
			subjectResolution: "NEEDS_CONFIRMATION" as const,
			productClaimState: "UNKNOWN" as const,
			productClaimCount: null,
			generalClaimCount: null,
		});
	}

	const productClaimCount = claims.filter(
		(claim) => claim.subject.kind === "PRODUCT",
	).length;
	const generalClaimCount = claims.length - productClaimCount;
	return Object.freeze({
		status: "CURRENT" as const,
		subjectResolution: "CONFIRMED" as const,
		productClaimState:
			productClaimCount > 0 ? ("PRESENT" as const) : ("NONE" as const),
		productClaimCount,
		generalClaimCount,
	});
}

/**
 * Derives a policy summary from the current claim inventory. It never reads
 * claim text and never performs semantic classification.
 */
export function summarizeClaimInventory(
	input: ClaimInventoryInput,
): ClaimInventorySummary {
	if (
		!isContentType(input.contentType) ||
		!isCreationPath(input.creationPath)
	) {
		return unknownSummary();
	}
	if (input.claimsStatus === "stale") return staleSummary();
	if (input.claimsStatus !== "current" || !Array.isArray(input.claims)) {
		return unknownSummary();
	}
	if (input.claims.length === 0) {
		return currentSummary([]);
	}

	const effectiveClaims: SubjectAwareScriptClaim[] = [];
	for (const rawClaim of input.claims) {
		const subjectAware = subjectAwareScriptClaimSchema.safeParse(rawClaim);
		if (subjectAware.success) {
			if (
				subjectAware.data.subjectSource === "LEGACY_COMPATIBILITY" &&
				(input.contentType !== "AFFILIATE" || input.creationPath !== "SCRIPTED")
			) {
				return unknownSummary();
			}
			effectiveClaims.push(subjectAware.data);
			continue;
		}

		// A payload that attempted to provide subject metadata is malformed; it
		// must not be silently downgraded to a legacy claim.
		if (hasClaimSubjectMetadata(rawClaim)) return unknownSummary();

		if (!legacyScriptClaimSchema.safeParse(rawClaim).success) {
			return unknownSummary();
		}
		const adapted = adaptLegacyAffiliateClaim({
			context: input,
			claim: rawClaim,
		});
		if (adapted.kind === "unknown") return unknownSummary();
		effectiveClaims.push(adapted.claim);
	}

	return currentSummary(effectiveClaims);
}

export const deriveClaimInventorySummary = summarizeClaimInventory;
