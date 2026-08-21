export type SingleJsonObjectIssueCode = "ROOT_NOT_JSON" | "ROOT_NOT_OBJECT";

export type SingleJsonObjectParseResult =
	| { success: true; data: Record<string, unknown> }
	| { success: false; issueCode: SingleJsonObjectIssueCode };

function fencedJsonPayload(value: string) {
	const match = value.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
	return match?.[1]?.trim();
}

export function parseSingleJsonObject(
	raw: unknown,
): SingleJsonObjectParseResult {
	let parsed = raw;
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		const candidate = trimmed.startsWith("```")
			? fencedJsonPayload(trimmed)
			: trimmed;
		if (candidate === undefined) {
			return { success: false, issueCode: "ROOT_NOT_JSON" };
		}
		try {
			parsed = JSON.parse(candidate) as unknown;
		} catch {
			return { success: false, issueCode: "ROOT_NOT_JSON" };
		}
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { success: false, issueCode: "ROOT_NOT_OBJECT" };
	}
	return { success: true, data: parsed as Record<string, unknown> };
}
