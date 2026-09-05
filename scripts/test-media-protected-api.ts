import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const URL_ENV = "AFFICHANNEL_MEDIA_TEST_DATABASE_URL";
const CONFIRM_ENV = "AFFICHANNEL_MEDIA_TEST_DATABASE_CONFIRM";
const CONFIRM_VALUE = "DISPOSABLE_MEDIA_TEST_DB_CONFIRMED";
const LOOPBACK_HOSTS = new Set(["127.0.0.1"]);

function requireAuthority() {
	const value = process.env[URL_ENV]?.trim();
	if (!value)
		throw new Error(`REFUSED: ${URL_ENV} is required; no fallback is allowed.`);
	if (process.env[CONFIRM_ENV] !== CONFIRM_VALUE)
		throw new Error(`REFUSED: ${CONFIRM_ENV} must equal ${CONFIRM_VALUE}.`);
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`REFUSED: ${URL_ENV} is not a valid URL.`);
	}
	if (
		!["postgres:", "postgresql:"].includes(parsed.protocol) ||
		!LOOPBACK_HOSTS.has(parsed.hostname) ||
		parsed.pathname.length <= 1
	) {
		throw new Error(
			`REFUSED: ${URL_ENV} must identify an explicit loopback PostgreSQL database.`,
		);
	}
	return {
		value,
		host: parsed.host,
		database: decodeURIComponent(parsed.pathname.slice(1)),
	};
}

const authority = requireAuthority();
process.env.NODE_ENV = "test";
process.env.SKIP_ENV_VALIDATION = "1";
process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = authority.value;
process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM = "DISPOSABLE_DB_CONFIRMED";
process.env.MEDIA_STORAGE_PROVIDER = "local";
process.env.MEDIA_GRANT_SIGNING_SECRET =
	"media-protected-api-test-secret-0123456789";
process.env.BETTER_AUTH_URL = "http://127.0.0.1";
process.env.CORS_ORIGIN = "http://127.0.0.1";
process.env.MEDIA_IMAGE_MAX_BYTES = "1048576";
process.env.MEDIA_VIDEO_MAX_BYTES = "1048576";
process.env.MEDIA_AUDIO_MAX_BYTES = "1048576";
for (const key of [
	"DATABASE_URL",
	"DATABASE_URL_DIRECT",
	"R2_ENDPOINT",
	"R2_BUCKET",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
])
	delete process.env[key];
const localRoot = await mkdtemp(
	join(tmpdir(), "affichannel-media-protected-api-"),
);
process.env.MEDIA_LOCAL_ROOT = localRoot;

const { createNodePostgresPool } = await import(
	"../packages/db/src/node-postgres-test-adapter.ts"
);
const { drizzle } = await import("drizzle-orm/node-postgres");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { db, mediaAsset, project, user, workspace, workspaceMember } =
	await import("../packages/db/src/index.ts");
const { eq } = await import("drizzle-orm");
const { call } = await import(
	"../packages/api/node_modules/@orpc/server/dist/index.mjs"
);
const { appRouter } = await import("../packages/api/src/routers/index.ts");
const { PUT: mediaUploadPut } = await import(
	"../apps/web/src/app/api/media/upload/[token]/route.ts"
);
const { GET: mediaDownloadGet } = await import(
	"../apps/web/src/app/api/media/download/[token]/route.ts"
);
const service = await import(
	"../packages/api/src/services/media-asset-service.ts"
);
const { createMediaAssetStorage } = await import(
	"../packages/api/src/media/media-asset-storage-factory.ts"
);
const { R2MediaAssetStorage } = await import(
	"../packages/api/src/media/media-asset-storage.ts"
);
const { createLocalMediaAssetGrant, verifyLocalMediaAssetGrant } = await import(
	"../packages/api/src/media/media-asset-grants.ts"
);
const { sha256Bytes } = await import(
	"../packages/api/src/media/media-asset-checksum.ts"
);
const { auth } = await import("@affichannel/auth");

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
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
function pngFixture(width = 3, height = 2) {
	const bytes = new Uint8Array(33);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82], 0);
	bytes.set(
		[
			(width >>> 24) & 255,
			(width >>> 16) & 255,
			(width >>> 8) & 255,
			width & 255,
		],
		16,
	);
	bytes.set(
		[
			(height >>> 24) & 255,
			(height >>> 16) & 255,
			(height >>> 8) & 255,
			height & 255,
		],
		20,
	);
	return bytes;
}
function mp3Fixture(frameCount = 40) {
	const frame = Uint8Array.from({ length: 417 }, (_, index) =>
		index === 0
			? 0xff
			: index === 1
				? 0xfb
				: index === 2
					? 0x90
					: index === 3
						? 0x64
						: 0,
	);
	const bytes = new Uint8Array(frame.length * frameCount);
	for (let index = 0; index < frameCount; index += 1)
		bytes.set(frame, index * frame.length);
	return bytes;
}
function mp4Fixture() {
	const bytes = new Uint8Array(16);
	bytes.set([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
	return bytes;
}

const pool = createNodePostgresPool(authority.value);
let restoreAuthSession: (() => void) | undefined;
try {
	await pool.query("drop schema public cascade");
	await pool.query("create schema public");
	await migrate(drizzle(pool), {
		migrationsFolder: resolve("packages/db/src/migrations"),
	});
	console.log(
		`Disposable identity: database=${authority.database}; host=${authority.host}; schema=public`,
	);

	const workspaceA = "internal";
	const workspaceB = `media-api-ws-b-${randomUUID()}`;
	const userA = `media-api-user-a-${randomUUID()}`;
	const userB = `media-api-user-b-${randomUUID()}`;
	const organicProject = `media-api-organic-${randomUUID()}`;
	const affiliateProject = `media-api-affiliate-${randomUUID()}`;
	const otherProject = `media-api-other-${randomUUID()}`;
	await db.insert(workspace).values([{ id: workspaceB, name: "Media API B" }]);
	await db.insert(user).values([
		{
			id: userA,
			name: "Media API A",
			email: `${userA}@example.test`,
			emailVerified: true,
		},
		{
			id: userB,
			name: "Media API B",
			email: `${userB}@example.test`,
			emailVerified: true,
		},
	]);
	await db.insert(workspaceMember).values([
		{ id: randomUUID(), workspaceId: workspaceA, userId: userA },
		{ id: randomUUID(), workspaceId: workspaceB, userId: userB },
	]);
	await db.insert(project).values([
		{
			id: organicProject,
			workspaceId: workspaceA,
			name: "Organic",
			productId: null,
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			contentFormatKey: "script.v1",
			contentFormatVersion: 1,
			currentStepKey: "content",
			createdByUserId: userA,
		},
		{
			id: affiliateProject,
			workspaceId: workspaceA,
			name: "Affiliate",
			productId: null,
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "script.v1",
			contentFormatVersion: 1,
			currentStepKey: "content",
			createdByUserId: userA,
		},
		{
			id: otherProject,
			workspaceId: workspaceB,
			name: "Other",
			productId: null,
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			contentFormatKey: "script.v1",
			contentFormatVersion: 1,
			currentStepKey: "content",
			createdByUserId: userB,
		},
	]);
	const actorA = { workspaceId: workspaceA, userId: userA };
	const actorB = { workspaceId: workspaceB, userId: userB };
	const previousGetSession = auth.api.getSession;
	(
		auth.api as unknown as {
			getSession: (options: unknown) => Promise<unknown>;
		}
	).getSession = async () => ({
		user: {
			id: userA,
			name: "Media API A",
			email: `${userA}@example.test`,
			emailVerified: true,
		},
		session: {
			id: `media-api-session-${randomUUID()}`,
			token: `media-api-session-token-${randomUUID()}`,
			userId: userA,
			expiresAt: new Date(Date.now() + 60 * 60_000),
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	});
	restoreAuthSession = () => {
		(
			auth.api as unknown as {
				getSession: typeof previousGetSession;
			}
		).getSession = previousGetSession;
	};
	const bytes = pngFixture();
	const intent = {
		mediaType: "image" as const,
		originalFilename: "hero.png",
		displayName: "Hero",
		declaredMimeType: "image/png",
		declaredByteSize: bytes.byteLength,
		usageRights: "owned" as const,
		tags: ["Campaign"],
		idempotencyKey: `prepare-${randomUUID()}`,
	};

	const prepared = await service.prepareMediaAssetUpload(actorA, intent);
	assert(
		prepared.asset.status === "pending_upload" &&
			prepared.uploadGrant?.provider === "local",
		"prepare must create pending local asset and grant",
	);
	const replay = await service.prepareMediaAssetUpload(actorA, intent);
	assert(
		replay.assetId === prepared.assetId && replay.replayed,
		"prepare replay must reuse one identity",
	);
	await expectRejected("Prepare idempotency conflict", () =>
		service.prepareMediaAssetUpload(actorA, {
			...intent,
			displayName: "Different intent",
		}),
	);
	const concurrent = await Promise.all([
		service.prepareMediaAssetUpload(actorA, {
			...intent,
			idempotencyKey: `race-${randomUUID()}`,
		}),
		service.prepareMediaAssetUpload(actorA, {
			...intent,
			idempotencyKey: `race-${randomUUID()}`,
		}),
	]);
	assert(
		new Set(concurrent.map((result) => result.assetId)).size === 2,
		"different idempotency keys must remain distinct",
	);
	const sameRaceKey = `same-race-${randomUUID()}`;
	const raced = await Promise.all([
		service.prepareMediaAssetUpload(actorA, {
			...intent,
			idempotencyKey: sameRaceKey,
		}),
		service.prepareMediaAssetUpload(actorA, {
			...intent,
			idempotencyKey: sameRaceKey,
		}),
	]);
	assert(
		new Set(raced.map((result) => result.assetId)).size === 1,
		"same idempotency key must converge",
	);
	await expectRejected("Oversized declared upload", () =>
		service.prepareMediaAssetUpload(actorA, {
			...intent,
			declaredByteSize: 10 * 1024 * 1024 + 1,
			idempotencyKey: `oversized-${randomUUID()}`,
		}),
	);

	const uploadToken = prepared.uploadGrant?.urlOrToken;
	assert(uploadToken, "local upload token missing");
	const payload = verifyLocalMediaAssetGrant(uploadToken, "upload");
	assert(
		payload.assetId === prepared.assetId &&
			payload.uploadSessionId === prepared.uploadSessionId,
		"upload token binding missing",
	);
	assert(
		payload.strictByteSize === true && payload.byteSize === bytes.byteLength,
		"upload token must bind exact declared byte size",
	);
	const unauthenticatedUpload = await mediaUploadPut(
		new Request("http://127.0.0.1/api/media/upload/test", {
			method: "PUT",
			headers: { "content-type": "image/png" },
			body: bytes,
		}),
		{ params: Promise.resolve({ token: uploadToken }) },
	);
	assert(
		unauthenticatedUpload.status === 401,
		"local upload route must require an authenticated session",
	);
	const storage = createMediaAssetStorage("local");
	const uploaded = await mediaUploadPut(
		new Request("http://127.0.0.1/api/media/upload/test", {
			method: "PUT",
			headers: { "content-type": "image/png" },
			body: bytes,
		}),
		{ params: Promise.resolve({ token: uploadToken }) },
	);
	assert(
		uploaded.status === 201,
		"authenticated local upload PUT must succeed",
	);
	const uploadReplay = await mediaUploadPut(
		new Request("http://127.0.0.1/api/media/upload/test", {
			method: "PUT",
			headers: { "content-type": "image/png" },
			body: bytes,
		}),
		{ params: Promise.resolve({ token: uploadToken }) },
	);
	assert(
		uploadReplay.status === 409,
		"local upload PUT replay must be rejected",
	);
	const finalized = await service.finalizeMediaAssetUpload(actorA, {
		assetId: prepared.assetId,
		uploadSessionId: prepared.uploadSessionId,
	});
	assert(
		finalized.outcome === "ready" &&
			finalized.asset.status === "ready" &&
			finalized.asset.width === 3 &&
			finalized.asset.height === 2 &&
			finalized.asset.checksumSha256 === sha256Bytes(bytes),
		"PNG finalize metadata is not authoritative",
	);
	const replayFinalize = await service.finalizeMediaAssetUpload(actorA, {
		assetId: prepared.assetId,
		uploadSessionId: prepared.uploadSessionId,
	});
	assert(
		replayFinalize.outcome === "already_finalized",
		"READY finalize replay must be terminal",
	);
	const fetched = await service.getMediaAsset(actorA, prepared.assetId);
	assert(
		fetched.asset.id === prepared.assetId && fetched.linkCount === 0,
		"same-workspace get must return the READY asset",
	);
	const metadataUpdated = await service.updateMediaAsset(
		actorA,
		prepared.assetId,
		{
			displayName: "Hero%_Renamed",
			tags: ["Campaign", "Launch"],
			usageRights: "owned",
		},
	);
	assert(
		metadataUpdated.asset.displayName === "Hero%_Renamed" &&
			metadataUpdated.asset.tags.includes("Launch"),
		"metadata update must persist only allowed fields",
	);

	const routerList = await call(
		appRouter.media.list,
		{ limit: 20 },
		{ context: { auth: null, session: { user: { id: userA } } } as never },
	);
	assert(
		routerList.items.some((item) => item.id === prepared.assetId),
		"protected media router list must see the asset",
	);
	const routerGet = await call(
		appRouter.media.get,
		{ assetId: prepared.assetId },
		{ context: { auth: null, session: { user: { id: userA } } } as never },
	);
	assert(
		routerGet.asset.id === prepared.assetId,
		"protected media router get must enforce workspace actor context",
	);
	await expectRejected("Router authority field", () =>
		call(
			appRouter.media.prepareUpload,
			{ ...intent, workspaceId: workspaceA } as never,
			{ context: { auth: null, session: { user: { id: userA } } } as never },
		),
	);
	await expectRejected("Cross-workspace get", () =>
		service.getMediaAsset(actorB, prepared.assetId),
	);

	const download = await service.getMediaAssetDownload(
		actorA,
		prepared.assetId,
	);
	assert(
		download.provider === "local",
		"READY download must return local grant",
	);
	const downloadPayload = verifyLocalMediaAssetGrant(
		download.urlOrToken,
		"download",
	);
	const unauthenticatedDownload = await mediaDownloadGet(
		new Request("http://127.0.0.1/api/media/download/test"),
		{ params: Promise.resolve({ token: download.urlOrToken }) },
	);
	assert(
		unauthenticatedDownload.status === 401,
		"local download route must require an authenticated session",
	);
	const downloaded = await mediaDownloadGet(
		new Request("http://127.0.0.1/api/media/download/test"),
		{ params: Promise.resolve({ token: download.urlOrToken }) },
	);
	assert(
		downloaded.status === 200,
		"authenticated local download GET must succeed",
	);
	assert(
		Buffer.from(await downloaded.arrayBuffer()).equals(Buffer.from(bytes)),
		"local download GET bytes must equal upload PUT bytes",
	);
	assert(
		await storage
			.get(downloadPayload.storageKey)
			.then((value) => Buffer.from(value).equals(Buffer.from(bytes))),
		"download bytes must equal upload bytes",
	);

	const concurrentFinalize = await service.prepareMediaAssetUpload(actorA, {
		...intent,
		displayName: "Concurrent",
		idempotencyKey: `concurrent-finalize-${randomUUID()}`,
	});
	assert(
		concurrentFinalize.uploadGrant,
		"Concurrent finalize upload grant missing",
	);
	const concurrentToken = verifyLocalMediaAssetGrant(
		concurrentFinalize.uploadGrant.urlOrToken,
		"upload",
	);
	await storage.put({
		storageKey: concurrentToken.storageKey,
		body: bytes,
		contentType: "image/png",
		checksumSha256: sha256Bytes(bytes),
	});
	const finalizeRace = await Promise.all([
		service.finalizeMediaAssetUpload(actorA, {
			assetId: concurrentFinalize.assetId,
			uploadSessionId: concurrentFinalize.uploadSessionId,
		}),
		service.finalizeMediaAssetUpload(actorA, {
			assetId: concurrentFinalize.assetId,
			uploadSessionId: concurrentFinalize.uploadSessionId,
		}),
	]);
	assert(
		finalizeRace.some((result) => result.outcome === "ready") &&
			finalizeRace.every((result) => result.asset.status === "ready"),
		"concurrent finalize must converge to one READY asset",
	);

	const expiredKey = `expired-${randomUUID()}`;
	const expired = await service.prepareMediaAssetUpload(actorA, {
		...intent,
		displayName: "Expired",
		idempotencyKey: expiredKey,
	});
	await db
		.update(mediaAsset)
		.set({ uploadExpiresAt: new Date(Date.now() - 1) })
		.where(eq(mediaAsset.id, expired.assetId));
	const expiredReplay = await service.prepareMediaAssetUpload(actorA, {
		...intent,
		displayName: "Expired",
		idempotencyKey: expiredKey,
	});
	assert(
		expiredReplay.uploadGrant === null,
		"expired prepare replay must not mint a new grant",
	);
	const expiredFinalize = await service.finalizeMediaAssetUpload(actorA, {
		assetId: expired.assetId,
		uploadSessionId: expired.uploadSessionId,
	});
	assert(
		expiredFinalize.outcome === "failed" &&
			expiredFinalize.asset.failureCode === "MEDIA_ASSET_UPLOAD_EXPIRED",
		"expired finalize must fail terminally",
	);

	const mp3 = await service.prepareMediaAssetUpload(actorA, {
		...intent,
		mediaType: "audio",
		originalFilename: "voice.mp3",
		displayName: "Voice",
		declaredMimeType: "audio/mpeg",
		declaredByteSize: mp3Fixture().byteLength,
		usageRights: "owned",
		idempotencyKey: `mp3-${randomUUID()}`,
	});
	assert(mp3.uploadGrant, "MP3 upload grant missing");
	const mp3Token = verifyLocalMediaAssetGrant(
		mp3.uploadGrant.urlOrToken,
		"upload",
	);
	const mp3Bytes = mp3Fixture();
	await storage.put({
		storageKey: mp3Token.storageKey,
		body: mp3Bytes,
		contentType: "audio/mpeg",
		checksumSha256: sha256Bytes(mp3Bytes),
	});
	const mp3Ready = await service.finalizeMediaAssetUpload(actorA, {
		assetId: mp3.assetId,
		uploadSessionId: mp3.uploadSessionId,
	});
	assert(
		mp3Ready.asset.durationMs === 1045,
		"MP3 duration must be server-derived",
	);

	const mp4 = await service.prepareMediaAssetUpload(actorA, {
		...intent,
		mediaType: "video",
		originalFilename: "clip.mp4",
		displayName: "Clip",
		declaredMimeType: "video/mp4",
		declaredByteSize: 16,
		idempotencyKey: `mp4-${randomUUID()}`,
	});
	assert(mp4.uploadGrant, "MP4 upload grant missing");
	const mp4Token = verifyLocalMediaAssetGrant(
		mp4.uploadGrant.urlOrToken,
		"upload",
	);
	const mp4Bytes = mp4Fixture();
	await storage.put({
		storageKey: mp4Token.storageKey,
		body: mp4Bytes,
		contentType: "video/mp4",
		checksumSha256: sha256Bytes(mp4Bytes),
	});
	const mp4Ready = await service.finalizeMediaAssetUpload(actorA, {
		assetId: mp4.assetId,
		uploadSessionId: mp4.uploadSessionId,
	});
	assert(
		mp4Ready.asset.status === "ready" &&
			mp4Ready.asset.width === null &&
			mp4Ready.asset.durationMs === null,
		"MP4 contract must keep deferred dimensions/duration nullable",
	);

	const invalid = await service.prepareMediaAssetUpload(actorA, {
		...intent,
		originalFilename: "bad.png",
		idempotencyKey: `bad-${randomUUID()}`,
	});
	assert(invalid.uploadGrant, "Invalid-media upload grant missing");
	const invalidToken = verifyLocalMediaAssetGrant(
		invalid.uploadGrant.urlOrToken,
		"upload",
	);
	await storage.put({
		storageKey: invalidToken.storageKey,
		body: new Uint8Array([1, 2, 3]),
		contentType: "image/png",
		checksumSha256: sha256Bytes(new Uint8Array([1, 2, 3])),
	});
	const invalidResult = await service.finalizeMediaAssetUpload(actorA, {
		assetId: invalid.assetId,
		uploadSessionId: invalid.uploadSessionId,
	});
	assert(
		invalidResult.asset.status === "failed" &&
			invalidResult.asset.failureCode === "MEDIA_ASSET_INVALID_MEDIA",
		"invalid bytes must fail without READY",
	);

	const oversized = await service.prepareMediaAssetUpload(actorA, {
		...intent,
		displayName: "Oversized stored object",
		idempotencyKey: `oversized-stored-${randomUUID()}`,
	});
	assert(oversized.uploadGrant, "Oversized-object upload grant missing");
	const oversizedToken = verifyLocalMediaAssetGrant(
		oversized.uploadGrant.urlOrToken,
		"upload",
	);
	const oversizedBytes = new Uint8Array(1_048_577);
	await storage.put({
		storageKey: oversizedToken.storageKey,
		body: oversizedBytes,
		contentType: "image/png",
		checksumSha256: sha256Bytes(oversizedBytes),
	});
	const oversizedResult = await service.finalizeMediaAssetUpload(actorA, {
		assetId: oversized.assetId,
		uploadSessionId: oversized.uploadSessionId,
	});
	assert(
		oversizedResult.asset.status === "failed" &&
			oversizedResult.asset.failureCode === "MEDIA_ASSET_SIZE_LIMIT_EXCEEDED",
		"oversized stored object must fail before byte validation",
	);

	const linkedOrganic = await service.linkMediaAssetToProject(actorA, {
		assetId: prepared.assetId,
		projectId: organicProject,
	});
	const linkedAffiliate = await service.linkMediaAssetToProject(actorA, {
		assetId: prepared.assetId,
		projectId: affiliateProject,
	});
	assert(
		linkedOrganic.link.mediaAssetId === linkedAffiliate.link.mediaAssetId,
		"one asset must link to Organic and Affiliate",
	);
	const linkedAsset = await service.getMediaAsset(actorA, prepared.assetId);
	assert(
		linkedAsset.linkCount === 2,
		"one asset must retain two project links",
	);
	await service.unlinkMediaAssetFromProject(actorA, {
		assetId: prepared.assetId,
		projectId: organicProject,
	});
	const unlinkedAgain = await service.unlinkMediaAssetFromProject(actorA, {
		assetId: prepared.assetId,
		projectId: organicProject,
	});
	assert(unlinkedAgain.removed === false, "unlink replay must be idempotent");
	await expectRejected("Cross-workspace project link", () =>
		service.linkMediaAssetToProject(actorA, {
			assetId: prepared.assetId,
			projectId: otherProject,
		}),
	);
	const pendingForLink = await service.prepareMediaAssetUpload(actorA, {
		...intent,
		displayName: "Pending link",
		idempotencyKey: `pending-link-${randomUUID()}`,
	});
	await expectRejected("Pending project link", () =>
		service.linkMediaAssetToProject(actorA, {
			assetId: pendingForLink.assetId,
			projectId: organicProject,
		}),
	);
	await expectRejected("Pending download", () =>
		service.getMediaAssetDownload(actorA, pendingForLink.assetId),
	);
	const archived = await service.archiveMediaAssetRecord(
		actorA,
		prepared.assetId,
	);
	assert(
		archived.asset.status === "archived",
		"archive must be idempotent and retain links/bytes",
	);
	const licensed = await service.prepareMediaAssetUpload(actorA, {
		...intent,
		displayName: "Licensed",
		usageRights: "licensed",
		idempotencyKey: `licensed-${randomUUID()}`,
	});
	assert(licensed.uploadGrant, "Licensed upload grant missing");
	const licensedToken = verifyLocalMediaAssetGrant(
		licensed.uploadGrant.urlOrToken,
		"upload",
	);
	await storage.put({
		storageKey: licensedToken.storageKey,
		body: bytes,
		contentType: "image/png",
		checksumSha256: sha256Bytes(bytes),
	});
	await service.finalizeMediaAssetUpload(actorA, {
		assetId: licensed.assetId,
		uploadSessionId: licensed.uploadSessionId,
	});
	const licensedLink = await service.linkMediaAssetToProject(actorA, {
		assetId: licensed.assetId,
		projectId: affiliateProject,
	});
	assert(
		licensedLink.link.mediaAssetId === licensed.assetId,
		"Affiliate licensed rights must be allowed",
	);
	assert(
		(await service.getMediaAssetDownload(actorA, prepared.assetId)).provider ===
			"local",
		"archived download must remain allowed",
	);
	await expectRejected("Failed download", () =>
		service.getMediaAssetDownload(actorA, invalid.assetId),
	);
	await expectRejected("Affiliate unknown rights", async () => {
		const unknown = await service.prepareMediaAssetUpload(actorA, {
			...intent,
			usageRights: "unknown",
			idempotencyKey: `unknown-${randomUUID()}`,
		});
		assert(unknown.uploadGrant, "Unknown-rights upload grant missing");
		const token = verifyLocalMediaAssetGrant(
			unknown.uploadGrant.urlOrToken,
			"upload",
		);
		await storage.put({
			storageKey: token.storageKey,
			body: bytes,
			contentType: "image/png",
			checksumSha256: sha256Bytes(bytes),
		});
		await service.finalizeMediaAssetUpload(actorA, {
			assetId: unknown.assetId,
			uploadSessionId: unknown.uploadSessionId,
		});
		await service.linkMediaAssetToProject(actorA, {
			assetId: unknown.assetId,
			projectId: affiliateProject,
		});
	});
	await expectRejected("Affiliate restricted rights", async () => {
		const restricted = await service.prepareMediaAssetUpload(actorA, {
			...intent,
			usageRights: "restricted",
			idempotencyKey: `restricted-${randomUUID()}`,
		});
		assert(restricted.uploadGrant, "Restricted-rights upload grant missing");
		const token = verifyLocalMediaAssetGrant(
			restricted.uploadGrant.urlOrToken,
			"upload",
		);
		await storage.put({
			storageKey: token.storageKey,
			body: bytes,
			contentType: "image/png",
			checksumSha256: sha256Bytes(bytes),
		});
		await service.finalizeMediaAssetUpload(actorA, {
			assetId: restricted.assetId,
			uploadSessionId: restricted.uploadSessionId,
		});
		await service.linkMediaAssetToProject(actorA, {
			assetId: restricted.assetId,
			projectId: affiliateProject,
		});
	});
	const listed = await service.listMediaAssets(actorA, {
		limit: 2,
		archiveScope: "all",
	});
	assert(listed.items.length >= 2, "list must return media rows");
	assert(listed.nextCursor, "list must return an opaque cursor when paginated");
	const secondPage = await service.listMediaAssets(actorA, {
		limit: 2,
		archiveScope: "all",
		cursor: listed.nextCursor,
	});
	assert(
		!secondPage.items.some((item) =>
			listed.items.some((first) => first.id === item.id),
		),
		"cursor pagination must not repeat rows",
	);
	const searched = await service.listMediaAssets(actorA, {
		limit: 20,
		archiveScope: "all",
		search: "Hero%_Renamed",
		tag: "launch",
	});
	assert(
		searched.items.some((item) => item.id === prepared.assetId),
		"escaped display-name and tag search must find the renamed asset",
	);
	const archivedOnly = await service.listMediaAssets(actorA, {
		limit: 20,
		archiveScope: "archivedOnly",
	});
	assert(
		archivedOnly.items.some((item) => item.id === prepared.assetId),
		"archivedOnly filter must include archived assets",
	);
	const audioReady = await service.listMediaAssets(actorA, {
		limit: 20,
		archiveScope: "all",
		mediaType: "audio",
		status: "ready",
	});
	assert(
		audioReady.items.some((item) => item.mediaType === "audio"),
		"mediaType/status filters must narrow the library",
	);
	await expectRejected("Invalid cursor", () =>
		service.listMediaAssets(actorA, {
			limit: 20,
			cursor: "not-a-valid-cursor",
		}),
	);
	await expectRejected("Tampered token", async () =>
		verifyLocalMediaAssetGrant(`${uploadToken}x`, "upload"),
	);
	await expectRejected("Wrong-purpose token", async () =>
		verifyLocalMediaAssetGrant(uploadToken, "download"),
	);
	const expiredToken = createLocalMediaAssetGrant({
		purpose: "upload",
		workspaceId: workspaceA,
		assetId: prepared.assetId,
		storageKey: payload.storageKey,
		uploadSessionId: prepared.uploadSessionId,
		contentType: "image/png",
		byteSize: bytes.byteLength,
		strictByteSize: true,
		expiresAt: Date.now() - 1,
	});
	await expectRejected("Expired token", async () =>
		verifyLocalMediaAssetGrant(expiredToken, "upload"),
	);
	let mockedR2PresignCalls = 0;
	const mockedR2 = new R2MediaAssetStorage({
		async putObject() {
			throw new Error(
				"R2 object calls are forbidden in this acceptance harness",
			);
		},
		async getObject() {
			throw new Error(
				"R2 object calls are forbidden in this acceptance harness",
			);
		},
		async headObject() {
			throw new Error(
				"R2 object calls are forbidden in this acceptance harness",
			);
		},
		async deleteObject() {
			throw new Error(
				"R2 object calls are forbidden in this acceptance harness",
			);
		},
		async createPresignedUploadUrl() {
			mockedR2PresignCalls += 1;
			return "mocked-r2-upload-grant";
		},
		async createPresignedDownloadUrl() {
			mockedR2PresignCalls += 1;
			return "mocked-r2-download-grant";
		},
	});
	await mockedR2.createUploadGrant({
		storageKey: "media/v1/internal/mock-r2/asset.png",
		contentType: "image/png",
		byteSize: bytes.byteLength,
		expiresAt: new Date(Date.now() + 60_000),
	});
	await mockedR2.createDownloadGrant({
		storageKey: "media/v1/internal/mock-r2/asset.png",
		contentType: "image/png",
		expiresAt: new Date(Date.now() + 60_000),
	});
	assert(
		mockedR2PresignCalls === 2,
		"R2 grant seam must remain injected/mocked",
	);
	console.log(
		"Protected Media API/service matrix (prepare, local flow, finalize, list/get, download, links, rights, isolation, token security): PASS",
	);
} finally {
	restoreAuthSession?.();
	await pool.end();
	await rm(localRoot, { recursive: true, force: true });
}
