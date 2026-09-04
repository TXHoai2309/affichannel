import { describe, expect, it } from "vitest";

import { resolveDeterministicScenario } from "../../../../../packages/api/src/providers/text/deterministic-text-provider";

describe("deterministic browser scenario seam", () => {
	it("is unavailable outside isolated E2E, including production", () => {
		const testEnvironment = process.env as Record<string, string | undefined>;
		const previousIsolation = testEnvironment.AFFICHANNEL_ISOLATED_TEST_ENV;
		const previousNodeEnv = testEnvironment.NODE_ENV;
		try {
			delete testEnvironment.AFFICHANNEL_ISOLATED_TEST_ENV;
			testEnvironment.NODE_ENV = "development";
			expect(resolveDeterministicScenario("organic-product-e2e")).toBe("valid");
			testEnvironment.AFFICHANNEL_ISOLATED_TEST_ENV = "1";
			testEnvironment.NODE_ENV = "production";
			expect(resolveDeterministicScenario("organic-product-e2e")).toBe("valid");
		} finally {
			if (previousIsolation === undefined)
				delete testEnvironment.AFFICHANNEL_ISOLATED_TEST_ENV;
			else testEnvironment.AFFICHANNEL_ISOLATED_TEST_ENV = previousIsolation;
			if (previousNodeEnv === undefined) delete testEnvironment.NODE_ENV;
			else testEnvironment.NODE_ENV = previousNodeEnv;
		}
	});

	it("is available only in isolated non-production E2E", () => {
		const testEnvironment = process.env as Record<string, string | undefined>;
		const previousIsolation = testEnvironment.AFFICHANNEL_ISOLATED_TEST_ENV;
		const previousNodeEnv = testEnvironment.NODE_ENV;
		try {
			testEnvironment.AFFICHANNEL_ISOLATED_TEST_ENV = "1";
			testEnvironment.NODE_ENV = "development";
			expect(resolveDeterministicScenario("organic-product-e2e")).toBe(
				"organic_product_proposal",
			);
			expect(resolveDeterministicScenario("organic-general-e2e")).toBe(
				"organic_general_proposal",
			);
			expect(resolveDeterministicScenario("organic-zero-e2e")).toBe(
				"organic_zero_claims",
			);
		} finally {
			if (previousIsolation === undefined)
				delete testEnvironment.AFFICHANNEL_ISOLATED_TEST_ENV;
			else testEnvironment.AFFICHANNEL_ISOLATED_TEST_ENV = previousIsolation;
			if (previousNodeEnv === undefined) delete testEnvironment.NODE_ENV;
			else testEnvironment.NODE_ENV = previousNodeEnv;
		}
	});
});
