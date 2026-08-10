import { describe, expect, it } from "vitest";

import {
	getSafeAuthErrorMessage,
	INVALID_CREDENTIALS_MESSAGE,
} from "./auth-errors";

describe("auth error mapping", () => {
	it("uses a neutral message for provider errors", () => {
		expect(
			getSafeAuthErrorMessage({
				error: {
					message: "database connection string and password",
					statusText: "Internal Server Error",
				},
			}),
		).toBe(INVALID_CREDENTIALS_MESSAGE);
	});

	it("also masks unknown thrown values", () => {
		expect(getSafeAuthErrorMessage(new Error("secret"))).toBe(
			INVALID_CREDENTIALS_MESSAGE,
		);
		expect(getSafeAuthErrorMessage(null)).toBe(INVALID_CREDENTIALS_MESSAGE);
	});
});
