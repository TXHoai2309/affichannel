import { describe, expect, it } from "vitest";

import {
	APP_ROUTES,
	getAppRouteFromPathname,
	isAppRouteActive,
} from "./routes";

describe("app route contract", () => {
	it("marks nested project routes as Dự án", () => {
		expect(getAppRouteFromPathname("/projects/demo/fact-lock")?.key).toBe(
			"projects",
		);
		expect(
			isAppRouteActive("/projects/demo/fact-lock", APP_ROUTES.projects),
		).toBe(true);
		expect(
			isAppRouteActive("/projects/demo/fact-lock", APP_ROUTES.dashboard),
		).toBe(false);
	});
});
