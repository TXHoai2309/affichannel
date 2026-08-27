import { randomUUID } from "node:crypto";
import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();

const { eq } = await import("drizzle-orm");
const {
	db,
	factLockRun,
	product,
	project,
	scriptGeneration,
	scriptVersion,
	user,
	workspace,
} = await import("@affichannel/db");
const { getDashboardOverview } = await import(
	"@affichannel/core/dashboard/dashboard-service"
);
const { getFactLockState } = await import(
	"../packages/api/src/services/fact-lock-service.ts"
);
const { loadFactLockReadContext } = await import(
	"../packages/api/src/services/fact-lock-read-service.ts"
);
const { listProjectItems } = await import(
	"../packages/api/src/services/project-repository.ts"
);
const { createDashboardRepository } = await import(
	"../packages/api/src/services/dashboard-repository.ts"
);
const { listProjectWorkflowEntrySummaries } = await import(
	"../packages/api/src/services/project-workflow-entry-service.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const fixture = {
	userId: randomUUID(),
	workspaceId: randomUUID(),
	productId: randomUUID(),
	projectId: randomUUID(),
	unrelatedProjectId: randomUUID(),
	generationId: randomUUID(),
	scriptVersionId: randomUUID(),
	runId: randomUUID(),
};
const actor = { workspaceId: fixture.workspaceId, userId: fixture.userId };

function scriptSnapshot() {
	return {
		schemaVersion: "script-draft.v2",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook-a", text: "Một thông tin hữu ích." },
			{ key: "hook-b", text: "Một lựa chọn đáng cân nhắc." },
			{ key: "hook-c", text: "Điều cần biết trước khi chọn." },
		],
		selectedHookKey: "hook-a",
		voiceoverSegments: [
			{ key: "intro", text: "Đây là nội dung kiểm thử đã được làm sạch." },
		],
		scenes: [
			{
				order: 1,
				durationSeconds: 15,
				visualDirection: "Hình minh họa trung tính",
				onScreenText: "Nội dung kiểm thử",
				voiceoverSegmentKeys: ["intro"],
			},
		],
		cta: { text: "Tìm hiểu thêm." },
		caption: "Fixture kiểm thử tương thích.",
		hashtags: ["#fixture"],
		disclosure: "Nội dung kiểm thử.",
		claims: [],
		claimsSourceRevision: 1,
		claimsStatus: "stale",
	};
}

function malformedHistoricalSnapshot() {
	return {
		snapshotVersion: "fact-lock-input.v1",
		scriptVersion: {
			id: fixture.scriptVersionId,
			revision: 1,
			snapshot: scriptSnapshot(),
		},
		productFacts: [
			{
				id: "sanitized-fact-id",
				revision: 1,
				content: "Sanitized historical fixture fact.",
				type: "feature",
				status: "verified",
				// This is the observed invalid shape: current and historical
				// production builders require the assessment object.
				assessment: "fresh",
				generationUsability: "allowed",
				source: {
					type: "fixture",
					label: "Sanitized fixture",
					url: null,
					confirmedAt: "2026-08-27",
					expiresAt: null,
				},
			},
		],
		policy: {
			avoidWords: [],
			affiliateDisclosure: "Nội dung kiểm thử.",
			language: "vi-VN",
		},
		outputRules: {
			language: "vi-VN",
			aspectRatio: "9:16",
			subtitleSafeArea: "standard",
			claimLimit: null,
			requireFinalCta: true,
		},
	};
}

try {
	await db.insert(workspace).values({
		id: fixture.workspaceId,
		name: "Sanitized legacy compatibility workspace",
	});
	await db.insert(user).values({
		id: fixture.userId,
		name: "Sanitized legacy compatibility user",
		email: `${fixture.userId}@example.test`,
		emailVerified: true,
	});
	await db.insert(product).values({
		id: fixture.productId,
		workspaceId: fixture.workspaceId,
		name: "Sanitized legacy compatibility product",
		createdByUserId: fixture.userId,
	});
	await db.insert(project).values([
		{
			id: fixture.projectId,
			workspaceId: fixture.workspaceId,
			name: "Malformed historical Fact Lock fixture",
			productId: fixture.productId,
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
			currentStepKey: "fact-lock",
			createdByUserId: fixture.userId,
		},
		{
			id: fixture.unrelatedProjectId,
			workspaceId: fixture.workspaceId,
			name: "Unrelated project fixture",
			productId: fixture.productId,
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
			currentStepKey: "product",
			createdByUserId: fixture.userId,
		},
	]);
	await db.insert(scriptGeneration).values({
		id: fixture.generationId,
		workspaceId: fixture.workspaceId,
		projectId: fixture.projectId,
		createdByUserId: fixture.userId,
		idempotencyKey: `legacy-compat-${fixture.generationId}`,
		requestHash: "a".repeat(64),
		mode: "full",
		provider: "deterministic",
		model: "legacy-compatibility-fixture",
		promptVersion: "fixture",
		outputSchemaVersion: "fixture",
		inputSnapshotJson: {},
		inputHash: "b".repeat(64),
		promptHash: "c".repeat(64),
		status: "failed",
		outputJson: null,
		validSections: [],
		invalidSections: [],
		errorCode: "FIXTURE_NOT_EXECUTED",
		finishedAt: new Date(),
	});
	await db.insert(scriptVersion).values({
		id: fixture.scriptVersionId,
		workspaceId: fixture.workspaceId,
		projectId: fixture.projectId,
		sourceGenerationId: fixture.generationId,
		status: "draft",
		versionNumber: null,
		editableSnapshotJson: scriptSnapshot(),
		revision: 1,
		createdByUserId: fixture.userId,
	});
	await db.insert(factLockRun).values({
		id: fixture.runId,
		workspaceId: fixture.workspaceId,
		projectId: fixture.projectId,
		scriptVersionId: fixture.scriptVersionId,
		sourceScriptRevision: 1,
		inputMode: null,
		claimManifestId: null,
		claimManifestFingerprint: null,
		idempotencyKey: `legacy-compat-${fixture.runId}`,
		requestHash: "d".repeat(64),
		inputSnapshotJson: malformedHistoricalSnapshot(),
		inputHash: "e".repeat(64),
		promptHash: "f".repeat(64),
		provider: "deterministic",
		model: "legacy-compatibility-fixture",
		promptVersion: "fixture",
		outputSchemaVersion: "fixture",
		status: "passed",
		createdByUserId: fixture.userId,
		createdAt: new Date(),
		finishedAt: new Date(),
	});

	const state = await getFactLockState(actor, fixture.projectId);
	assert(state.latestRequest?.id === fixture.runId, "Legacy run was not read.");
	assert(
		state.latestRequest?.effectiveStatus === "stale",
		"Malformed historical run must be represented as stale.",
	);
	assert(
		state.latestApplicableRun === null && state.effectiveStatus === "stale",
		"Malformed historical run must not be applicable or PASS.",
	);

	const context = await loadFactLockReadContext(actor, fixture.projectId, {
		includeArchived: true,
	});
	assert(
		context.runs[0]?.sourceCurrent === false &&
			context.runs[0]?.dependenciesCurrent === false,
		"Malformed historical run must be blocked by both read dependencies.",
	);

	const projects = await listProjectItems(fixture.workspaceId);
	const summaries = await listProjectWorkflowEntrySummaries(
		actor,
		projects.map((item) => item.id),
	);
	assert(
		projects.some((item) => item.id === fixture.projectId) &&
			projects.some((item) => item.id === fixture.unrelatedProjectId),
		"Project list must preserve both the affected and unrelated project.",
	);
	assert(
		summaries.some((summary) => summary.projectId === fixture.projectId) &&
			summaries.some(
				(summary) => summary.projectId === fixture.unrelatedProjectId,
			),
		"Project workflow batch must isolate the malformed run.",
	);
	const affectedSummary = summaries.find(
		(summary) => summary.projectId === fixture.projectId,
	);
	assert(
		affectedSummary?.projectId === fixture.projectId &&
			affectedSummary.unsupported === false,
		"Affected project must receive a safe workflow entry.",
	);

	const overview = await getDashboardOverview(
		createDashboardRepository(),
		actor,
	);
	assert(
		overview.summary.activeProjects === 2 &&
			overview.recentProjects.length === 2,
		"Dashboard must retain both projects despite one malformed run.",
	);
	assert(
		overview.recentProjects.some(
			(item) =>
				item.id === fixture.projectId &&
				item.workflowEntry.unsupported === false,
		),
		"Dashboard must expose a safe workflow entry for the affected project.",
	);

	console.log(
		"Legacy Fact Lock compatibility integration passed: malformed legacy run isolated; gate blocked; project list/dashboard preserved; fixture mutations=setup+cleanup only; providerCalls=0.",
	);
} finally {
	await db.delete(factLockRun).where(eq(factLockRun.id, fixture.runId));
	await db
		.delete(scriptVersion)
		.where(eq(scriptVersion.id, fixture.scriptVersionId));
	await db
		.delete(scriptGeneration)
		.where(eq(scriptGeneration.id, fixture.generationId));
	await db.delete(project).where(eq(project.id, fixture.projectId));
	await db.delete(project).where(eq(project.id, fixture.unrelatedProjectId));
	await db.delete(product).where(eq(product.id, fixture.productId));
	await db.delete(workspace).where(eq(workspace.id, fixture.workspaceId));
	await db.delete(user).where(eq(user.id, fixture.userId));
}
