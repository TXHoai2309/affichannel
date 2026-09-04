import { randomUUID } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const URL_ENV = "AFFICHANNEL_MEDIA_TEST_DATABASE_URL";
const CONFIRM_ENV = "AFFICHANNEL_MEDIA_TEST_DATABASE_CONFIRM";
const CONFIRM_VALUE = "DISPOSABLE_MEDIA_TEST_DB_CONFIRMED";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function requireAuthority() {
	const url = process.env[URL_ENV]?.trim();
	if (!url)
		throw new Error(
			`REFUSED: ${URL_ENV} is required; no database fallback is allowed.`,
		);
	if (process.env[CONFIRM_ENV] !== CONFIRM_VALUE) {
		throw new Error(`REFUSED: ${CONFIRM_ENV} must equal ${CONFIRM_VALUE}.`);
	}
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`REFUSED: ${URL_ENV} is not a valid URL.`);
	}
	if (
		!(
			["postgres:", "postgresql:"].includes(parsed.protocol) &&
			LOOPBACK_HOSTS.has(parsed.hostname) &&
			parsed.pathname.length > 1
		)
	) {
		throw new Error(
			`REFUSED: ${URL_ENV} must identify an explicit loopback PostgreSQL database.`,
		);
	}
	return {
		url,
		host: parsed.host,
		database: decodeURIComponent(parsed.pathname.slice(1)),
	};
}

const authority = requireAuthority();
process.env.NODE_ENV = "test";
process.env.SKIP_ENV_VALIDATION = "1";
process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = authority.url;
process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM = "DISPOSABLE_DB_CONFIRMED";
for (const key of [
	"DATABASE_URL",
	"DATABASE_URL_DIRECT",
	"AFF_US008_DATABASE_URL",
	"R2_ENDPOINT",
	"R2_BUCKET",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
]) {
	delete process.env[key];
}

const { createNodePostgresPool } = await import(
	"../packages/db/src/node-postgres-test-adapter.ts"
);
const { drizzle } = await import("drizzle-orm/node-postgres");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { db, mediaAsset, mediaAssetLink, project, user, workspace } =
	await import("../packages/db/src/index.ts");
const { eq } = await import("drizzle-orm");
const repository = await import(
	"../packages/api/src/services/media-asset-repository.ts"
);

type Journal = { entries: Array<{ idx: number; tag: string }> };
const migrationsRoot = resolve("packages/db/src/migrations");
const temporaryFolders: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function resetDatabase(pool: ReturnType<typeof createNodePostgresPool>) {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
}

async function migrationFolderThrough(lastIndex: number) {
	const journal = JSON.parse(
		await readFile(join(migrationsRoot, "meta", "_journal.json"), "utf8"),
	) as Journal;
	const entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
	assert(
		entries.length === lastIndex + 1,
		`Expected migrations through index ${lastIndex}.`,
	);
	const folder = await mkdtemp(join(tmpdir(), "affichannel-media-migrations-"));
	temporaryFolders.push(folder);
	await mkdir(join(folder, "meta"), { recursive: true });
	await writeFile(
		join(folder, "meta", "_journal.json"),
		JSON.stringify({ ...journal, entries }, null, 2),
		"utf8",
	);
	for (const entry of entries)
		await copyFile(
			join(migrationsRoot, `${entry.tag}.sql`),
			join(folder, `${entry.tag}.sql`),
		);
	return folder;
}

async function publicTables(pool: ReturnType<typeof createNodePostgresPool>) {
	const result = await pool.query<{ tableName: string }>(
		"select table_name as \"tableName\" from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
	);
	return result.rows.map((row) => row.tableName);
}

async function seedWorkspace(id: string, userId: string, projectIds: string[]) {
	await db.insert(workspace).values({ id, name: `Media test ${id}` });
	await db.insert(user).values({
		id: userId,
		name: `Media test ${id}`,
		email: `${userId}@example.test`,
		emailVerified: true,
	});
	for (const [index, projectId] of projectIds.entries()) {
		await db.insert(project).values({
			id: projectId,
			workspaceId: id,
			name: `Media project ${index}`,
			productId: null,
			contentType: index % 2 === 0 ? "ORGANIC" : "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "script.v1",
			contentFormatVersion: 1,
			currentStepKey: "content",
			createdByUserId: userId,
		});
	}
}

const pool = createNodePostgresPool(authority.url);
try {
	const identity = await pool.query<{ database: string; schema: string }>(
		"select current_database() as database, current_schema() as schema",
	);
	console.log(
		`Disposable identity: database=${identity.rows[0]?.database}; host=${authority.host}; schema=${identity.rows[0]?.schema}`,
	);
	const through21 = await migrationFolderThrough(21);
	await resetDatabase(pool);
	await migrate(drizzle(pool), { migrationsFolder: through21 });
	const before = await publicTables(pool);
	const legacyWorkspace = `media-legacy-ws-${randomUUID()}`;
	const legacyUser = `media-legacy-user-${randomUUID()}`;
	const legacyProject = `media-legacy-project-${randomUUID()}`;
	const legacyMetadata = `media-legacy-metadata-${randomUUID()}`;
	await pool.query("insert into workspace (id, name) values ($1, $2)", [
		legacyWorkspace,
		"Legacy media fixture",
	]);
	await pool.query(
		'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
		[legacyUser, "Legacy media fixture", `${legacyUser}@example.test`],
	);
	await pool.query(
		`insert into project (id, workspace_id, name, product_id, content_type,
			creation_path, content_format_key, content_format_version, current_step_key,
			created_by_user_id) values ($1, $2, $3, null, 'ORGANIC', 'SCRIPTED',
			'script.v1', 1, 'content', $4)`,
		[legacyProject, legacyWorkspace, "Legacy media project", legacyUser],
	);
	await pool.query(
		`insert into media_metadata (id, workspace_id, project_id, media_type,
			aspect_ratio, duration_seconds, usage_rights, status, scene_suitability,
			tags, display_name, reference_url, created_by_user_id)
			values ($1, $2, $3, 'image', '9:16', null, 'owned', 'ready',
			'background', ARRAY['legacy'], 'Legacy image', null, $4)`,
		[legacyMetadata, legacyWorkspace, legacyProject, legacyUser],
	);
	await migrate(drizzle(pool), { migrationsFolder: migrationsRoot });
	const after = await publicTables(pool);
	const added = after.filter((table) => !before.includes(table));
	assert(
		JSON.stringify(added.sort()) ===
			JSON.stringify(["media_asset", "media_asset_link"]),
		`Migration 0022 must add only media tables; got ${added.join(", ")}.`,
	);
	const bytea = await pool.query<{ count: number }>(
		"select count(*)::int as count from information_schema.columns where table_schema = 'public' and table_name in ('media_asset','media_asset_link') and data_type = 'bytea'",
	);
	assert(
		(bytea.rows[0]?.count ?? 0) === 0,
		"MediaAsset tables must not persist binary bytes.",
	);
	const legacy = await pool.query<{ id: string }>(
		"select id from media_metadata where id = $1",
		[legacyMetadata],
	);
	assert(
		legacy.rows[0]?.id === legacyMetadata,
		"Legacy media_metadata rows must survive the additive migration.",
	);
	console.log(
		"Migration 0021 -> 0022 additive schema, legacy-row survival, and no-binary-column check: PASS",
	);

	const workspaceA = `media-ws-a-${randomUUID()}`;
	const workspaceB = `media-ws-b-${randomUUID()}`;
	const userA = `media-user-a-${randomUUID()}`;
	const userB = `media-user-b-${randomUUID()}`;
	const organicProject = `media-organic-${randomUUID()}`;
	const affiliateProject = `media-affiliate-${randomUUID()}`;
	const otherProject = `media-other-${randomUUID()}`;
	await seedWorkspace(workspaceA, userA, [organicProject, affiliateProject]);
	await seedWorkspace(workspaceB, userB, [otherProject]);
	const actorA = { workspaceId: workspaceA, userId: userA };
	const actorB = { workspaceId: workspaceB, userId: userB };
	const assetId = `media-asset-${randomUUID()}`;
	const storageKey = `media/v1/${workspaceA}/${assetId}/payload.png`;
	const pending = await repository.createPendingMediaAsset(actorA, {
		id: assetId,
		mediaType: "image",
		origin: "user_upload",
		storageProvider: "local",
		storageKey,
		uploadSessionId: `upload-${randomUUID()}`,
		prepareIdempotencyKey: `prepare-${randomUUID()}`,
		uploadExpiresAt: new Date(Date.now() + 60_000),
		originalFilename: "../hero.png",
		displayName: " Hero ",
		declaredMimeType: "image/png",
		tags: ["Campaign"],
	});
	assert(
		pending?.status === "pending_upload" &&
			pending.originalFilename === ".._hero.png" &&
			pending.workspaceId === workspaceA,
		"Pending media asset must be workspace-owned and sanitized.",
	);
	assert(
		(await repository.findMediaAssetByIdForWorkspace(actorB, assetId)) ===
			undefined,
		"Cross-workspace asset lookup must be hidden.",
	);
	assert(
		(await repository.markMediaAssetValidating(actorA, { assetId }))?.status ===
			"validating",
		"Pending -> validating must succeed.",
	);
	await expectRejected("Invalid ready metadata", () =>
		repository.markMediaAssetReady(actorA, {
			assetId,
			metadata: {
				mimeType: "image/gif",
				byteSize: 33,
				checksumSha256: "0".repeat(64),
				width: 3,
				height: 2,
				durationMs: null,
			},
		}),
	);
	const ready = await repository.markMediaAssetReady(actorA, {
		assetId,
		metadata: {
			mimeType: "image/png",
			byteSize: 33,
			checksumSha256: "0".repeat(64),
			width: 3,
			height: 2,
			durationMs: null,
		},
	});
	assert(
		ready?.status === "ready" && ready.mimeType === "image/png",
		"Validating -> ready must persist authoritative metadata.",
	);
	const linkedOrganic = await repository.createMediaAssetLink(actorA, {
		id: `link-organic-${randomUUID()}`,
		projectId: organicProject,
		mediaAssetId: assetId,
	});
	const linkedAffiliate = await repository.createMediaAssetLink(actorA, {
		id: `link-affiliate-${randomUUID()}`,
		projectId: affiliateProject,
		mediaAssetId: assetId,
	});
	assert(
		linkedOrganic?.projectId === organicProject &&
			linkedAffiliate?.projectId === affiliateProject,
		"One READY asset must link to both Organic and Affiliate projects.",
	);
	assert(
		(await repository.countActiveMediaAssetLinks(actorA, assetId)) === 2,
		"Both active project links must count.",
	);
	await repository.removeMediaAssetLink(actorA, {
		projectId: organicProject,
		mediaAssetId: assetId,
	});
	assert(
		(await repository.countActiveMediaAssetLinks(actorA, assetId)) === 1,
		"Removing one link must preserve the other.",
	);
	await expectRejected("Cross-workspace link", () =>
		repository.createMediaAssetLink(actorB, {
			id: `link-cross-${randomUUID()}`,
			projectId: otherProject,
			mediaAssetId: assetId,
		}),
	);
	const updated = await repository.updateMediaAssetMetadata(actorA, {
		assetId,
		displayName: "Renamed",
		tags: ["organic"],
		usageRights: "owned",
	});
	assert(
		updated?.displayName === "Renamed" &&
			updated.checksumSha256 === "0".repeat(64),
		"Display metadata may change while binary metadata remains immutable.",
	);
	assert(
		(await repository.archiveMediaAsset(actorA, assetId))?.status ===
			"archived",
		"READY -> archived must succeed.",
	);
	assert(
		(await repository.archiveMediaAsset(actorA, assetId))?.status ===
			"archived",
		"Archiving must be idempotent.",
	);
	const duplicateChecksumId = `media-same-checksum-${randomUUID()}`;
	await repository.createPendingMediaAsset(actorA, {
		id: duplicateChecksumId,
		mediaType: "image",
		origin: "user_upload",
		storageProvider: "local",
		storageKey: `media/v1/${workspaceA}/${duplicateChecksumId}/payload.png`,
		uploadSessionId: `upload-${randomUUID()}`,
		prepareIdempotencyKey: `prepare-${randomUUID()}`,
		uploadExpiresAt: new Date(Date.now() + 60_000),
		originalFilename: "same.png",
		displayName: "Same checksum",
		declaredMimeType: "image/png",
	});
	await repository.markMediaAssetValidating(actorA, {
		assetId: duplicateChecksumId,
	});
	await repository.markMediaAssetReady(actorA, {
		assetId: duplicateChecksumId,
		metadata: {
			mimeType: "image/png",
			byteSize: 33,
			checksumSha256: "0".repeat(64),
			width: 3,
			height: 2,
			durationMs: null,
		},
	});
	assert(
		(await repository.archiveMediaAsset(actorA, duplicateChecksumId))
			?.status === "archived",
		"A duplicate checksum may have a separate asset identity.",
	);
	await expectRejected("Duplicate storage key", () =>
		repository.createPendingMediaAsset(actorA, {
			id: `media-duplicate-key-${randomUUID()}`,
			mediaType: "image",
			origin: "user_upload",
			storageProvider: "local",
			storageKey,
			uploadSessionId: `upload-${randomUUID()}`,
			prepareIdempotencyKey: `prepare-${randomUUID()}`,
			uploadExpiresAt: new Date(Date.now() + 60_000),
			originalFilename: "collision.png",
			displayName: "Collision",
			declaredMimeType: "image/png",
		}),
	);

	const failedId = `media-failed-${randomUUID()}`;
	await repository.createPendingMediaAsset(actorA, {
		id: failedId,
		mediaType: "audio",
		origin: "user_upload",
		storageProvider: "local",
		storageKey: `media/v1/${workspaceA}/${failedId}/payload.mp3`,
		uploadSessionId: `upload-${randomUUID()}`,
		prepareIdempotencyKey: `prepare-${randomUUID()}`,
		uploadExpiresAt: new Date(Date.now() + 60_000),
		originalFilename: "voice.mp3",
		displayName: "Voice",
		declaredMimeType: "audio/mpeg",
	});
	assert(
		(
			await repository.markMediaAssetFailed(actorA, {
				assetId: failedId,
				failureCode: "MEDIA_ASSET_INVALID_MEDIA",
			})
		)?.status === "failed",
		"Pending -> failed must persist a failure code.",
	);
	assert(
		(await repository.archiveMediaAsset(actorA, failedId))?.status ===
			"archived",
		"FAILED -> archived must succeed.",
	);
	const rows = await db
		.select({ id: mediaAsset.id })
		.from(mediaAsset)
		.where(eq(mediaAsset.workspaceId, workspaceA));
	const links = await db
		.select({ id: mediaAssetLink.id })
		.from(mediaAssetLink)
		.where(eq(mediaAssetLink.workspaceId, workspaceA));
	assert(
		rows.length === 3 && links.length === 1,
		"Repository acceptance rows must remain workspace-scoped.",
	);
	console.log(
		"MediaAsset repository lifecycle, immutability, project links, and cross-workspace checks: PASS",
	);
} finally {
	await pool.end();
	for (const folder of temporaryFolders)
		await rm(folder, { recursive: true, force: true });
}

async function expectRejected(label: string, action: () => Promise<unknown>) {
	try {
		await action();
	} catch {
		console.log(`${label}: REJECTED`);
		return;
	}
	throw new Error(`${label} must reject.`);
}
