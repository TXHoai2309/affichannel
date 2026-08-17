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
	const parsed =
		typeof raw === "string"
			? (() => {
					try {
						return JSON.parse(raw) as unknown;
					} catch {
						return raw;
					}
				})()
			: raw;
	const result = factLockProviderOutputSchema.safeParse(parsed);
	if (!result.success)
		return {
			success: false as const,
			code: "INVALID_FACT_LOCK_OUTPUT" as const,
			issues: result.error.issues,
		};
	if (
		snapshot.outputRules.claimLimit !== null &&
		result.data.claims.length > snapshot.outputRules.claimLimit
	) {
		return {
			success: false as const,
			code: "INVALID_FACT_LOCK_OUTPUT" as const,
			issues: [
				{ message: "Fact Lock output exceeds the configured claim limit." },
			],
		};
	}
	const facts = new Map(snapshot.productFacts.map((fact) => [fact.id, fact]));
	const claims: FactLockStoredClaim[] = [];
	for (const claim of result.data.claims) {
		const occurrenceText = extractFactLockOccurrenceText(
			snapshot,
			claim.occurrence,
		);
		if (
			!occurrenceText ||
			!normalize(occurrenceText).includes(normalize(claim.claimText))
		) {
			return {
				success: false as const,
				code: "INVALID_FACT_LOCK_OUTPUT" as const,
				issues: [
					{
						message: `Claim ${claim.claimKey} is not an exact extraction from its occurrence.`,
					},
				],
			};
		}
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
		if (mappedFacts.some((mapping) => mapping === null)) {
			return {
				success: false as const,
				code: "INVALID_FACT_LOCK_OUTPUT" as const,
				issues: [
					{
						message: `Claim ${claim.claimKey} references a Fact outside the exact snapshot.`,
					},
				],
			};
		}
		const policy = evaluateFactLockPolicy(
			claim.claimText,
			occurrenceText,
			snapshot.policy,
		);
		const classificationStatus = validClassification(claim, policy.prohibited);
		if (
			classificationStatus === "SUPPORTED" &&
			!mappedFacts.some((mapping) => mapping?.relation === "supports")
		) {
			return {
				success: false as const,
				code: "INVALID_FACT_LOCK_OUTPUT" as const,
				issues: [
					{
						message: `Supported claim ${claim.claimKey} must map to a supporting Fact.`,
					},
				],
			};
		}
		if (
			classificationStatus === "UNSUPPORTED" &&
			mappedFacts.some((mapping) => mapping?.relation === "supports")
		) {
			return {
				success: false as const,
				code: "INVALID_FACT_LOCK_OUTPUT" as const,
				issues: [
					{
						message: `Unsupported claim ${claim.claimKey} cannot map a supporting Fact.`,
					},
				],
			};
		}
		if (classificationStatus === "PROHIBITED" && !policy.prohibited) {
			return {
				success: false as const,
				code: "INVALID_FACT_LOCK_OUTPUT" as const,
				issues: [
					{
						message: `Prohibited claim ${claim.claimKey} was not confirmed by the server policy.`,
					},
				],
			};
		}
		claims.push({
			...claim,
			classificationStatus,
			reviewStatus: reviewStatus(classificationStatus),
			checkedAt: new Date(),
			factRevision: mappedFacts[0]?.factRevision ?? null,
			factMappings: mappedFacts as Array<{
				factId: string;
				factRevision: number;
				relation: "supports" | "contradicts" | "context";
			}>,
		});
	}
	return { success: true as const, claims };
}

export function deriveFactLockRunStatus(
	claims: Array<
		Pick<FactLockStoredClaim, "classificationStatus" | "reviewStatus">
	>,
) {
	return claims.every(
		(claim) =>
			claim.classificationStatus === "SUPPORTED" &&
			claim.reviewStatus === "AUTO_PASSED",
	)
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
