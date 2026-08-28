import type { ScriptVersionReadModel } from "@affichannel/core/script-version/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ScriptVersionCurrentView from "./script-version-current-view";

const version = {
	id: "draft-current",
	workspaceId: "workspace-1",
	projectId: "project-1",
	sourceGenerationId: "generation-1",
	status: "draft",
	versionNumber: null,
	editableSnapshot: {
		schemaVersion: "script-draft.v2",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook-1", text: "NEW HOOK" },
			{ key: "hook-2", text: "Other hook" },
			{ key: "hook-3", text: "Third hook" },
		],
		selectedHookKey: "hook-1",
		voiceoverSegments: [{ key: "voice-1", text: "NEW VOICE" }],
		scenes: [
			{
				order: 1,
				durationSeconds: 5,
				visualDirection: "Visual",
				onScreenText: "Current text",
				voiceoverSegmentKeys: ["voice-1"],
			},
		],
		cta: { text: "Current CTA" },
		caption: "Current caption",
		hashtags: ["#current"],
		disclosure: "Current disclosure",
		claims: [],
		claimsSourceRevision: 2,
		claimsStatus: "current",
	},
	revision: 2,
	restoredFromVersionId: null,
	createdByUserId: "user-1",
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	savedAt: null,
} as ScriptVersionReadModel;

describe("Script Studio current Script read model", () => {
	it("renders current ScriptVersion values as primary content", () => {
		const markup = renderToStaticMarkup(
			createElement(ScriptVersionCurrentView, { scriptVersion: version }),
		);

		expect(markup).toContain("Kịch bản hiện tại");
		expect(markup).toContain("NEW HOOK");
		expect(markup).toContain("NEW VOICE");
		expect(markup).not.toContain("OLD HOOK");
		expect(markup).not.toContain("OLD VOICE");
	});

	it("shows the explicit refresh action only for stale claims", () => {
		const stale = {
			...version,
			editableSnapshot: {
				...version.editableSnapshot,
				claimsStatus: "stale" as const,
			},
		};
		const props = { onRefreshClaims: () => undefined };
		const markup = renderToStaticMarkup(
			createElement(ScriptVersionCurrentView, {
				...props,
				scriptVersion: stale,
			}),
		);
		const currentMarkup = renderToStaticMarkup(
			createElement(ScriptVersionCurrentView, {
				...props,
				scriptVersion: version,
			}),
		);

		expect(markup).toContain("Cập nhật Claims");
		expect(currentMarkup).not.toContain("Cập nhật Claims");
	});
});
