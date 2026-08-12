import { describe, expect, it } from "vitest";

import { getUserDisplayName } from "./user-display-name";

describe("getUserDisplayName", () => {
	it("prefers a trimmed user name", () => {
		expect(
			getUserDisplayName({
				name: "  Tô Xuân Hoài  ",
				email: "hoai@example.com",
			}),
		).toBe("Tô Xuân Hoài");
	});

	it("falls back to email when the name is missing", () => {
		expect(getUserDisplayName({ name: null, email: "hoai@example.com" })).toBe(
			"hoai@example.com",
		);
	});

	it("falls back to email when the name is blank", () => {
		expect(getUserDisplayName({ name: "   ", email: "hoai@example.com" })).toBe(
			"hoai@example.com",
		);
	});
});
