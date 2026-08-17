import type { FactLockPolicySnapshot } from "./types";

function normalize(value: string) {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase("vi-VN")
		.replace(/\s+/g, " ")
		.trim();
}

export function evaluateFactLockPolicy(
	claimText: string,
	occurrenceText: string,
	policy: FactLockPolicySnapshot,
) {
	const haystack = normalize(`${claimText} ${occurrenceText}`);
	const prohibitedWord = policy.avoidWords
		.map(normalize)
		.find((word) => word && haystack.includes(word));
	return prohibitedWord
		? {
				prohibited: true as const,
				reason: `Nội dung chứa từ cần tránh: ${prohibitedWord}.`,
			}
		: { prohibited: false as const, reason: null };
}
