import type { ScriptVersionReadModel } from "@affichannel/core/script-version/types";
import { describe, expect, it } from "vitest";

import {
	buildClaimSubjectDecisions,
	getClaimSubjectLabel,
	getUnresolvedClaimSubjects,
} from "./claim-subject-confirmation-panel";

function scriptVersion(
	claims: ScriptVersionReadModel["editableSnapshot"]["claims"],
): ScriptVersionReadModel {
	return {
		id: "version-1",
		workspaceId: "workspace-1",
		projectId: "project-1",
		sourceGenerationId: "generation-1",
		status: "draft",
		versionNumber: null,
		editableSnapshot: {
			schemaVersion: "script-draft.v3",
			language: "vi",
			hookVariants: [],
			voiceoverSegments: [],
			scenes: [],
			cta: { text: "" },
			caption: "",
			hashtags: [],
			disclosure: "",
			claims,
			selectedHookKey: null,
			claimsSourceRevision: 1,
			claimsStatus: "current",
		},
		revision: 2,
		restoredFromVersionId: null,
		createdByUserId: "user-1",
		createdAt: new Date(0),
		updatedAt: new Date(0),
		savedAt: null,
	};
}

describe("Organic claim confirmation presentation", () => {
	it("uses friendly subject labels", () => {
		expect(getClaimSubjectLabel("GENERAL")).toBe("Thông tin chung");
		expect(getClaimSubjectLabel("PRODUCT")).toBe("Thông tin về sản phẩm");
	});

	it("finds only unresolved claims and preserves the AI proposal", () => {
		const pending = getUnresolvedClaimSubjects(
			scriptVersion([
				{
					text: "Claim chung",
					occurrence: { section: "caption" },
					subject: { kind: "GENERAL" },
					subjectStatus: "NEEDS_CONFIRMATION",
					subjectSource: null,
					proposedSubject: "PRODUCT",
				},
				{
					text: "Claim đã chọn",
					occurrence: { section: "cta" },
					subject: { kind: "GENERAL" },
					subjectStatus: "CONFIRMED",
					subjectSource: "USER",
				},
			]),
		);
		expect(pending).toHaveLength(1);
		expect(pending[0]?.claimIndex).toBe(0);
		expect(pending[0]?.proposedSubject).toBe("PRODUCT");
	});

	it("builds one deterministic batch decision payload", () => {
		expect(buildClaimSubjectDecisions({ 4: "PRODUCT", 1: "GENERAL" })).toEqual([
			{ claimIndex: 1, subject: "GENERAL" },
			{ claimIndex: 4, subject: "PRODUCT" },
		]);
	});
});
