import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { requireE2ETestDatabaseAuthority } from "./e2e-test-database-authority";

const migrationsFolder = "packages/db/src/migrations";

process.env.NODE_ENV = "test";
process.env.SKIP_ENV_VALIDATION = "1";
for (const key of ["DATABASE_URL", "DATABASE_URL_DIRECT"]) {
	delete process.env[key];
}

const authority = requireE2ETestDatabaseAuthority();
process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = authority.url;
process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM = "DISPOSABLE_DB_CONFIRMED";

const { createNodePostgresPool } = await import(
	"../packages/db/src/node-postgres-test-adapter"
);
const pool = createNodePostgresPool(authority.url);

function id(prefix: string) {
	return `us22-s3-${prefix}-${randomUUID()}`;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function insertMediaAsset(input: {
	id: string;
	workspaceId: string;
	userId: string;
	frameCount?: number;
}) {
	await pool.query(
		`insert into media_asset (
			id, workspace_id, created_by_user_id, origin, media_type, status,
			storage_provider, storage_key, upload_session_id, prepare_idempotency_key,
			upload_expires_at, original_filename, display_name, declared_mime_type,
			mime_type, byte_size, checksum_sha256, width, height,
			image_analysis_version, image_frame_count, image_exif_orientation,
			image_has_transparency, usage_rights, tags, finalized_at
		) values (
			$1, $2, $3, 'user_upload', 'image', 'ready', 'local', $4, $5, $6,
			now() + interval '1 hour', 'fixture.png', 'Fixture', 'image/png',
			'image/png', 33, $7, 3, 2, 'static-raster-v1', $8, 1, false,
			'owned', ARRAY[]::text[], now()
		)`,
		[
			input.id,
			input.workspaceId,
			input.userId,
			`media/v1/${input.workspaceId}/${input.id}/image.png`,
			id("upload"),
			id("prepare"),
			"a".repeat(64),
			input.frameCount ?? 1,
		],
	);
}

async function insertProject(input: {
	id: string;
	workspaceId: string;
	userId: string;
	creationPath: string;
	contentFormatKey: string;
	contentFormatVersion: number;
}) {
	await pool.query(
		`insert into project (
			id, workspace_id, name, product_id, content_type, creation_path,
			content_format_key, content_format_version, current_step_key,
			created_by_user_id
		) values ($1, $2, $3, null, 'ORGANIC', $4, $5, $6, 'content', $7)`,
		[
			input.id,
			input.workspaceId,
			input.id,
			input.creationPath,
			input.contentFormatKey,
			input.contentFormatVersion,
			input.userId,
		],
	);
}

async function insertLink(input: {
	id: string;
	workspaceId: string;
	projectId: string;
	mediaAssetId: string;
	usageType: "project_resource" | "quick_image_current_source";
	userId: string;
}) {
	await pool.query(
		`insert into media_asset_link
			(id, workspace_id, project_id, media_asset_id, usage_type, created_by_user_id)
		values ($1, $2, $3, $4, $5, $6)`,
		[
			input.id,
			input.workspaceId,
			input.projectId,
			input.mediaAssetId,
			input.usageType,
			input.userId,
		],
	);
}

async function currentLinks(projectId: string) {
	const result = await pool.query<{ id: string; media_asset_id: string }>(
		`select id, media_asset_id from media_asset_link
		 where project_id = $1 and usage_type = 'quick_image_current_source'
		 order by id`,
		[projectId],
	);
	return result.rows;
}

async function expectServiceError(
	label: string,
	action: () => Promise<unknown>,
	code: string,
	reasonCode?: string,
) {
	try {
		await action();
	} catch (error) {
		const candidate = error as {
			code?: string;
			metadata?: { reasonCode?: string };
		};
		assert(candidate.code === code, `${label}: unexpected error code`);
		if (reasonCode)
			assert(
				candidate.metadata?.reasonCode === reasonCode,
				`${label}: unexpected reason code`,
			);
		console.log(`${label}: PASS`);
		return;
	}
	throw new Error(`${label}: expected rejection`);
}

try {
	if (new URL(authority.url).hostname !== "127.0.0.1")
		throw new Error("REFUSED: integration authority must be loopback.");
	console.log(
		`AUTHORITY host=127.0.0.1 database=${authority.database} confirmation=valid`,
	);

	await pool.query("drop schema if exists public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
	await migrate(drizzle(pool), { migrationsFolder });
	console.log("MIGRATIONS through 0026: PASS");

	const workspaceA = id("workspace-a");
	const workspaceB = id("workspace-b");
	const userA = id("user-a");
	const userB = id("user-b");
	const projectA = id("project-a");
	const projectScripted = id("project-scripted");
	const projectWrongFormat = id("project-wrong-format");
	await pool.query(
		`insert into workspace (id, name) values ($1, 'US22 Slice 3 A'), ($2, 'US22 Slice 3 B')`,
		[workspaceA, workspaceB],
	);
	await pool.query(
		`insert into "user" (id, name, email, email_verified)
		values ($1, 'US22 A', $3, true), ($2, 'US22 B', $4, true)`,
		[userA, userB, `${userA}@example.test`, `${userB}@example.test`],
	);
	await insertProject({
		id: projectA,
		workspaceId: workspaceA,
		userId: userA,
		creationPath: "QUICK_IMAGE",
		contentFormatKey: "QUICK_IMAGE_STANDARD",
		contentFormatVersion: 1,
	});
	await insertProject({
		id: projectScripted,
		workspaceId: workspaceA,
		userId: userA,
		creationPath: "SCRIPTED",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
	});
	await insertProject({
		id: projectWrongFormat,
		workspaceId: workspaceA,
		userId: userA,
		creationPath: "QUICK_IMAGE",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
	});

	const eligibleA = id("asset-a");
	const eligibleB = id("asset-b");
	const ineligible = id("asset-ineligible");
	const crossWorkspace = id("asset-cross-workspace");
	await insertMediaAsset({
		id: eligibleA,
		workspaceId: workspaceA,
		userId: userA,
	});
	await insertMediaAsset({
		id: eligibleB,
		workspaceId: workspaceA,
		userId: userA,
	});
	await insertMediaAsset({
		id: ineligible,
		workspaceId: workspaceA,
		userId: userA,
		frameCount: 2,
	});
	await insertMediaAsset({
		id: crossWorkspace,
		workspaceId: workspaceB,
		userId: userB,
	});
	const mediaSnapshot = await pool.query(
		`select id, workspace_id, status, storage_provider, storage_key, mime_type,
			byte_size, checksum_sha256, width, height, image_analysis_version,
			image_frame_count, image_exif_orientation, image_has_transparency
		 from media_asset where id = any($1::text[]) order by id`,
		[[eligibleA, eligibleB, ineligible, crossWorkspace]],
	);

	const service = await import(
		"../packages/api/src/services/quick-image-source-service"
	);
	const actorA = { workspaceId: workspaceA, userId: userA };

	const missing = await service.resolveQuickImageCurrentSource({
		workspaceId: workspaceA,
		projectId: projectA,
	});
	assert(missing.status === "MISSING", "missing source must resolve MISSING");
	console.log("resolver MISSING: PASS");

	const first = await service.setQuickImageCurrentSource({
		actor: actorA,
		projectId: projectA,
		mediaAssetId: eligibleA,
	});
	assert(first.kind === "SET", "first source must SET");
	assert((await currentLinks(projectA)).length === 1, "first source count");
	console.log("replacement no source -> A: PASS");

	const ready = await service.resolveQuickImageCurrentSource({
		workspaceId: workspaceA,
		projectId: projectA,
	});
	assert(
		ready.status === "READY" && ready.source.id === eligibleA,
		"A must be READY",
	);
	console.log("resolver READY: PASS");

	const noop = await service.setQuickImageCurrentSource({
		actor: actorA,
		projectId: projectA,
		mediaAssetId: eligibleA,
	});
	assert(
		noop.kind === "NOOP" && noop.linkId === first.linkId,
		"same source must NOOP",
	);
	assert(
		(await currentLinks(projectA)).length === 1,
		"idempotent source count",
	);
	console.log("same-source idempotency: PASS");

	const resourcesBefore = 0;
	await insertLink({
		id: id("resource-a"),
		workspaceId: workspaceA,
		projectId: projectA,
		mediaAssetId: eligibleA,
		usageType: "project_resource",
		userId: userA,
	});
	await insertLink({
		id: id("resource-b"),
		workspaceId: workspaceA,
		projectId: projectA,
		mediaAssetId: eligibleB,
		usageType: "project_resource",
		userId: userA,
	});
	const resourceCountBefore = await pool.query<{ count: number }>(
		`select count(*)::int as count from media_asset_link
		 where project_id = $1 and usage_type = 'project_resource'`,
		[projectA],
	);
	assert(
		resourceCountBefore.rows[0]?.count === resourcesBefore + 2,
		"resource fixture count",
	);

	const replaced = await service.setQuickImageCurrentSource({
		actor: actorA,
		projectId: projectA,
		mediaAssetId: eligibleB,
	});
	assert(replaced.kind === "SET", "A -> B must SET");
	const afterReplace = await service.resolveQuickImageCurrentSource({
		workspaceId: workspaceA,
		projectId: projectA,
	});
	assert(
		afterReplace.status === "READY" && afterReplace.source.id === eligibleB,
		"B must be READY",
	);
	const resourceCountAfter = await pool.query<{ count: number }>(
		`select count(*)::int as count from media_asset_link
		 where project_id = $1 and usage_type = 'project_resource'`,
		[projectA],
	);
	assert(
		resourceCountAfter.rows[0]?.count === 2,
		"project resources must remain unchanged",
	);
	console.log("replacement A -> B and project_resource preservation: PASS");

	await expectServiceError(
		"ineligible replacement preserves B",
		() =>
			service.setQuickImageCurrentSource({
				actor: actorA,
				projectId: projectA,
				mediaAssetId: ineligible,
			}),
		"QUICK_IMAGE_MEDIA_ASSET_INELIGIBLE",
		"NOT_SINGLE_FRAME",
	);
	const afterIneligible = await service.resolveQuickImageCurrentSource({
		workspaceId: workspaceA,
		projectId: projectA,
	});
	assert(
		afterIneligible.status === "READY" &&
			afterIneligible.source.id === eligibleB,
		"B must remain current",
	);

	await expectServiceError(
		"cross-workspace replacement fails closed",
		() =>
			service.setQuickImageCurrentSource({
				actor: actorA,
				projectId: projectA,
				mediaAssetId: crossWorkspace,
			}),
		"QUICK_IMAGE_MEDIA_ASSET_NOT_FOUND",
	);
	await expectServiceError(
		"missing media replacement fails closed",
		() =>
			service.setQuickImageCurrentSource({
				actor: actorA,
				projectId: projectA,
				mediaAssetId: id("missing-asset"),
			}),
		"QUICK_IMAGE_MEDIA_ASSET_NOT_FOUND",
	);

	await expectServiceError(
		"non-Quick Image project rejected",
		() =>
			service.setQuickImageCurrentSource({
				actor: actorA,
				projectId: projectScripted,
				mediaAssetId: eligibleA,
			}),
		"QUICK_IMAGE_PROJECT_IDENTITY_INVALID",
	);
	await expectServiceError(
		"wrong Quick Image format rejected",
		() =>
			service.setQuickImageCurrentSource({
				actor: actorA,
				projectId: projectWrongFormat,
				mediaAssetId: eligibleA,
			}),
		"QUICK_IMAGE_PROJECT_IDENTITY_INVALID",
	);
	await expectServiceError(
		"missing project rejected",
		() =>
			service.resolveQuickImageCurrentSource({
				workspaceId: workspaceA,
				projectId: id("missing-project"),
			}),
		"QUICK_IMAGE_PROJECT_NOT_FOUND",
	);
	await expectServiceError(
		"cross-workspace project rejected",
		() =>
			service.resolveQuickImageCurrentSource({
				workspaceId: workspaceB,
				projectId: projectA,
			}),
		"QUICK_IMAGE_PROJECT_NOT_FOUND",
	);

	await pool.query(
		`delete from media_asset_link where project_id = $1 and usage_type = 'quick_image_current_source'`,
		[projectA],
	);
	await insertLink({
		id: id("raw-ineligible-current"),
		workspaceId: workspaceA,
		projectId: projectA,
		mediaAssetId: ineligible,
		usageType: "quick_image_current_source",
		userId: userA,
	});
	const ineligibleResolution = await service.resolveQuickImageCurrentSource({
		workspaceId: workspaceA,
		projectId: projectA,
	});
	assert(
		ineligibleResolution.status === "INELIGIBLE" &&
			ineligibleResolution.reasonCode === "NOT_SINGLE_FRAME",
		"ineligible current source must resolve INELIGIBLE",
	);
	console.log("resolver INELIGIBLE: PASS");
	await pool.query(
		`delete from media_asset_link where project_id = $1 and usage_type = 'quick_image_current_source'`,
		[projectA],
	);

	const concurrent = await Promise.allSettled([
		service.setQuickImageCurrentSource({
			actor: actorA,
			projectId: projectA,
			mediaAssetId: eligibleA,
		}),
		service.setQuickImageCurrentSource({
			actor: actorA,
			projectId: projectA,
			mediaAssetId: eligibleB,
		}),
	]);
	assert(
		concurrent.every((result) => result.status === "fulfilled"),
		"concurrent replacements must both complete",
	);
	const concurrentLinks = await currentLinks(projectA);
	assert(
		concurrentLinks.length === 1,
		"concurrent replacement must leave one link",
	);
	assert(
		[eligibleA, eligibleB].includes(concurrentLinks[0]?.media_asset_id ?? ""),
		"concurrent replacement winner must be one requested asset",
	);
	console.log("concurrent A/B replacement, one-link invariant: PASS");

	console.log("CORRUPT_MULTIPLE: covered by pure resolver regression test");
	const mediaSnapshotAfter = await pool.query(
		`select id, workspace_id, status, storage_provider, storage_key, mime_type,
			byte_size, checksum_sha256, width, height, image_analysis_version,
			image_frame_count, image_exif_orientation, image_has_transparency
		 from media_asset where id = any($1::text[]) order by id`,
		[[eligibleA, eligibleB, ineligible, crossWorkspace]],
	);
	assert(
		JSON.stringify(mediaSnapshot.rows) ===
			JSON.stringify(mediaSnapshotAfter.rows),
		"MediaAsset authority must remain immutable",
	);
	console.log("MEDIA_ASSET_IMMUTABILITY: PASS");
	console.log("SLICE_3_INTEGRATION=PASS");
} finally {
	try {
		await pool.query("drop schema if exists public cascade");
		await pool.query("create schema public");
	} finally {
		await pool.end();
	}
}
