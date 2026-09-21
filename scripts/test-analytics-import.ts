import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const authorityUrl = process.env.AFFICHANNEL_US27_TEST_DATABASE_URL?.trim();
if (
	!authorityUrl ||
	process.env.AFFICHANNEL_US27_TEST_DATABASE_CONFIRM !==
		"DISPOSABLE_US27_DB_CONFIRMED"
) {
	throw new Error(
		"REFUSED: US27 requires an explicit disposable loopback PostgreSQL authority.",
	);
}
const authority = new URL(authorityUrl);
if (authority.hostname !== "127.0.0.1") {
	throw new Error("REFUSED: US27 database must be loopback-only.");
}
process.env.NODE_ENV = "test";
process.env.SKIP_ENV_VALIDATION = "1";
process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = authorityUrl;
process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM = "DISPOSABLE_DB_CONFIRMED";
delete process.env.DATABASE_URL;
delete process.env.DATABASE_URL_DIRECT;

const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { drizzle } = await import("drizzle-orm/node-postgres");
const { eq } = await import("drizzle-orm");
const { createNodePostgresPool } = await import(
	"../packages/db/src/node-postgres-test-adapter.ts"
);
const {
	db,
	analyticsImportBatch,
	analyticsMetricSnapshot,
	product,
	project,
	user,
	workspace,
} = await import("../packages/db/src/index.ts");
const {
	previewAnalyticsImport,
	finalizeAnalyticsImport,
	getAnalyticsReadModel,
	AnalyticsImportError,
} = await import("../packages/api/src/services/analytics-service.ts");

const pool = createNodePostgresPool(authorityUrl);
const migrationsFolder = resolve("packages/db/src/migrations");

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function encoded(value: string) {
	return Buffer.from(value, "utf8").toString("base64");
}

function mappingForPreview(preview: { mapping: unknown }) {
	return preview.mapping as Parameters<
		typeof previewAnalyticsImport
	>[1]["mapping"];
}

async function expectCode(code: string, action: () => Promise<unknown>) {
	try {
		await action();
	} catch (error) {
		assert(
			error instanceof AnalyticsImportError,
			`${code}: expected AnalyticsImportError`,
		);
		assert(error.code === code, `${code}: received ${error.code}`);
		return;
	}
	throw new Error(`${code}: expected rejection`);
}

try {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
	await migrate(drizzle(pool), { migrationsFolder });

	const workspaceId = `us27-workspace-${randomUUID()}`;
	const userId = `us27-user-${randomUUID()}`;
	const organicProjectId = `us27-organic-${randomUUID()}`;
	const affiliateProjectId = `us27-affiliate-${randomUUID()}`;
	const productId = `us27-product-${randomUUID()}`;
	await db.insert(user).values({
		id: userId,
		name: "US27 Test",
		email: `${userId}@example.test`,
		emailVerified: true,
	});
	await db.insert(workspace).values({
		id: workspaceId,
		name: "US27 disposable",
		timezone: "Asia/Ho_Chi_Minh",
	});
	await db.insert(product).values({
		id: productId,
		workspaceId,
		name: "Canonical Product",
		createdByUserId: userId,
	});
	await db.insert(project).values([
		{
			id: organicProjectId,
			workspaceId,
			name: "Organic Project",
			productId: null,
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
			currentStepKey: "content",
			createdByUserId: userId,
		},
		{
			id: affiliateProjectId,
			workspaceId,
			name: "Affiliate Project",
			productId,
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
			currentStepKey: "content",
			createdByUserId: userId,
		},
	]);
	const actor = { workspaceId, userId };
	const csv = [
		"recorded_date,metric_family,metric_key,value,content_type,project_id,product_id,source",
		`2026-09-20T16:30:00Z,CHANNEL_GROWTH,views,100,ORGANIC,${organicProjectId},,Organic export`,
		`2026-09-20T17:30:00Z,AFFILIATE_MONETIZATION,commission,250,AFFILIATE,${affiliateProjectId},${productId},Affiliate export`,
	].join("\n");
	const baseInput = {
		fileName: "mixed.csv",
		fileBase64: encoded(csv),
		sourceType: "MANUAL_CSV" as const,
	};
	const preview = await previewAnalyticsImport(actor, baseInput);
	assert(
		preview.acceptedRows === 2 && preview.rejectedRows === 0,
		"CSV preview must accept both mixed-family rows.",
	);
	assert(
		preview.recordedRange?.startDate === "2026-09-20" &&
			preview.recordedRange.endDate === "2026-09-21",
		"Workspace timezone boundary must normalize the recorded range.",
	);
	const mapping = mappingForPreview(preview);
	const finalized = await finalizeAnalyticsImport(actor, {
		...baseInput,
		mapping,
		previewFileSha256: preview.fileSha256,
		previewMappingFingerprint: preview.mappingFingerprint,
		idempotencyKey: `us27-finalize-${randomUUID()}`,
	});
	assert(
		!finalized.replayed && finalized.batch.acceptedCount === 2,
		"First finalize must create one immutable batch.",
	);
	const replayed = await finalizeAnalyticsImport(actor, {
		...baseInput,
		mapping,
		previewFileSha256: preview.fileSha256,
		previewMappingFingerprint: preview.mappingFingerprint,
		idempotencyKey: `us27-finalize-replay-${randomUUID()}`,
	});
	assert(
		replayed.replayed,
		"Same semantic snapshot must replay without a second batch.",
	);
	const snapshotRows = await db
		.select()
		.from(analyticsMetricSnapshot)
		.where(eq(analyticsMetricSnapshot.workspaceId, workspaceId));
	assert(
		snapshotRows.length === 2,
		"Duplicate finalize must not duplicate metric snapshots.",
	);
	assert(
		snapshotRows.some(
			(row) =>
				row.productId === productId && row.attributionScope === "CONTENT",
		),
		"Product/content attribution must use canonical IDs.",
	);

	const readModel = await getAnalyticsReadModel(actor, {
		startDate: "2026-09-20",
		endDate: "2026-09-21",
	});
	assert(
		readModel.channelGrowth.aggregates.some(
			(row) => row.metricKey === "views" && row.total === 100,
		),
		"Channel Growth aggregate must remain separate.",
	);
	assert(
		readModel.affiliateMonetization.aggregates.some(
			(row) => row.metricKey === "commission" && row.total === 250,
		),
		"Affiliate aggregate must remain separate.",
	);

	const reorderedCsv = [
		csv.split("\n")[0],
		csv.split("\n")[2],
		csv.split("\n")[1],
	].join("\n");
	const reorderedPreview = await previewAnalyticsImport(actor, {
		...baseInput,
		fileBase64: encoded(reorderedCsv),
	});
	const reordered = await finalizeAnalyticsImport(actor, {
		...baseInput,
		fileBase64: encoded(reorderedCsv),
		mapping: mappingForPreview(reorderedPreview),
		previewFileSha256: reorderedPreview.fileSha256,
		previewMappingFingerprint: reorderedPreview.mappingFingerprint,
		idempotencyKey: `us27-reordered-${randomUUID()}`,
	});
	assert(
		reordered.replayed,
		"Semantically identical rows in a different order must replay.",
	);

	const invalidCsv = [
		csv.split("\n")[0],
		"2026-09-22,CHANNEL_GROWTH,views,3,ORGANIC,,,Organic export",
	].join("\n");
	const invalidPreview = await previewAnalyticsImport(actor, {
		...baseInput,
		fileName: "invalid.csv",
		fileBase64: encoded(invalidCsv),
	});
	assert(
		invalidPreview.rejectedRows === 0,
		"Valid single-day row should preview cleanly.",
	);
	const invalidDateCsv = [
		csv.split("\n")[0],
		"2026-09-23,CHANNEL_GROWTH,views,3,ORGANIC,,,Organic export",
	].join("\n");
	const invalidDatePreview = await previewAnalyticsImport(actor, {
		...baseInput,
		fileName: "invalid-date.csv",
		fileBase64: encoded(invalidDateCsv),
	});
	await expectCode("ANALYTICS_PREVIEW_STALE", () =>
		finalizeAnalyticsImport(actor, {
			...baseInput,
			fileName: "invalid-date.csv",
			fileBase64: encoded(invalidDateCsv),
			mapping: mappingForPreview(invalidDatePreview),
			previewFileSha256: preview.fileSha256,
			previewMappingFingerprint: invalidDatePreview.mappingFingerprint,
			idempotencyKey: `us27-stale-${randomUUID()}`,
		}),
	);

	const xlsx = await import("../packages/api/node_modules/xlsx/xlsx.mjs");
	const workbook = xlsx.utils.book_new();
	const sheet = xlsx.utils.aoa_to_sheet([
		["recorded_date", "metric_family", "metric_key", "value"],
		["2026-09-24", "CHANNEL_GROWTH", "views", 7],
	]);
	xlsx.utils.book_append_sheet(workbook, sheet, "Analytics");
	const workbookBytes = xlsx.write(workbook, {
		type: "buffer",
		bookType: "xlsx",
	});
	const xlsxPreview = await previewAnalyticsImport(actor, {
		fileName: "growth.xlsx",
		fileBase64: Buffer.from(workbookBytes).toString("base64"),
		sourceType: "MANUAL_XLSX",
	});
	assert(
		xlsxPreview.acceptedRows === 1 && xlsxPreview.rejectedRows === 0,
		"XLSX preview must use the same canonical mapping semantics.",
	);

	const otherWorkspace = `us27-other-${randomUUID()}`;
	const otherUser = `us27-other-user-${randomUUID()}`;
	await db.insert(user).values({
		id: otherUser,
		name: "Other",
		email: `${otherUser}@example.test`,
		emailVerified: true,
	});
	await db
		.insert(workspace)
		.values({ id: otherWorkspace, name: "Other workspace", timezone: "UTC" });
	const isolatedPreview = await previewAnalyticsImport(
		{ workspaceId: otherWorkspace, userId: otherUser },
		baseInput,
	);
	assert(
		isolatedPreview.acceptedRows === 0 &&
			isolatedPreview.rejectedRows === 2 &&
			isolatedPreview.rejectionReasons.CONTENT_ATTRIBUTION_UNMAPPED === 2,
		"Cross-workspace content attribution must fail closed without importing rows.",
	);

	const batchCount = await db
		.select()
		.from(analyticsImportBatch)
		.where(eq(analyticsImportBatch.workspaceId, workspaceId));
	assert(
		batchCount.length === 1,
		"Same semantic source must produce one immutable import batch.",
	);
	console.log(
		"US27 CSV mixed-family, XLSX, mapping, timezone, attribution, read-model, semantic dedupe and workspace isolation: PASS",
	);
} finally {
	await pool.end();
}
