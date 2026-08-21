import { parseSingleJsonObject } from "../script-generation/structured-json";
import type { ClaimOccurrence } from "../script-generation/types";
import { scriptVersionEditableSnapshotSchema } from "../script-version/schema";
import { evaluateFactLockPolicy } from "./policy";
import { factLockProviderOutputSchema } from "./schema";
import type {
	FactLockClassification,
	FactLockInputSnapshot,
	FactLockProviderClaim,
	FactLockStoredClaim,
} from "./types";

export type FactLockOutputIssueCode =
	| "ROOT_NOT_JSON"
	| "ROOT_NOT_OBJECT"
	| "SCHEMA_VERSION_MISMATCH"
	| "CLAIMS_SCHEMA_INVALID"
	| "CLAIM_LIMIT_EXCEEDED"
	| "CLAIM_OCCURRENCE_INVALID"
	| "FACT_MAPPING_INVALID"
	| "CLASSIFICATION_INVALID";

function invalidOutput(...issueCodes: FactLockOutputIssueCode[]) {
	return {
		success: false as const,
		code: "INVALID_FACT_LOCK_OUTPUT" as const,
		issueCodes: [...new Set(issueCodes)],
	};
}

function normalize(value: string) {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase("vi-VN")
		.replace(/\s+/g, " ")
		.trim();
}

export function extractFactLockOccurrenceText(
	snapshot: FactLockInputSnapshot,
	occurrence: ClaimOccurrence,
) {
	const script = snapshot.scriptVersion.snapshot;
	if (occurrence.section === "hook")
		return (
			script.hookVariants.find((item) => item.key === occurrence.hookKey)
				?.text ?? null
		);
	if (occurrence.section === "voiceover")
		return (
			script.voiceoverSegments.find(
				(item) => item.key === occurrence.segmentKey,
			)?.text ?? null
		);
	if (occurrence.section === "scene")
		return (
			script.scenes.find((item) => item.order === occurrence.sceneOrder)
				?.onScreenText ?? null
		);
	if (occurrence.section === "cta") return script.cta.text;
	return script.caption;
}

function validClassification(
	claim: FactLockProviderClaim,
	policyConfirmed: boolean,
) {
	if (claim.classificationStatus === "PROHIBITED" && !policyConfirmed)
		return "NEEDS_REVIEW" as const;
	return claim.classificationStatus as FactLockClassification;
}

function reviewStatus(classification: FactLockClassification) {
	return classification === "SUPPORTED"
		? ("AUTO_PASSED" as const)
		: ("UNRESOLVED" as const);
}

export function validateFactLockProviderOutput(
	raw: unknown,
	snapshot: FactLockInputSnapshot,
) {
	const parsed = parseSingleJsonObject(raw);
	if (!parsed.success) return invalidOutput(parsed.issueCode);
	if (parsed.data.schemaVersion !== "fact-lock-output.v1")
		return invalidOutput("SCHEMA_VERSION_MISMATCH");
	const result = factLockProviderOutputSchema.safeParse(parsed.data);
	if (!result.success) return invalidOutput("CLAIMS_SCHEMA_INVALID");
	if (
		snapshot.outputRules.claimLimit !== null &&
		result.data.claims.length > snapshot.outputRules.claimLimit
	)
		return invalidOutput("CLAIM_LIMIT_EXCEEDED");
	const facts = new Map(snapshot.productFacts.map((fact) => [fact.id, fact]));
	const claims: FactLockStoredClaim[] = [];
	for (const claim of result.data.claims) {
		if (
			claim.occurrence.section === "hook" &&
			claim.occurrence.hookKey !==
				snapshot.scriptVersion.snapshot.selectedHookKey
		)
			return invalidOutput("CLAIM_OCCURRENCE_INVALID");
		const occurrenceText = extractFactLockOccurrenceText(
			snapshot,
			claim.occurrence,
		);
		if (
			!occurrenceText ||
			!normalize(occurrenceText).includes(normalize(claim.claimText))
		)
			return invalidOutput("CLAIM_OCCURRENCE_INVALID");
		const mappedFacts = claim.factMappings.map((mapping) => {
			const fact = facts.get(mapping.factId);
			return fact
				? {
						factId: fact.id,
						factRevision: fact.revision,
						relation: mapping.relation,
					}
				: null;
		});
		if (mappedFacts.some((mapping) => mapping === null))
			return invalidOutput("FACT_MAPPING_INVALID");
		const policy = evaluateFactLockPolicy(
			claim.claimText,
			occurrenceText,
			snapshot.policy,
		);
		const classificationStatus = validClassification(claim, policy.prohibited);
		if (
			classificationStatus === "SUPPORTED" &&
			!mappedFacts.some((mapping) => mapping?.relation === "supports")
		)
			return invalidOutput("CLASSIFICATION_INVALID");
		if (
			classificationStatus === "UNSUPPORTED" &&
			mappedFacts.some((mapping) => mapping?.relation === "supports")
		)
			return invalidOutput("CLASSIFICATION_INVALID");
		if (classificationStatus === "PROHIBITED" && !policy.prohibited) {
			return invalidOutput("CLASSIFICATION_INVALID");
		}
		claims.push({
			...claim,
			id: null,
			classificationStatus,
			reviewStatus: reviewStatus(classificationStatus),
			checkedAt: new Date(),
			reviewedByUserId: null,
			reviewedAt: null,
			reviewNote: null,
			factMappings: mappedFacts as Array<{
				factId: string;
				factRevision: number;
				relation: "supports" | "related" | "contradicts";
			}>,
		});
	}
	return { success: true as const, claims };
}

export function isFactLockClaimResolved(
	claim: Pick<FactLockStoredClaim, "classificationStatus" | "reviewStatus">,
) {
	return (
		(claim.classificationStatus === "SUPPORTED" &&
			claim.reviewStatus === "AUTO_PASSED") ||
		(claim.classificationStatus === "NEEDS_REVIEW" &&
			claim.reviewStatus === "MANUAL_APPROVED")
	);
}

export function deriveFactLockRunStatus(
	claims: Array<
		Pick<FactLockStoredClaim, "classificationStatus" | "reviewStatus">
	>,
) {
	return claims.every(isFactLockClaimResolved)
		? ("passed" as const)
		: ("review_required" as const);
}

export function deriveFactLockEffectiveStatus(
	status: "pending" | "review_required" | "passed" | "failed" | "indeterminate",
	sourceScriptRevision: number,
	currentScriptRevision: number | null,
	dependenciesCurrent: boolean,
) {
	return (status === "passed" || status === "review_required") &&
		(currentScriptRevision === null ||
			currentScriptRevision !== sourceScriptRevision ||
			!dependenciesCurrent)
		? ("stale" as const)
		: status;
}

export function validateFactLockScriptSnapshot(snapshot: unknown) {
	return scriptVersionEditableSnapshotSchema.safeParse(snapshot);
}
