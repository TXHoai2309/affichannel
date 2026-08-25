import { randomUUID } from "node:crypto";
import { requireM5TestDatabaseAuthority } from "./m5-test-database-authority.ts";

const authority = requireM5TestDatabaseAuthority();
process.env.NODE_ENV = "test";
process.env.SKIP_ENV_VALIDATION = "1";
process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = authority.url;
process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM = "DISPOSABLE_DB_CONFIRMED";
process.env.AFFICHANNEL_LIVE_AI_SMOKE = "0";
process.env.AFFICHANNEL_LIVE_TTS_SMOKE = "0";

const { db, product, project, user, workspace } = await import(
	"@affichannel/db"
);
const { eq } = await import("drizzle-orm");
const { createProject, ProjectServiceError, updateProject } = await import(
	"@affichannel/core/project/project-service"
);
const { createProjectInputSchema, updateProjectInputSchema } = await import(
	"@affichannel/core/project/project-validation"
);
const { createProjectRepository } = await import(
	"../packages/api/src/services/project-repository.ts"
);

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

const suffix = randomUUID();
const workspaceId = `m5a-workspace-${suffix}`;
const userId = `m5a-user-${suffix}`;
const productId = randomUUID();
const actor = { workspaceId, userId };
const canonicalIdentity = {
	contentType: "AFFILIATE" as const,
	creationPath: "SCRIPTED" as const,
	contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
};
const base = {
	name: "M5A compatibility",
	productId,
	platform: "tiktok" as const,
	goal: "M5A compatibility",
	durationSeconds: 30,
	angle: "M5A compatibility",
};

async function identity(id: string) {
	const [row] = await db
		.select({
			productId: project.productId,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
		})
		.from(project)
		.where(eq(project.id, id));
	return row;
}

async function rejectIdentity(
	input: Record<string, unknown>,
	reasonCode: string,
) {
	try {
		await createProject(
			createProjectRepository(),
			actor,
			createProjectInputSchema.parse({ ...base, ...input }),
		);
		throw new Error(`Expected rejection ${reasonCode}.`);
	} catch (error) {
		assert(
			error instanceof ProjectServiceError &&
				error.code === "INVALID_PROJECT_WRITE_IDENTITY" &&
				error.metadata.reasonCode === reasonCode,
			`Expected INVALID_PROJECT_WRITE_IDENTITY/${reasonCode}.`,
		);
	}
}

try {
	await db.insert(workspace).values({ id: workspaceId, name: "M5A workspace" });
	await db.insert(user).values({
		id: userId,
		name: "M5A user",
		email: `${userId}@example.test`,
		emailVerified: true,
	});
	await db.insert(product).values({
		id: productId,
		workspaceId,
		name: "M5A product",
		createdByUserId: userId,
	});
	const repository = createProjectRepository();

	const legacy = await createProject(
		repository,
		actor,
		createProjectInputSchema.parse(base),
	);
	assert(
		JSON.stringify(await identity(legacy.id)) ===
			JSON.stringify({
				productId,
				contentType: "AFFILIATE",
				creationPath: "SCRIPTED",
				contentFormatKey: "SCRIPTED_STANDARD",
				contentFormatVersion: 1,
			}),
		"Legacy request must persist a complete canonical identity on M5 schema.",
	);

	const canonical = await createProject(
		repository,
		actor,
		createProjectInputSchema.parse({
			...base,
			name: "Canonical",
			...canonicalIdentity,
		}),
	);
	await updateProject(
		repository,
		actor,
		updateProjectInputSchema.parse({
			...base,
			id: canonical.id,
			name: "Preserved",
		}),
	);
	assert(
		(await identity(canonical.id))?.contentFormatKey === "SCRIPTED_STANDARD",
		"Identity-omitting update must preserve canonical identity.",
	);
	await updateProject(
		repository,
		actor,
		updateProjectInputSchema.parse({
			...base,
			id: canonical.id,
			name: "Explicit canonical",
			...canonicalIdentity,
		}),
	);

	await rejectIdentity(
		{ contentType: "AFFILIATE" },
		"PARTIAL_CHANNEL_FIRST_IDENTITY",
	);
	await rejectIdentity(
		{
			contentType: "INVALID",
			creationPath: "SCRIPTED",
			contentFormat: canonicalIdentity.contentFormat,
		},
		"INVALID_CONTENT_TYPE",
	);
	await rejectIdentity(
		{
			...canonicalIdentity,
			contentFormat: { key: "SCRIPTED_STANDARD", version: 0 },
		},
		"INVALID_CONTENT_FORMAT_VERSION",
	);
	await rejectIdentity(
		{ ...canonicalIdentity, contentFormat: { key: "UNKNOWN", version: 1 } },
		"UNKNOWN_CONTENT_FORMAT_REF",
	);
	await rejectIdentity(
		{ ...canonicalIdentity, creationPath: "QUICK_IMAGE" },
		"CONTENT_FORMAT_PATH_MISMATCH",
	);
	await rejectIdentity(
		{
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			contentFormat: canonicalIdentity.contentFormat,
		},
		"CHANNEL_FIRST_IDENTITY_NOT_ACTIVE",
	);
	await rejectIdentity(
		{
			contentType: "AFFILIATE",
			creationPath: "QUICK_IMAGE",
			contentFormat: { key: "QUICK_IMAGE_STANDARD", version: 1 },
		},
		"CHANNEL_FIRST_IDENTITY_NOT_ACTIVE",
	);
	await rejectIdentity(
		{
			contentType: "AFFILIATE",
			creationPath: "MEDIA_FIRST",
			contentFormat: { key: "MEDIA_FIRST_STANDARD", version: 1 },
		},
		"CHANNEL_FIRST_IDENTITY_NOT_ACTIVE",
	);

	const expected = await repository.findProjectIdentity({
		workspaceId,
		projectId: canonical.id,
	});
	assert(expected, "CAS expected identity missing.");
	await db
		.update(project)
		.set({ contentFormatKey: "CONCURRENT_FORMAT" })
		.where(eq(project.id, canonical.id));
	try {
		await repository.updateProjectBundle({
			actor,
			input: updateProjectInputSchema.parse({ ...base, id: canonical.id }),
			identityUpdate: {
				strategy: "set",
				expectedIdentity: expected,
				desiredIdentity: canonicalIdentity,
				requireExpectedProductLinkage: false,
			},
		});
		throw new Error("Expected identity CAS rejection.");
	} catch (error) {
		assert(
			error instanceof ProjectServiceError &&
				error.metadata.reasonCode === "PROJECT_IDENTITY_CHANGED_DURING_UPDATE",
			"M5 schema must retain typed identity CAS behavior.",
		);
	}

	console.log("M5 post-schema application compatibility: PASS");
} finally {
	await db.delete(project).where(eq(project.workspaceId, workspaceId));
	await db.delete(product).where(eq(product.workspaceId, workspaceId));
	await db.delete(user).where(eq(user.id, userId));
	await db.delete(workspace).where(eq(workspace.id, workspaceId));
}
