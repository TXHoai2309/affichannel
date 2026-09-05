import { describe, expect, it } from "vitest";

import {
	getProjectMediaEligibilityMessage,
	isProjectMediaLinkEligible,
	mergeProjectMediaPage,
} from "./project-media-helpers";

const ready = {
	status: "ready" as const,
	archivedAt: null,
	usageRights: "owned" as const,
};

describe("project media reuse eligibility", () => {
	it("allows READY active media for Organic without an extra rights gate", () => {
		expect(
			isProjectMediaLinkEligible(
				{ ...ready, usageRights: "unknown" },
				"ORGANIC",
			),
		).toBe(true);
		expect(isProjectMediaLinkEligible(ready, "ORGANIC")).toBe(true);
	});

	it("allows only owned or licensed media for Affiliate", () => {
		expect(isProjectMediaLinkEligible(ready, "AFFILIATE")).toBe(true);
		expect(
			isProjectMediaLinkEligible(
				{ ...ready, usageRights: "licensed" },
				"AFFILIATE",
			),
		).toBe(true);
		expect(
			isProjectMediaLinkEligible(
				{ ...ready, usageRights: "unknown" },
				"AFFILIATE",
			),
		).toBe(false);
		expect(
			getProjectMediaEligibilityMessage(
				{ ...ready, usageRights: "restricted" },
				"AFFILIATE",
			),
		).toBe("Không đủ quyền sử dụng cho nội dung Affiliate.");
	});

	it("excludes archived and non-ready assets from new links", () => {
		expect(
			isProjectMediaLinkEligible(
				{ ...ready, status: "archived", archivedAt: new Date() },
				"ORGANIC",
			),
		).toBe(false);
		expect(
			getProjectMediaEligibilityMessage(
				{ ...ready, status: "validating" },
				"ORGANIC",
			),
		).toBe("Media chưa sẵn sàng để thêm vào dự án.");
	});

	it("merges cursor pages without duplicating asset identities", () => {
		const first = [{ ...ready, id: "asset-a" }];
		const second = [
			{ ...ready, id: "asset-a" },
			{ ...ready, id: "asset-b" },
		];
		expect(
			mergeProjectMediaPage(first, second, "cursor-1").map((asset) => asset.id),
		).toEqual(["asset-a", "asset-b"]);
	});
});
