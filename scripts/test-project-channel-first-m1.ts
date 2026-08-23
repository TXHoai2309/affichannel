import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.AFFICHANNEL_M1_TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl) {
	console.error(
		"NOT RUN: set AFFICHANNEL_M1_TEST_DATABASE_URL to an approved disposable/test database.",
	);
	process.exit(1);
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.DATABASE_URL_DIRECT = testDatabaseUrl;
process.env.NODE_ENV = "test";

const { contentBrief, db, product, project, user, workspace } = await import(
	"@affichannel/db"
);
const { and, eq, sql } = await import("drizzle-orm");
const { getProjectDetails } = await import(
	"../packages/api/src/services/project-repository.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function rowsOf<T>(result: unknown): T[] {
	if (Array.isArray(result)) return result as T[];
	if (result && typeof result === "object" && "rows" in result) {
		const rows = (result as { rows?: unknown }).rows;
		return Array.isArray(rows) ? (rows as T[]) : [];
	}
	return [];
}

async function expectRejected(action: () => Promise<unknown>, message: string) {
	try {
		await action();
	} catch {
		return;
	}
	throw new Error(message);
}

const workspaceId = `us013-m1-workspace-${randomUUID()}`;
const userId = `us013-m1-user-${randomUUID()}`;
const productId = `us013-m1-product-${randomUUID()}`;
const projectIds: string[] = [];

async function insertProject(input: {
	id: string;
	productId: string | null;
	contentType?: string | null;
	creationPath?: string | null;
	contentFormatKey?: string | null;
	contentFormatVersion?: number | null;
}) {
	await db.insert(project).values({
		id: input.id,
		workspaceId,
		name: `US013 M1 ${input.id}`,
		productId: input.productId,
		contentType: input.contentType,
		creationPath: input.creationPath,
		contentFormatKey: input.contentFormatKey,
		contentFormatVersion: input.contentFormatVersion,
		currentStepKey: "product",
		createdByUserId: userId,
	});
	projectIds.push(input.id);
}

async function insertBrief(projectId: string) {
	await db.insert(contentBrief).values({
		id: randomUUID(),
		projectId,
		platform: "tiktok",
		goal: "M1 reader compatibility",
		durationSeconds: 30,
		angle: "Legacy Affiliate read",
	});
}

try {
	const constraintRows = rowsOf<{
		conname: string;
		definition: string;
		confdeltype: string | null;
		confupdtype: string | null;
	}>(
		await db.execute(sql`
			select
				con.conname,
				pg_get_constraintdef(con.oid) as definition,
				con.confdeltype,
				con.confupdtype
			from pg_constraint con
			join pg_class rel on rel.oid = con.conrelid
			join pg_namespace ns on ns.oid = rel.relnamespace
			where ns.nspname = 'public' and rel.relname = 'project'
				and con.conname in (
					'project_product_id_product_id_fk',
					'project_content_type_check',
					'project_creation_path_check',
					'project_content_format_pair_check'
				)
		`),
	);
	const constraintNames = new Set(constraintRows.map((row) => row.conname));
	for (const name of [
		"project_product_id_product_id_fk",
		"project_content_type_check",
		"project_creation_path_check",
		"project_content_format_pair_check",
	]) {
		assert(constraintNames.has(name), `Missing Project constraint: ${name}`);
	}

	const fk = constraintRows.find(
		(row) => row.conname === "project_product_id_product_id_fk",
	);
	assert(fk?.confdeltype === "r", "Product FK must RESTRICT deletes.");
	assert(fk?.confupdtype === "a", "Product FK must keep NO ACTION updates.");

	const indexRows = rowsOf<{ indexname: string }>(
		await db.execute(sql`
			select indexname
			from pg_indexes
			where schemaname = 'public'
				and tablename = 'project'
				and indexname = 'project_product_id_idx'
		`),
	);
	assert(
		indexRows.some((row) => row.indexname === "project_product_id_idx"),
		"Product index is missing.",
	);

	await db
		.insert(workspace)
		.values({ id: workspaceId, name: "US013 M1 workspace" });
	await db.insert(user).values({
		id: userId,
		name: "US013 M1 user",
		email: `${userId}@example.test`,
		emailVerified: true,
	});
	await db.insert(product).values({
		id: productId,
		workspaceId,
		name: "US013 M1 product",
		createdByUserId: userId,
	});

	const legacyId = `us013-m1-legacy-${randomUUID()}`;
	await insertProject({ id: legacyId, productId });
	await insertBrief(legacyId);
	const before = await db
		.select({
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
		})
		.from(project)
		.where(eq(project.id, legacyId));
	const readModel = await getProjectDetails(workspaceId, legacyId);
	assert(readModel !== undefined, "Legacy all-null Project must be readable.");
	assert(
		readModel.contentType === null,
		"Legacy ContentType must remain null in M1.",
	);
	assert(
		readModel.creationPath === null,
		"Legacy CreationPath must remain null in M1.",
	);
	assert(
		readModel.contentFormat === null,
		"M1 must not project an effective legacy format.",
	);
	const after = await db
		.select({
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
		})
		.from(project)
		.where(eq(project.id, legacyId));
	assert(
		JSON.stringify(before) === JSON.stringify(after),
		"Legacy read must not mutate the Project.",
	);

	const productlessId = `us013-m1-productless-${randomUUID()}`;
	await insertProject({ id: productlessId, productId: null });

	const unknownId = `us013-m1-unknown-${randomUUID()}`;
	await insertProject({
		id: unknownId,
		productId,
		contentFormatKey: "UNKNOWN_FORMAT",
		contentFormatVersion: 1,
	});
	await insertBrief(unknownId);
	const unknownRead = await getProjectDetails(workspaceId, unknownId);
	assert(
		unknownRead?.contentFormat?.resolution === "unsupported",
		"Unknown format must be unsupported.",
	);
	assert(
		unknownRead.contentFormat.reasonCode === "UNKNOWN_CONTENT_FORMAT_REF",
		"Unknown format must keep an explicit reason code.",
	);

	const partialId = `us013-m1-partial-${randomUUID()}`;
	await expectRejected(
		() =>
			db.insert(project).values({
				id: partialId,
				workspaceId,
				name: "M1 partial",
				productId: null,
				contentFormatKey: "SCRIPTED_STANDARD",
				currentStepKey: "product",
				createdByUserId: userId,
			}),
		"Partial ContentFormat pair must be rejected.",
	);

	const invalidVersionId = `us013-m1-invalid-version-${randomUUID()}`;
	await expectRejected(
		() =>
			db.insert(project).values({
				id: invalidVersionId,
				workspaceId,
				name: "M1 invalid version",
				productId: null,
				contentFormatKey: "SCRIPTED_STANDARD",
				contentFormatVersion: 0,
				currentStepKey: "product",
				createdByUserId: userId,
			}),
		"Non-positive ContentFormat version must be rejected.",
	);

	const invalidTypeId = `us013-m1-invalid-type-${randomUUID()}`;
	await expectRejected(
		() =>
			db.insert(project).values({
				id: invalidTypeId,
				workspaceId,
				name: "M1 invalid type",
				productId: null,
				contentType: "HYBRID",
				currentStepKey: "product",
				createdByUserId: userId,
			}),
		"Invalid ContentType must be rejected.",
	);

	const invalidPathId = `us013-m1-invalid-path-${randomUUID()}`;
	await expectRejected(
		() =>
			db.insert(project).values({
				id: invalidPathId,
				workspaceId,
				name: "M1 invalid path",
				productId: null,
				creationPath: "ORGANIC_SCRIPTED",
				currentStepKey: "product",
				createdByUserId: userId,
			}),
		"Invalid CreationPath must be rejected.",
	);

	const invalidFkId = `us013-m1-invalid-fk-${randomUUID()}`;
	await expectRejected(
		() =>
			db.insert(project).values({
				id: invalidFkId,
				workspaceId,
				name: "M1 invalid FK",
				productId: `missing-product-${randomUUID()}`,
				currentStepKey: "product",
				createdByUserId: userId,
			}),
		"Unknown Product FK must be rejected.",
	);

	const restrictId = `us013-m1-restrict-${randomUUID()}`;
	await insertProject({ id: restrictId, productId });
	await expectRejected(
		() => db.delete(product).where(eq(product.id, productId)),
		"Product delete must be restricted while Project references it.",
	);

	console.log("AFF-US-013 M1 database and reader compatibility checks passed.");
} finally {
	for (const projectId of projectIds) {
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
