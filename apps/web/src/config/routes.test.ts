import { describe, expect, it } from "vitest";

import {
	APP_ROUTES,
	getAppRouteFromPathname,
	getBreadcrumbItems,
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

	it("builds breadcrumb labels for a project step", () => {
		expect(
			getBreadcrumbItems("/projects/demo/fact-lock").map((item) => item.label),
		).toEqual(["Dự án", "Video Affiliate Tai nghe", "Fact Lock"]);
	});

	it("keeps a top-level route as the current breadcrumb", () => {
		expect(getBreadcrumbItems("/analytics")).toEqual([
			{ label: "Analytics", href: "/analytics", current: true },
		]);
	});
});
