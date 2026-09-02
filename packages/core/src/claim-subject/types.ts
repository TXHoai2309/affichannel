import type { ClaimManifestLocator } from "../claim-manifest/types";
import type { ClaimOccurrence } from "../script-generation/types";

export const claimSubjectKinds = ["GENERAL", "PRODUCT"] as const;
export type ClaimSubjectKind = (typeof claimSubjectKinds)[number];

export const claimSubjectStatuses = [
	"CONFIRMED",
	"NEEDS_CONFIRMATION",
] as const;
export type ClaimSubjectStatus = (typeof claimSubjectStatuses)[number];

export const claimSubjectSources = [
	"USER",
	"STRUCTURED_SOURCE",
	"LEGACY_COMPATIBILITY",
] as const;
export type ClaimSubjectSource = (typeof claimSubjectSources)[number];

export const proposedClaimSubjects = ["GENERAL", "PRODUCT"] as const;
export type ProposedClaimSubject = (typeof proposedClaimSubjects)[number];

export type ClaimSubject =
	| Readonly<{ kind: "GENERAL" }>
	| Readonly<{
			kind: "PRODUCT";
			binding: "PROJECT_PRODUCT";
	  }>;

export type SubjectAwareScriptClaim = Readonly<{
	text: string;
	occurrence: ClaimOccurrence;
	subject: ClaimSubject;
	subjectStatus: ClaimSubjectStatus;
	subjectSource: ClaimSubjectSource | null;
}>;

export type LegacyScriptClaim = Readonly<{
	text: string;
	occurrence: ClaimOccurrence;
}>;

export type ClaimSubjectContext = Readonly<{
	contentType: string;
	creationPath: string;
}>;

export type ClaimInventoryInput = ClaimSubjectContext &
	Readonly<{
		claimsStatus: string;
		claims: unknown;
	}>;

export const claimInventoryStatuses = ["CURRENT", "STALE", "UNKNOWN"] as const;
export type ClaimInventoryStatus = (typeof claimInventoryStatuses)[number];

export const claimSubjectResolutions = [
	"CONFIRMED",
	"NEEDS_CONFIRMATION",
	"UNKNOWN",
] as const;
export type ClaimSubjectResolution = (typeof claimSubjectResolutions)[number];

export const productClaimStates = ["NONE", "PRESENT", "UNKNOWN"] as const;
export type ProductClaimState = (typeof productClaimStates)[number];

export type ClaimInventorySummary = Readonly<{
	status: ClaimInventoryStatus;
	subjectResolution: ClaimSubjectResolution;
	productClaimState: ProductClaimState;
	productClaimCount: number | null;
	generalClaimCount: number | null;
}>;

export const productClaimBindingStates = [
	"NONE",
	"BOUND",
	"UNBOUND",
	"UNKNOWN",
] as const;
export type ProductClaimBindingState =
	(typeof productClaimBindingStates)[number];

export type ClaimSubjectProposal = Readonly<{
	text: string;
	occurrence: ClaimOccurrence;
	proposedSubject: ProposedClaimSubject;
}>;

export type SubjectAwareManifestClaimProjection = Readonly<{
	claimKey: string;
	claimText: string;
	locator: ClaimManifestLocator;
	sourceTextHash: string;
	subject: ClaimSubject;
	subjectStatus: ClaimSubjectStatus;
	subjectSource: ClaimSubjectSource | null;
}>;
