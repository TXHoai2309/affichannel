import { renderFactLockPrompt } from "@affichannel/api/services/fact-lock-prompt";
import type { FactLockInputSnapshot } from "@affichannel/core/fact-lock/types";
import { describe, expect, it } from "vitest";

describe("Fact Lock prompt contract", () => {
	it("defines stale refresh, selected-hook and strict semantic requirements", () => {
		const prompt = renderFactLockPrompt({
			scriptVersion: { snapshot: {} },
		} as FactLockInputSnapshot);
		const contract = `${prompt.trustedInstructions}\n${prompt.outputSchema}`;

		expect(contract).toContain("selectedHookKey");
		expect(contract).toContain("metadata cũ có thể stale");
		expect(contract).toContain("câu non-factual phải được omit");
		expect(contract).toContain("chỉ trích phần factual proposition liên tục");
		expect(contract).toContain('"schemaVersion":"fact-lock-output.v1"');
		expect(contract).toContain(
			"SUPPORTED phải có ít nhất một mapping supports",
		);
		expect(contract).toContain("claimText phải là một đoạn trích nguyên văn");
	});
});
