import type {
	FactAssessment,
	FactGenerationUsability,
} from "../product-fact/freshness";
import type { ProductFactType } from "../product-fact/types";
import type { OutputRules } from "../script-generation/input-contract";
import type { ClaimOccurrence } from "../script-generation/types";
import type { ScriptVersionEditableSnapshot } from "../script-version/types";

export const factLockRunStatuses = [
	"pending",
	"review_required",
	"passed",
	"failed",
	"indeterminate",
] as const;
export type FactLockRunStatus = (typeof factLockRunStatuses)[number];

export const factLockEffectiveStatuses = [
	...factLockRunStatuses,
	"stale",
] as const;
export type FactLockEffectiveStatus =
	(typeof factLockEffectiveStatuses)[number];

export const factLockClassifications = [
	"SUPPORTED",
	"NEEDS_REVIEW",
	"UNSUPPORTED",
	"PROHIBITED",
] as const;
export type FactLockClassification = (typeof factLockClassifications)[number];

export const factLockReviewStatuses = [
	"AUTO_PASSED",
	"UNRESOLVED",
	"MANUAL_APPROVED",
] as const;
export type FactLockReviewStatus = (typeof factLockReviewStatuses)[number];

export const factLockFactRelations = [
	"supports",
	"related",
	"contradicts",
] as const;
export type FactLockFactRelation = (typeof factLockFactRelations)[number];

export const FACT_LOCK_SNAPSHOT_VERSION = "fact-lock-input.v1";
export const FACT_LOCK_PROMPT_VERSION = "fact-lock-prompt.v3";
export const FACT_LOCK_OUTPUT_SCHEMA_VERSION = "fact-lock-output.v1";
export const FACT_LOCK_ZERO_CLAIM_PROVIDER = "internal";
export const FACT_LOCK_ZERO_CLAIM_MODEL = "deterministic-zero-claim";
export const FACT_LOCK_ZERO_CLAIM_PROMPT_VERSION = "fact-lock-zero-claim.v1";

export type FactLockProductFactSnapshot = {
	id: string;
	revision: number;
	content: string;
	type: ProductFactType;
	status: "verified";
	assessment: FactAssessment;
	generationUsability: Exclude<FactGenerationUsability, "blocked">;
	source: {
		type: string | null;
		label: string | null;
		url: string | null;
		confirmedAt: string | null;
		expiresAt: string | null;
	};
};

export type FactLockPolicySnapshot = {
	avoidWords: string[];
	affiliateDisclosure: string;
	language: "vi-VN";
};

export type FactLockInputSnapshot = {
	snapshotVersion: typeof FACT_LOCK_SNAPSHOT_VERSION;
	scriptVersion: {
		id: string;
		revision: number;
		snapshot: ScriptVersionEditableSnapshot;
	};
	productFacts: FactLockProductFactSnapshot[];
	policy: FactLockPolicySnapshot;
	outputRules: OutputRules;
};

export type FactLockProviderClaim = {
	claimKey: string;
	claimText: string;
	occurrence: ClaimOccurrence;
	classificationStatus: FactLockClassification;
	reason: string;
	confidence: number | null;
	suggestionText: string | null;
	factMappings: Array<{
		factId: string;
		relation: FactLockFactRelation;
	}>;
};

export type FactLockProviderOutput = {
	schemaVersion: typeof FACT_LOCK_OUTPUT_SCHEMA_VERSION;
	claims: FactLockProviderClaim[];
};

export type FactLockStoredClaim = Omit<
	FactLockProviderClaim,
	"factMappings"
> & {
	id: string | null;
	reviewStatus: FactLockReviewStatus;
	checkedAt: Date;
	reviewedByUserId: string | null;
	reviewedAt: Date | null;
	reviewNote: string | null;
	factMappings: Array<{
		factId: string;
		factRevision: number;
		relation: FactLockFactRelation;
	}>;
};

export type FactLockReadModel = {
	currentScriptVersion: {
		id: string;
		revision: number;
		claimsSourceRevision: number;
		claimsStatus: "current" | "stale";
	} | null;
	latestRequest: {
		id: string;
		status: FactLockRunStatus;
		effectiveStatus: FactLockEffectiveStatus;
		sourceScriptRevision: number;
		createdAt: Date;
		finishedAt: Date | null;
		errorCode: string | null;
		facts: FactLockProductFactSnapshot[];
		claims: FactLockStoredClaim[];
	} | null;
	latestApplicableRun: FactLockReadModel["latestRequest"];
	effectiveStatus: FactLockEffectiveStatus | null;
};
