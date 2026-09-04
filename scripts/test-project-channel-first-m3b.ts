import { randomUUID } from "node:crypto";
import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();

const {
	contentBrief,
	db,
	product,
	project,
	projectStepStatus,
	user,
	workspace,
} = await import("@affichannel/db");
const { and, eq } = await import("drizzle-orm");
const { createProject, ProjectServiceError, updateProject } = await import(
	"@affichannel/core/project/project-service"
);
const { createProjectInputSchema, updateProjectInputSchema } = await import(
	"@affichannel/core/project/project-validation"
);
const { createProjectRepository, getProjectDetails, listProjectItems } =
	await import("../packages/api/src/services/project-repository.ts");

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const workspaceId = `us016-m3b-workspace-${randomUUID()}`;
const userId = `us016-m3b-user-${randomUUID()}`;
const productId = randomUUID();
const actor = { workspaceId, userId };
const projectIds: string[] = [];

const baseFields = {
	name: "M3B compatibility project",
	productId,
	platform: "tiktok" as const,
	goal: "M3B production compatibility",
	durationSeconds: 30,
	angle: "M3B deterministic identity",
	description: undefined,
};

const canonicalIdentity = {
	contentType: "AFFILIATE" as const,
	creationPath: "SCRIPTED" as const,
	contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
};

async function rawProject(projectId: string) {
	const [record] = await db
		.select({
			productId: project.productId,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
		})
		.from(project)
		.where(eq(project.id, projectId));
	return record;
}

async function insertProjectFixture(
	projectId: string,
	name: string,
	identity: {
		contentType?: string | null;
		creationPath?: string | null;
		contentFormatKey?: string | null;
		contentFormatVersion?: number | null;
	} = {},
) {
	await db.insert(project).values({
		id: projectId,
		workspaceId,
		name,
		productId,
		...identity,
		currentStepKey: "product",
		createdByUserId: userId,
	});
	await db.insert(contentBrief).values({
		id: randomUUID(),
		projectId,
		platform: "tiktok",
		goal: "M3B legacy fixture",
		durationSeconds: 30,
		angle: "M3B legacy fixture",
	});
	projectIds.push(projectId);
}

async function insertLegacyProject(projectId: string, name: string) {
	await insertProjectFixture(projectId, name);
}

async function projectCount() {
	return (
		await db
			.select({ id: project.id })
			.from(project)
			.where(eq(project.workspaceId, workspaceId))
	).length;
}

async function expectRejected(
	input: Parameters<typeof createProject>[2],
	reasonCode: string,
) {
	const before = await projectCount();
	try {
		await createProject(createProjectRepository(), actor, input);
		throw new Error(`Expected M3B rejection: ${reasonCode}`);
	} catch (error) {
		assert(
			error instanceof ProjectServiceError &&
				error.code === "INVALID_PROJECT_WRITE_IDENTITY" &&
				error.metadata.reasonCode === reasonCode,
			`Expected typed M3B rejection ${reasonCode}.`,
		);
	}
	assert(
		(await projectCount()) === before,
		`Rejected ${reasonCode} request mutated Project state.`,
	);
}

async function expectUpdateRejected(
	repository: ReturnType<typeof createProjectRepository>,
	input: Parameters<typeof updateProject>[2],
	reasonCode: string,
) {
	const beforeProject = await rawProject(input.id);
	const beforeDetail = await getProjectDetails(workspaceId, input.id);
	try {
		await updateProject(repository, actor, input);
		throw new Error(`Expected M3B update rejection: ${reasonCode}`);
	} catch (error) {
		assert(
			error instanceof ProjectServiceError &&
				error.code === "INVALID_PROJECT_WRITE_IDENTITY" &&
				error.metadata.reasonCode === reasonCode,
			`Expected typed M3B update rejection ${reasonCode}.`,
		);
	}
	assert(
		JSON.stringify(await rawProject(input.id)) ===
			JSON.stringify(beforeProject) &&
			JSON.stringify(await getProjectDetails(workspaceId, input.id)) ===
				JSON.stringify(beforeDetail),
		`Rejected ${reasonCode} update mutated Project or ContentBrief state.`,
	);
}

try {
	await db.insert(workspace).values({ id: workspaceId, name: "M3B workspace" });
	await db.insert(user).values({
		id: userId,
		name: "M3B user",
		email: `${userId}@example.test`,
		emailVerified: true,
	});
	await db.insert(product).values({
		id: productId,
		workspaceId,
		name: "M3B product",
		createdByUserId: userId,
	});

	const repository = createProjectRepository();

	const legacyCreate = createProjectInputSchema.parse(baseFields);
	const legacyProject = await createProject(repository, actor, legacyCreate);
	projectIds.push(legacyProject.id);
	const legacyRow = await rawProject(legacyProject.id);
	assert(
		legacyRow?.contentType === "AFFILIATE" &&
			legacyRow.creationPath === "SCRIPTED" &&
			legacyRow.contentFormatKey === "SCRIPTED_STANDARD" &&
			legacyRow.contentFormatVersion === 1,
		"Legacy create must persist the server-owned canonical identity.",
	);
	assert(
		legacyProject.isLegacyProjection === false,
		"A newly canonicalized Project must not be marked as a legacy projection.",
	);

	const canonicalCreate = createProjectInputSchema.parse({
		...baseFields,
		name: "M3B explicit canonical project",
		...canonicalIdentity,
	});
	const canonicalProject = await createProject(
		repository,
		actor,
		canonicalCreate,
	);
	projectIds.push(canonicalProject.id);
	const canonicalRow = await rawProject(canonicalProject.id);
	assert(
		canonicalRow?.contentType === "AFFILIATE" &&
			canonicalRow.creationPath === "SCRIPTED" &&
			canonicalRow.contentFormatKey === "SCRIPTED_STANDARD" &&
			canonicalRow.contentFormatVersion === 1,
		"Explicit canonical create must persist the exact identity.",
	);
	const canonicalDetail = await getProjectDetails(
		workspaceId,
		canonicalProject.id,
	);
	const canonicalListItem = (await listProjectItems(workspaceId)).find(
		(item) => item.id === canonicalProject.id,
	);
	assert(
		canonicalDetail?.isLegacyProjection === false &&
			canonicalListItem?.isLegacyProjection === false,
		"Persisted canonical detail and list must not report legacy provenance.",
	);

	const productless = createProjectInputSchema.safeParse({
		...baseFields,
		productId: undefined,
	});
	assert(!productless.success, "Product must remain required in M3B.");

	const organicCreate = createProjectInputSchema.parse({
		...baseFields,
		name: "M3B Organic scripted project",
		productId: null,
		contentType: "ORGANIC",
		creationPath: "SCRIPTED",
		contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
	});
	const organicProject = await createProject(repository, actor, organicCreate);
	projectIds.push(organicProject.id);
	const organicRow = await rawProject(organicProject.id);
	assert(
		organicRow?.contentType === "ORGANIC" &&
			organicRow.creationPath === "SCRIPTED" &&
			organicRow.contentFormatKey === "SCRIPTED_STANDARD" &&
			organicRow.contentFormatVersion === 1 &&
			organicRow.productId === null,
		"Organic Scripted create must persist the exact identity without Product.",
	);
	await expectRejected(
		createProjectInputSchema.parse({
			...baseFields,
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormat: { key: "UNKNOWN_FORMAT", version: 1 },
		}),
		"UNKNOWN_CONTENT_FORMAT_REF",
	);
	await expectRejected(
		createProjectInputSchema.parse({
			...baseFields,
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormat: { key: "SCRIPTED_STANDARD" },
		}),
		"PARTIAL_CONTENT_FORMAT_REF",
	);

	const preservedBefore = await rawProject(canonicalProject.id);
	const legacyUpdate = updateProjectInputSchema.parse({
		...baseFields,
		id: canonicalProject.id,
		name: "M3B preserved canonical identity",
	});
	await updateProject(repository, actor, legacyUpdate);
	const preservedAfter = await rawProject(canonicalProject.id);
	assert(
		JSON.stringify(preservedAfter) === JSON.stringify(preservedBefore),
		"Legacy update must preserve an existing canonical identity.",
	);

	const explicitUpdate = updateProjectInputSchema.parse({
		...baseFields,
		id: canonicalProject.id,
		...canonicalIdentity,
		name: "M3B explicit canonical update",
	});
	await updateProject(repository, actor, explicitUpdate);
	const explicitUpdated = await rawProject(canonicalProject.id);
	assert(
		explicitUpdated?.contentType === "AFFILIATE" &&
			explicitUpdated.creationPath === "SCRIPTED" &&
			explicitUpdated.contentFormatKey === "SCRIPTED_STANDARD" &&
			explicitUpdated.contentFormatVersion === 1,
		"Explicit canonical update must persist the exact identity.",
	);

	const beforeRejectedUpdate = await rawProject(canonicalProject.id);
	const beforeRejectedUpdateDetail = await getProjectDetails(
		workspaceId,
		canonicalProject.id,
	);
	const partialUpdate = updateProjectInputSchema.parse({
		...baseFields,
		id: canonicalProject.id,
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
	});
	try {
		await updateProject(repository, actor, partialUpdate);
		throw new Error("Expected partial M3B update to be rejected.");
	} catch (error) {
		assert(
			error instanceof ProjectServiceError &&
				error.code === "INVALID_PROJECT_WRITE_IDENTITY" &&
				error.metadata.reasonCode === "PARTIAL_CHANNEL_FIRST_IDENTITY",
			"Partial update must expose its typed identity reason.",
		);
	}
	assert(
		JSON.stringify(await rawProject(canonicalProject.id)) ===
			JSON.stringify(beforeRejectedUpdate) &&
			JSON.stringify(
				await getProjectDetails(workspaceId, canonicalProject.id),
			) === JSON.stringify(beforeRejectedUpdateDetail),
		"Rejected update must not mutate Project or ContentBrief.",
	);

	const organicUpdate = updateProjectInputSchema.parse({
		...baseFields,
		id: canonicalProject.id,
		productId: null,
		contentType: "ORGANIC",
		creationPath: "SCRIPTED",
		contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
	});
	await updateProject(repository, actor, organicUpdate);
	const organicUpdated = await rawProject(canonicalProject.id);
	assert(
		organicUpdated?.contentType === "ORGANIC" &&
			organicUpdated.productId === null,
		"Organic Scripted update must persist the exact identity and optional Product.",
	);

	const remainingLegacyId = randomUUID();
	await insertLegacyProject(remainingLegacyId, "M3B remaining legacy row");
	const remainingLegacyUpdate = updateProjectInputSchema.parse({
		...baseFields,
		id: remainingLegacyId,
		name: "M3B canonicalized legacy update",
	});
	await updateProject(repository, actor, remainingLegacyUpdate);
	const canonicalizedLegacy = await rawProject(remainingLegacyId);
	assert(
		canonicalizedLegacy?.contentType === "AFFILIATE" &&
			canonicalizedLegacy.creationPath === "SCRIPTED" &&
			canonicalizedLegacy.contentFormatKey === "SCRIPTED_STANDARD" &&
			canonicalizedLegacy.contentFormatVersion === 1,
		"Legacy update must deterministically canonicalize an all-null row.",
	);

	const invalidPersistedUnknownId = randomUUID();
	await insertProjectFixture(
		invalidPersistedUnknownId,
		"M3B invalid persisted unknown format",
		{
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "UNKNOWN_FORMAT",
			contentFormatVersion: 1,
		},
	);
	await expectUpdateRejected(
		repository,
		updateProjectInputSchema.parse({
			...baseFields,
			id: invalidPersistedUnknownId,
			...canonicalIdentity,
		}),
		"INVALID_CONTENT_FORMAT_REF",
	);

	const invalidPersistedMismatchId = randomUUID();
	await insertProjectFixture(
		invalidPersistedMismatchId,
		"M3B invalid persisted path mismatch",
		{
			contentType: "AFFILIATE",
			creationPath: "QUICK_IMAGE",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
		},
	);
	await expectUpdateRejected(
		repository,
		updateProjectInputSchema.parse({
			...baseFields,
			id: invalidPersistedMismatchId,
		}),
		"CONTENT_FORMAT_CREATION_PATH_MISMATCH",
	);

	const invalidPersistedPartialId = randomUUID();
	await insertProjectFixture(
		invalidPersistedPartialId,
		"M3B invalid persisted partial identity",
		{ contentType: "AFFILIATE" },
	);
	await expectUpdateRejected(
		repository,
		updateProjectInputSchema.parse({
			...baseFields,
			id: invalidPersistedPartialId,
		}),
		"PARTIAL_CHANNEL_FIRST_FIELDS",
	);

	const casProjectId = randomUUID();
	await insertLegacyProject(casProjectId, "M3B CAS fixture");
	const expectedCasIdentity = await repository.findProjectIdentity({
		workspaceId,
		projectId: casProjectId,
	});
	assert(expectedCasIdentity !== undefined, "CAS fixture identity must exist.");
	const beforeCasBrief = await db
		.select({
			goal: contentBrief.goal,
			angle: contentBrief.angle,
		})
		.from(contentBrief)
		.where(eq(contentBrief.projectId, casProjectId));
	await db
		.update(project)
		.set({
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "UNKNOWN_FORMAT",
			contentFormatVersion: 1,
		})
		.where(eq(project.id, casProjectId));
	const casInput = updateProjectInputSchema.parse({
		...baseFields,
		id: casProjectId,
	});
	try {
		await repository.updateProjectBundle({
			actor,
			input: casInput,
			identityUpdate: {
				strategy: "set",
				expectedIdentity: expectedCasIdentity,
				desiredIdentity: canonicalIdentity,
				requireExpectedProductLinkage: true,
			},
		});
		throw new Error("Expected stale Project identity CAS to fail.");
	} catch (error) {
		assert(
			error instanceof ProjectServiceError &&
				error.code === "INVALID_PROJECT_WRITE_IDENTITY" &&
				error.metadata.reasonCode === "PROJECT_IDENTITY_CHANGED_DURING_UPDATE",
			"Stale identity CAS must expose its typed concurrency reason.",
		);
	}
	const afterCasProject = await rawProject(casProjectId);
	const afterCasBrief = await db
		.select({
			goal: contentBrief.goal,
			angle: contentBrief.angle,
		})
		.from(contentBrief)
		.where(eq(contentBrief.projectId, casProjectId));
	assert(
		afterCasProject?.contentFormatKey === "UNKNOWN_FORMAT" &&
			afterCasProject.contentFormatVersion === 1 &&
			JSON.stringify(afterCasBrief) === JSON.stringify(beforeCasBrief),
		"Stale identity CAS must not overwrite identity or update ContentBrief.",
	);

	const projectedLegacyId = randomUUID();
	await insertLegacyProject(projectedLegacyId, "M3B projected legacy row");
	const beforeProjection = await rawProject(projectedLegacyId);
	const detail = await getProjectDetails(workspaceId, projectedLegacyId);
	const listItem = (await listProjectItems(workspaceId)).find(
		(item) => item.id === projectedLegacyId,
	);
	assert(
		detail !== undefined && listItem !== undefined,
		"Legacy read fixture must be visible.",
	);
	for (const [label, readModel] of [
		["detail", detail],
		["list", listItem],
	] as const) {
		assert(
			readModel.contentType === "AFFILIATE",
			`${label} must project ContentType.`,
		);
		assert(
			readModel.creationPath === "SCRIPTED",
			`${label} must project CreationPath.`,
		);
		assert(
			readModel.contentFormat?.resolution === "resolved" &&
				readModel.contentFormat.ref.key === "SCRIPTED_STANDARD" &&
				readModel.contentFormat.ref.version === 1,
			`${label} must project the resolved legacy format.`,
		);
		assert(readModel.isLegacyProjection, `${label} must mark provenance.`);
	}
	assert(
		JSON.stringify(await rawProject(projectedLegacyId)) ===
			JSON.stringify(beforeProjection),
		"Read compatibility projection must not mutate the database.",
	);

	const unknownId = randomUUID();
	await db.insert(project).values({
		id: unknownId,
		workspaceId,
		name: "M3B unsupported read row",
		productId,
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
		contentFormatKey: "UNKNOWN_FORMAT",
		contentFormatVersion: 1,
		currentStepKey: "product",
		createdByUserId: userId,
	});
	await db.insert(contentBrief).values({
		id: randomUUID(),
		projectId: unknownId,
		platform: "tiktok",
		goal: "M3B unsupported read fixture",
		durationSeconds: 30,
		angle: "M3B unsupported read fixture",
	});
	projectIds.push(unknownId);
	const unknownRead = await getProjectDetails(workspaceId, unknownId);
	assert(
		unknownRead?.contentFormat?.resolution === "unsupported" &&
			!unknownRead.isLegacyProjection,
		"Unknown complete format must remain unsupported, not legacy-projected.",
	);

	console.log("AFF-US-016 M3B create/update/read integration checks passed.");
} finally {
	for (const projectId of projectIds) {
		await db
			.delete(projectStepStatus)
			.where(eq(projectStepStatus.projectId, projectId));
		await db.delete(contentBrief).where(eq(contentBrief.projectId, projectId));
		await db.delete(project).where(eq(project.id, projectId));
	}
	await db
		.delete(product)
		.where(
			and(eq(product.id, productId), eq(product.workspaceId, workspaceId)),
		);
	await db.delete(user).where(eq(user.id, userId));
	await db.delete(workspace).where(eq(workspace.id, workspaceId));
}
