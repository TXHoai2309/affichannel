import { describe, expect, it } from "vitest";

import {
	getScriptPresentationIdentity,
	getScriptPresentationState,
} from "./script-studio-state";

const organicIdentity = getScriptPresentationIdentity({
	project: { contentType: "ORGANIC", creationPath: "SCRIPTED" },
});

const confirmedGeneralClaim = {
	text: "Một thói quen nhỏ giúp bắt đầu ngày mới.",
	occurrence: { section: "caption" as const },
	subject: { kind: "GENERAL" as const },
	subjectStatus: "CONFIRMED" as const,
	subjectSource: "USER" as const,
};

const confirmedProductClaim = {
	...confirmedGeneralClaim,
	text: "Bình giữ lạnh 12 giờ.",
	subject: { kind: "PRODUCT" as const, binding: "PROJECT_PRODUCT" as const },
};

describe("Script Studio optional-section presentation", () => {
	it("maps Organic claimless output to NOT_REQUIRED without warnings", () => {
		expect(
			getScriptPresentationState({
				identity: organicIdentity,
				claimsStatus: "current",
				claims: [],
			}),
		).toEqual({ factLock: "NOT_REQUIRED", disclosure: "NOT_REQUIRED" });
	});

	it("keeps confirmed Organic GENERAL claims out of Fact Lock", () => {
		expect(
			getScriptPresentationState({
				identity: organicIdentity,
				claimsStatus: "current",
				claims: [confirmedGeneralClaim],
			}),
		).toEqual({ factLock: "NOT_REQUIRED", disclosure: "NOT_REQUIRED" });
	});

	it("keeps confirmed Organic PRODUCT claims active", () => {
		expect(
			getScriptPresentationState({
				identity: organicIdentity,
				claimsStatus: "current",
				claims: [confirmedProductClaim],
			}),
		).toEqual({ factLock: "REQUIRED", disclosure: "NOT_REQUIRED" });
	});

	it("preserves required disclosure and Fact Lock for Affiliate", () => {
		expect(
			getScriptPresentationState({
				identity: { contentType: "AFFILIATE", creationPath: "SCRIPTED" },
				claimsStatus: "current",
				claims: [],
			}),
		).toEqual({ factLock: "REQUIRED", disclosure: "REQUIRED" });
	});
});
