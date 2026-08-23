import { randomUUID } from "node:crypto";
import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();

const { contentBrief, db, product, project, user, workspace, workspaceMember } =
	await import("@affichannel/db");
const { and, eq } = await import("drizzle-orm");
const { INTERNAL_WORKSPACE_ID } = await import("@affichannel/core/workspace");
const { createProject, ProjectServiceError, updateProject } = await import(
	"@affichannel/core/project/project-service"
);
const { createProjectRepository, getProjectDetails } = await import(
	"../packages/api/src/services/project-repository.ts"
);
const { getWorkspaceActor } = await import(
	"../packages/api/src/services/workspace.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

const userAId = `us004-authz-a-${randomUUID()}`;
const userBId = `us004-authz-b-${randomUUID()}`;
const workspaceBId = `us004-authz-workspace-${randomUUID()}`;
const productAId = `us004-authz-product-${randomUUID()}`;
let projectAId: string | undefined;

try {
	await db
		.insert(workspace)
		.values({ id: workspaceBId, name: "US004 authorization workspace B" });

	await db.insert(user).values([
		{
			id: userAId,
			name: "US004 Authorization A",
			email: `${userAId}@example.test`,
			emailVerified: true,
		},
		{
			id: userBId,
			name: "US004 Authorization B",
			email: `${userBId}@example.test`,
			emailVerified: true,
		},
	]);

	await db.insert(workspaceMember).values([
		{
			id: randomUUID(),
			workspaceId: INTERNAL_WORKSPACE_ID,
			userId: userAId,
		},
		{
			id: randomUUID(),
			workspaceId: workspaceBId,
			userId: userBId,
		},
	]);

	await db.insert(product).values({
		id: productAId,
		workspaceId: INTERNAL_WORKSPACE_ID,
		name: "US004 Authorization Product",
		createdByUserId: userAId,
	});

	const repository = createProjectRepository();
	const projectA = await createProject(
		repository,
		{
			workspaceId: INTERNAL_WORKSPACE_ID,
			userId: userAId,
		},
		{
			name: "US004 private project",
			productId: productAId,
			platform: "tiktok",
			goal: "Kiểm tra giới hạn workspace",
			durationSeconds: 30,
			angle: "Chỉ thành viên workspace được truy cập",
			description: undefined,
		},
	);
	projectAId = projectA.id;

	const actorA = await getWorkspaceActor(userAId);
	const actorB = await getWorkspaceActor(userBId);
	assert(
		actorA?.workspaceId === INTERNAL_WORKSPACE_ID,
		"User A should resolve to the internal workspace.",
	);
	assert(
		actorB === undefined,
		"User B must not resolve through a non-internal workspace membership.",
	);

	const projectForB = await repository.findProject({
		workspaceId: workspaceBId,
		projectId: projectA.id,
	});
	assert(projectForB === undefined, "User B must not read Project A.");

	const projectsForB = await repository.listProjects({
		workspaceId: workspaceBId,
	});
	assert(
		!projectsForB.some((item) => item.id === projectA.id),
		"User B must not list Project A.",
	);

	const detailsForB = await getProjectDetails(workspaceBId, projectA.id);
	assert(detailsForB === undefined, "User B must not load Project A details.");

	const archivedByB = await repository.archiveProject({
		workspaceId: workspaceBId,
		projectId: projectA.id,
	});
	assert(archivedByB === undefined, "User B must not archive Project A.");

	try {
		await updateProject(
			repository,
			{
				workspaceId: workspaceBId,
				userId: userBId,
			},
			{
				id: projectA.id,
				name: "Unauthorized update",
				productId: productAId,
				platform: "tiktok",
				goal: "Không được phép",
				durationSeconds: 30,
				angle: "Không được phép",
				description: undefined,
			},
		);
		throw new Error("User B unexpectedly updated Project A.");
	} catch (error) {
		assert(
			error instanceof ProjectServiceError &&
				error.code === "PROJECT_NOT_FOUND",
			"Cross-workspace update must return PROJECT_NOT_FOUND.",
		);
	}

	console.log("Project authorization integration test passed.");
} finally {
	if (projectAId) {
		await db.delete(project).where(eq(project.id, projectAId));
	}

	await db
		.delete(contentBrief)
		.where(eq(contentBrief.projectId, projectAId ?? ""));
	await db.delete(product).where(eq(product.id, productAId));
	await db
		.delete(workspaceMember)
		.where(
			and(
				eq(workspaceMember.userId, userAId),
				eq(workspaceMember.workspaceId, INTERNAL_WORKSPACE_ID),
			),
		);
	await db.delete(workspace).where(eq(workspace.id, workspaceBId));
	await db.delete(user).where(eq(user.id, userAId));
	await db.delete(user).where(eq(user.id, userBId));
}
