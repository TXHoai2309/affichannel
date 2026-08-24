import { randomUUID } from "node:crypto";
import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();

const { db, product, project, user, workspace, workspaceMember } = await import(
	"@affichannel/db"
);
const { eq, inArray } = await import("drizzle-orm");
const { createProject } = await import(
	"@affichannel/core/project/project-service"
);
const { getDashboardOverview } = await import(
	"@affichannel/core/dashboard/dashboard-service"
);
const { createProjectRepository } = await import(
	"../packages/api/src/services/project-repository.ts"
);
const { createDashboardRepository } = await import(
	"../packages/api/src/services/dashboard-repository.ts"
);
const { getWorkspaceActor } = await import(
	"../packages/api/src/services/workspace.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

const userAId = `us003-dashboard-a-${randomUUID()}`;
const userBId = `us003-dashboard-b-${randomUUID()}`;
const workspaceAId = `us003-dashboard-workspace-a-${randomUUID()}`;
const workspaceBId = `us003-dashboard-workspace-${randomUUID()}`;
const productId = `us003-dashboard-product-${randomUUID()}`;
const projectIds: string[] = [];

try {
	await db.insert(workspace).values({
		id: workspaceAId,
		name: "US003 dashboard workspace A",
	});
	await db.insert(workspace).values({
		id: workspaceBId,
		name: "US003 dashboard workspace B",
	});

	await db.insert(user).values([
		{
			id: userAId,
			name: "US003 Dashboard A",
			email: `${userAId}@example.test`,
			emailVerified: true,
		},
		{
			id: userBId,
			name: "US003 Dashboard B",
			email: `${userBId}@example.test`,
			emailVerified: true,
		},
	]);

	await db.insert(workspaceMember).values([
		{
			id: randomUUID(),
			workspaceId: workspaceAId,
			userId: userAId,
		},
		{
			id: randomUUID(),
			workspaceId: workspaceBId,
			userId: userBId,
		},
	]);

	await db.insert(product).values({
		id: productId,
		workspaceId: workspaceAId,
		name: "US003 Dashboard Product",
		createdByUserId: userAId,
	});

	const repository = createProjectRepository();
	for (let index = 0; index < 6; index += 1) {
		const createdProject = await createProject(
			repository,
			{
				workspaceId: workspaceAId,
				userId: userAId,
			},
			{
				name: `US003 dashboard project ${index + 1}`,
				productId,
				platform: "tiktok",
				goal: "Kiểm tra Dashboard aggregate",
				durationSeconds: 30,
				angle: "Dữ liệu project thật",
				description: undefined,
			},
		);
		projectIds.push(createdProject.id);

		await db
			.update(project)
			.set({ updatedAt: new Date(Date.now() + index * 1_000) })
			.where(eq(project.id, createdProject.id));
	}

	const dashboardRepository = createDashboardRepository();
	const overview = await getDashboardOverview(dashboardRepository, {
		workspaceId: workspaceAId,
		userId: userAId,
	});
	assert(
		overview.summary.activeProjects === 6,
		"Expected six active projects.",
	);
	assert(
		overview.recentProjects.length === 5,
		"Dashboard must limit recent projects to five.",
	);
	assert(
		overview.recentProjects[0]?.name === "US003 dashboard project 6",
		"Recent projects must be ordered by updatedAt descending.",
	);
	assert(
		overview.recentProjects.every(
			(projectItem) =>
				projectItem.workflowEntry.nextCapability === "SCRIPT" &&
				projectItem.workflowEntry.nextRouteKey === "content" &&
				projectItem.completedVisibleSteps === 1 &&
				projectItem.totalVisibleSteps === 5 &&
				projectItem.targetUrl === `/projects/${projectItem.id}` &&
				projectItem.continueUrl === `/projects/${projectItem.id}/content`,
		),
		"Dashboard must expose the Adaptive entry summary and separate Open from Continue.",
	);

	const overviewForB = await getDashboardOverview(dashboardRepository, {
		workspaceId: workspaceBId,
		userId: userBId,
	});
	assert(
		overviewForB.recentProjects.length === 0 &&
			overviewForB.summary.activeProjects === 0,
		"Workspace B must not see Workspace A projects.",
	);
	assert(
		(await getWorkspaceActor(userBId)) === undefined,
		"A user outside the internal workspace must not resolve an app actor.",
	);

	console.log("Dashboard overview integration test passed.");
} finally {
	if (projectIds.length > 0) {
		await db.delete(project).where(inArray(project.id, projectIds));
	}

	await db.delete(product).where(eq(product.id, productId));
	await db.delete(workspaceMember).where(eq(workspaceMember.userId, userAId));
	await db.delete(workspace).where(eq(workspace.id, workspaceAId));
	await db.delete(workspace).where(eq(workspace.id, workspaceBId));
	await db.delete(user).where(eq(user.id, userAId));
	await db.delete(user).where(eq(user.id, userBId));
}
