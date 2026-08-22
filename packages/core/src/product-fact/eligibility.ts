import type {
	ProductFactRecord,
	ProductFactStatus,
	ProductFactType,
	ProductFactVerificationIntent,
} from "./types";

export function factRequiresEvidence(type: ProductFactType) {
	return type === "price" || type === "promotion" || type === "claim";
}

export function hasFactEvidence(
	fact: Pick<
		ProductFactRecord,
		"type" | "sourceType" | "sourceLabel" | "sourceUrl" | "confirmedAt"
	>,
) {
	return Boolean(
		fact.sourceType && (fact.sourceLabel || fact.sourceUrl) && fact.confirmedAt,
	);
}

export function hasSupportingSource(
	fact: Pick<ProductFactRecord, "sourceType" | "sourceLabel" | "sourceUrl">,
) {
	const sourceType = fact.sourceType?.trim();
	const sourceLabel = fact.sourceLabel?.trim();
	const sourceUrl = fact.sourceUrl?.trim();
	if (!sourceType) return false;
	if (sourceLabel) return true;
	if (!sourceUrl) return false;

	try {
		const parsed = new URL(sourceUrl);
		return Boolean(
			parsed.hostname &&
				(parsed.protocol === "http:" || parsed.protocol === "https:"),
		);
	} catch {
		return false;
	}
}

export function isFactEligibleForAi(
	fact: Pick<
		ProductFactRecord,
		| "type"
		| "status"
		| "sourceType"
		| "sourceLabel"
		| "sourceUrl"
		| "confirmedAt"
	>,
) {
	return (
		fact.status === "verified" &&
		(!factRequiresEvidence(fact.type) || hasFactEvidence(fact))
	);
}

export function isValidFactDateRange(
	confirmedAt: string | null | undefined,
	expiresAt: string | null | undefined,
) {
	return !confirmedAt || !expiresAt || confirmedAt <= expiresAt;
}

const sensitiveFactFields = [
	"content",
	"type",
	"sourceType",
	"sourceLabel",
	"sourceUrl",
	"confirmedAt",
	"expiresAt",
] as const;

const dependencyRelevantFactFields = [
	...sensitiveFactFields,
	"status",
] as const;

export function hasSensitiveFactChanges(
	current: Pick<ProductFactRecord, (typeof sensitiveFactFields)[number]>,
	next: Pick<ProductFactRecord, (typeof sensitiveFactFields)[number]>,
) {
	return sensitiveFactFields.some((field) => current[field] !== next[field]);
}

export function hasDependencyRelevantFactChanges(
	current: Pick<
		ProductFactRecord,
		(typeof dependencyRelevantFactFields)[number]
	>,
	next: Pick<ProductFactRecord, (typeof dependencyRelevantFactFields)[number]>,
) {
	return dependencyRelevantFactFields.some(
		(field) => current[field] !== next[field],
	);
}

export function resolveFactStatusAfterEdit(
	currentStatus: ProductFactStatus,
	requestedStatus: ProductFactStatus,
	sensitiveChanged: boolean,
	verificationIntent: ProductFactVerificationIntent = "preserve",
) {
	if (verificationIntent === "verify") {
		return "verified" as const;
	}

	if (currentStatus === "verified" && sensitiveChanged) {
		return "draft" as const;
	}

	if (requestedStatus === "verified" && currentStatus !== "verified") {
		return "draft" as const;
	}

	return requestedStatus;
}
