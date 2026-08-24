import {
	listProjectWorkflowEntrySummaries,
	type ProjectWorkflowEntryBatchRepository,
	type ProjectWorkflowEntryBatchRows,
} from "@affichannel/api/services/project-workflow-entry-service";
import type { ProjectWorkflowEntrySummary } from "@affichannel/core";
import { describe, expect, it, vi } from "vitest";

import {
	getPostCreateProjectHref,
	getProductRelatedProjectHref,
	getProjectEntryPresentation,
} from "./project-entry-presentation";

function entry(
	patch: Partial<ProjectWorkflowEntrySummary> = {},
): ProjectWorkflowEntrySummary {
	return {
		projectId: "project-1",
		nextCapability: "SCRIPT",
		nextRouteKey: "content",
		nextState: "REQUIRED",
		nextCompletion: "NOT_STARTED",
		nextReasonCode: "SCRIPT_GENERATION_REQUIRED",
		nextActionKind: "RESOLVE_BLOCKER",
		completedVisibleSteps: 1,
		totalVisibleSteps: 5,
		unsupported: false,
		canContinue: true,
		...patch,
	};
}

describe("Project entry navigation", () => {
	it.each([
		["SCRIPT", "content", "/projects/project-1/content"],
		["FACT_LOCK", "fact-lock", "/projects/project-1/fact-lock"],
		["VOICE", "voice", "/projects/project-1/voice"],
	] as const)(
		"continues %s through nextRouteKey",
		(capability, route, href) => {
			const result = getProjectEntryPresentation(
				"project-1",
				entry({ nextCapability: capability, nextRouteKey: route }),
			);
			expect(result.continueHref).toBe(href);
			expect(result.actionLabel).toBe("Tiếp tục");
		},
	);

	it("ignores a stale legacy cursor and follows the Adaptive VOICE route", () => {
		const staleProject = {
			currentStepKey: "product",
			workflowEntry: entry({
				nextCapability: "VOICE",
				nextRouteKey: "voice",
			}),
		};
		const result = getProjectEntryPresentation(
			"project-1",
			staleProject.workflowEntry,
		);
		expect(result.continueHref).toBe("/projects/project-1/voice");
		expect(result.continueHref).not.toContain("product");
	});

	it("keeps Render coming soon and unsupported workflows on Overview", () => {
		const render = getProjectEntryPresentation(
			"project-1",
			entry({
				nextCapability: "RENDER",
				nextRouteKey: "video",
				nextState: "BLOCKED",
				nextReasonCode: "RENDER_FEATURE_NOT_IMPLEMENTED",
				nextActionKind: "COMING_SOON",
				completedVisibleSteps: 4,
				totalVisibleSteps: 5,
				canContinue: false,
			}),
		);
		expect(render).toMatchObject({
			continueHref: "/projects/project-1",
			statusLabel: "Sắp có",
			actionLabel: "Mở dự án",
		});

		const unsupported = getProjectEntryPresentation(
			"project-1",
			entry({ unsupported: true, canContinue: false }),
		);
		expect(unsupported).toMatchObject({
			continueHref: "/projects/project-1",
			statusLabel: "Cần kiểm tra",
		});
	});

	it("uses Overview for generic Product-detail Open Project links", () => {
		expect(getProductRelatedProjectHref("project-1")).toBe(
			"/projects/project-1",
		);
	});

	it("lands a newly created linked Affiliate Project on Adaptive SCRIPT", () => {
		const project = {
			id: "new-affiliate-project",
			currentStepKey: "product",
			workflowEntry: entry({
				projectId: "new-affiliate-project",
				nextCapability: "SCRIPT",
				nextRouteKey: "content",
			}),
		};
		expect(getPostCreateProjectHref(project)).toBe(
			"/projects/new-affiliate-project/content",
		);
	});
});

describe("Project entry batch query boundary", () => {
	it("loads twenty cards through one batch repository call", async () => {
		const subjects = Array.from({ length: 20 }, (_, index) => ({
			id: `project-${index + 1}`,
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
			productId: `product-${index + 1}`,
			productAccessible: false,
		}));
		const rows: ProjectWorkflowEntryBatchRows = {
			subjects,
			scriptGenerations: [],
			scriptVersions: [],
			factLockRuns: [],
			dependencies: [],
			productFacts: [],
			channelSettings: null,
			voiceConfigs: [],
			voiceArtifacts: [],
		};
		const load = vi.fn(async () => rows);
		const repository: ProjectWorkflowEntryBatchRepository = { load };

		const summaries = await listProjectWorkflowEntrySummaries(
			{ workspaceId: "workspace-1", userId: "user-1" },
			subjects.map((subject) => subject.id),
			repository,
		);

		expect(summaries).toHaveLength(20);
		expect(load).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledWith(
			{ workspaceId: "workspace-1", userId: "user-1" },
			subjects.map((subject) => subject.id),
		);
	});
});
