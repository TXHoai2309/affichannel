import { z } from "zod";

import {
	factRequiresEvidence,
	hasFactEvidence,
	isFactEligibleForAi,
} from "./eligibility";
import type {
	ProductFactRecord,
	ProductFactStatus,
	ProductFactType,
} from "./types";

export const factFreshnessStatuses = [
	"fresh",
	"needs_update",
	"expired",
	"unknown",
	"not_applicable",
] as const;
export type FactFreshnessStatus = (typeof factFreshnessStatuses)[number];

export const factEvidenceStatuses = ["complete", "missing"] as const;
export type FactEvidenceStatus = (typeof factEvidenceStatuses)[number];

export const factGenerationUsabilities = [
	"allowed",
	"allowed_with_warning",
	"blocked",
] as const;
export type FactGenerationUsability =
	(typeof factGenerationUsabilities)[number];

export const factFreshnessReasons = [
	"not_applicable",
	"not_verified",
	"missing_evidence",
	"confirmed_date_missing",
	"confirmed_date_invalid",
	"confirmed_date_in_future",
	"expired_by_date",
	"expiry_approaching",
	"confirmed_age",
	"within_policy",
] as const;
export type FactFreshnessReason = (typeof factFreshnessReasons)[number];

export const factFreshnessPolicySchema = z.object({
	priceMaxAgeDays: z.number().int().positive(),
	promotionMaxAgeDays: z.number().int().positive(),
	expiryWarningLeadDays: z.number().int().nonnegative(),
	businessTimezone: z.string().min(1),
});

export type FactFreshnessPolicy = z.infer<typeof factFreshnessPolicySchema>;

export const FACT_FRESHNESS_POLICY = factFreshnessPolicySchema.parse({
	priceMaxAgeDays: 7,
	promotionMaxAgeDays: 3,
	expiryWarningLeadDays: 1,
	businessTimezone: "Asia/Ho_Chi_Minh",
}) satisfies FactFreshnessPolicy;

export type BusinessDate = `${number}-${number}-${number}`;

export type FactAssessment = {
	verification: ProductFactStatus;
	evidence: FactEvidenceStatus;
	freshness: FactFreshnessStatus;
	freshnessReason: FactFreshnessReason;
};

export type ProductFactListItem = ProductFactRecord & {
	assessment: FactAssessment;
	generationUsability: FactGenerationUsability;
};

type FreshnessFact = Pick<
	ProductFactRecord,
	| "type"
	| "status"
	| "sourceType"
	| "sourceLabel"
	| "sourceUrl"
	| "confirmedAt"
	| "expiresAt"
>;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseCalendarDate(value: string) {
	const match = ISO_DATE_PATTERN.exec(value);
	if (!match) return undefined;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const timestamp = Date.UTC(year, month - 1, day);
	const date = new Date(timestamp);
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return undefined;
	}
	return Math.floor(timestamp / 86_400_000);
}

function calendarDateFromDayNumber(dayNumber: number): BusinessDate {
	const date = new Date(dayNumber * 86_400_000);
	return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}` as BusinessDate;
}

export function addBusinessDays(date: string, days: number) {
	const dayNumber = parseCalendarDate(date);
	if (dayNumber === undefined) return undefined;
	return calendarDateFromDayNumber(dayNumber + days);
}

export function differenceInBusinessDays(later: string, earlier: string) {
	const laterDay = parseCalendarDate(later);
	const earlierDay = parseCalendarDate(earlier);
	if (laterDay === undefined || earlierDay === undefined) return undefined;
	return laterDay - earlierDay;
}

export function isBusinessDate(value: string): value is BusinessDate {
	return parseCalendarDate(value) !== undefined;
}

export function resolveBusinessToday(
	now = new Date(),
	policy: Pick<FactFreshnessPolicy, "businessTimezone"> = FACT_FRESHNESS_POLICY,
): BusinessDate {
	const parts = new Intl.DateTimeFormat("en", {
		timeZone: policy.businessTimezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const values = Object.fromEntries(
		parts
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, part.value]),
	);
	return `${values.year}-${values.month}-${values.day}` as BusinessDate;
}

function freshnessPolicyForType(
	type: ProductFactType,
	policy: FactFreshnessPolicy,
) {
	if (type === "price") return policy.priceMaxAgeDays;
	if (type === "promotion") return policy.promotionMaxAgeDays;
	return undefined;
}

export function evaluateFactFreshness(
	fact: FreshnessFact,
	today: string,
	policy: FactFreshnessPolicy = FACT_FRESHNESS_POLICY,
): { status: FactFreshnessStatus; reason: FactFreshnessReason } {
	const maxAgeDays = freshnessPolicyForType(fact.type, policy);
	if (maxAgeDays === undefined) {
		return { status: "not_applicable", reason: "not_applicable" };
	}

	if (fact.status !== "verified") {
		return { status: "unknown", reason: "not_verified" };
	}
	if (factRequiresEvidence(fact.type) && !hasFactEvidence(fact)) {
		return { status: "unknown", reason: "missing_evidence" };
	}
	if (!fact.confirmedAt) {
		return { status: "unknown", reason: "confirmed_date_missing" };
	}

	const todayDay = parseCalendarDate(today);
	const confirmedDay = parseCalendarDate(fact.confirmedAt);
	if (todayDay === undefined || confirmedDay === undefined) {
		return { status: "unknown", reason: "confirmed_date_invalid" };
	}
	if (confirmedDay > todayDay) {
		return { status: "unknown", reason: "confirmed_date_in_future" };
	}

	if (fact.expiresAt) {
		const expiresDay = parseCalendarDate(fact.expiresAt);
		if (expiresDay === undefined) {
			return { status: "unknown", reason: "confirmed_date_invalid" };
		}
		if (todayDay > expiresDay) {
			return { status: "expired", reason: "expired_by_date" };
		}
		if (expiresDay - todayDay <= policy.expiryWarningLeadDays) {
			return { status: "needs_update", reason: "expiry_approaching" };
		}
	}

	if (todayDay - confirmedDay >= maxAgeDays) {
		return { status: "needs_update", reason: "confirmed_age" };
	}
	return { status: "fresh", reason: "within_policy" };
}

export function evaluateFactAssessment(
	fact: FreshnessFact,
	today: string,
	policy: FactFreshnessPolicy = FACT_FRESHNESS_POLICY,
): FactAssessment {
	const evidence = factRequiresEvidence(fact.type)
		? hasFactEvidence(fact)
			? "complete"
			: "missing"
		: "complete";
	const freshness = evaluateFactFreshness(fact, today, policy);
	return {
		verification: fact.status,
		evidence,
		freshness: freshness.status,
		freshnessReason: freshness.reason,
	};
}

export function evaluateFactGenerationUsability(
	fact: FreshnessFact,
	today: string,
	policy: FactFreshnessPolicy = FACT_FRESHNESS_POLICY,
): { usability: FactGenerationUsability; assessment: FactAssessment } {
	const assessment = evaluateFactAssessment(fact, today, policy);
	if (
		fact.status !== "verified" ||
		assessment.evidence === "missing" ||
		assessment.freshness === "unknown" ||
		assessment.freshness === "expired" ||
		!isFactEligibleForAi(fact)
	) {
		return { usability: "blocked", assessment };
	}
	if (assessment.freshness === "needs_update") {
		return { usability: "allowed_with_warning", assessment };
	}
	return { usability: "allowed", assessment };
}
