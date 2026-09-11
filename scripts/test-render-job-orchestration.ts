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
import type { CompositionBusinessPreflight } from "../packages/api/src/services/composition-preflight-service.ts";
import type { DbTransaction } from "../packages/api/src/services/fact-dependency-repository.ts";
import type { RenderWorkerDependencies } from "../packages/api/src/services/render-worker-service.ts";
import type {
	RenderAttemptExecutionSnapshot,
	RenderExecutionAdapter,
	TechnicalPreflightResult,
} from "../packages/core/src/index.ts";

const URL_ENV = "AFFICHANNEL_E2E_TEST_DATABASE_URL";
const CONFIRM_ENV = "AFFICHANNEL_E2E_TEST_DATABASE_CONFIRM";
const CONFIRM_VALUE = "DISPOSABLE_E2E_TEST_DB_CONFIRMED";

function requireAuthority() {
	const url = process.env[URL_ENV]?.trim();
	if (!url)
		throw new Error(`REFUSED: ${URL_ENV} is required; no fallback is allowed.`);
	if (process.env[CONFIRM_ENV] !== CONFIRM_VALUE)
		throw new Error(`REFUSED: ${CONFIRM_ENV} must equal ${CONFIRM_VALUE}.`);
	const parsed = new URL(url);
	if (
		!["postgres:", "postgresql:"].includes(parsed.protocol) ||
		parsed.hostname !== "127.0.0.1" ||
		parsed.pathname.length <= 1
	)
		throw new Error(`REFUSED: ${URL_ENV} must target PostgreSQL at 127.0.0.1.`);
	return { url, host: parsed.host, database: parsed.pathname.slice(1) };
}

const authority = requireAuthority();
process.env.NODE_ENV = "test";
process.env.SKIP_ENV_VALIDATION = "1";
process.env.AFFICHANNEL_E2E_TEST_DATABASE_URL = authority.url;
process.env.AFFICHANNEL_E2E_TEST_DATABASE_CONFIRM = CONFIRM_VALUE;
process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = authority.url;
process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM = "DISPOSABLE_DB_CONFIRMED";
for (const key of [
	"DATABASE_URL",
	"DATABASE_URL_DIRECT",
	"R2_ENDPOINT",
	"R2_BUCKET",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
])
	delete process.env[key];

const { createNodePostgresPool } = await import(
	"../packages/db/src/node-postgres-test-adapter.ts"
);
const { drizzle } = await import("drizzle-orm/node-postgres");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { eq } = await import("drizzle-orm");
const {
	buildCompositionInputV1,
	canonicalizeCompositionJson,
	compositionSemanticProjection,
	CompositionError,
	fingerprintOutputEncodingProfile,
	MP4_H264_AAC_V1,
	sha256Hex,
} = await import("@affichannel/core");
const {
	compositionVersion,
	db,
	project,
	renderArtifact,
	renderAttempt,
	renderJob,
	scriptGeneration,
	scriptVersion,
	user,
	workspace,
} = await import("../packages/db/src/index.ts");
const repository = await import(
	"../packages/api/src/services/render-job-repository.ts"
);
const worker = await import(
	"../packages/api/src/services/render-worker-service.ts"
);
const artifactRepository = await import(
	"../packages/api/src/services/render-artifact-repository.ts"
);
const orphanService = await import(
	"../packages/api/src/services/render-output-orphan-service.ts"
);
const { createRenderOutputStorageKey } = await import(
	"../packages/api/src/storage/render-output-storage.ts"
);
const { LocalRenderOutputStorage, R2RenderOutputStorage } = await import(
	"../packages/api/src/storage/render-output-storage.ts"
);
const {
	deterministicRenderOutputFixture,
	deterministicRenderOutputFixtureProvenance,
} = await import("../apps/web/src/features/render/render-output-fixture.ts");

async function expectRenderArtifactError(
	promise: Promise<unknown>,
	code: string,
) {
	try {
		await promise;
	} catch (error) {
		assert(
			typeof error === "object" &&
				error !== null &&
				(error as { code?: unknown }).code === code,
			`Expected RenderArtifactError ${code}.`,
		);
		return;
	}
	throw new Error(`Expected RenderArtifactError ${code}.`);
}

const allowedBusinessGate = async (
	_transaction: DbTransaction,
	_actor: { workspaceId: string; userId: string },
	compositionVersionId: string,
): Promise<CompositionBusinessPreflight> => ({
	compositionVersionId,
	currentness: { state: "CURRENT" as const },
	authorization: {
		allowed: true as const,
		reasonCode: "FACT_LOCK_NOT_REQUIRED",
		factLockRequirement: "NOT_REQUIRED" as const,
		factLockOutcome: "NOT_EVALUATED" as const,
	},
	applicability: null,
	factLock: {
		requirement: "NOT_REQUIRED" as const,
		outcome: "NOT_EVALUATED" as const,
		evidence: null,
	},
});

function makeBusinessGate(
	currentness: CompositionBusinessPreflight["currentness"],
	authorization: CompositionBusinessPreflight["authorization"],
) {
	return async (
		_transaction: DbTransaction,
		_actor: { workspaceId: string; userId: string },
		compositionVersionId: string,
	): Promise<CompositionBusinessPreflight> => ({
		compositionVersionId,
		currentness,
		authorization,
		applicability: null,
		factLock: {
			requirement: "NOT_REQUIRED",
			outcome: "NOT_EVALUATED",
			evidence: null,
		},
	});
}

function makeTechnicalPreflight(
	compositionVersionId: string,
	compositionFingerprint: string,
	status: TechnicalPreflightResult["status"] = "VALID",
): TechnicalPreflightResult {
	const technicalManifest = {
		schemaVersion: "composition-technical-manifest.v1" as const,
		compositionFingerprint,
		media: [],
		voice: [],
		fonts: [],
		timing: [],
	};
	return {
		status,
		retryable: status === "UNKNOWN",
		reasonCode: status === "VALID" ? null : "DEPENDENCY_READ_UNAVAILABLE",
		compositionVersionId,
		compositionFingerprint,
		issues: status === "VALID" ? [] : [`Technical ${status}`],
		...(status === "VALID" ? { technicalManifest } : {}),
	};
}

type Journal = { entries: Array<{ idx: number; tag: string }> };
const migrationsRoot = resolve("packages/db/src/migrations");
const temporaryFolders: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function bounded<T>(promise: Promise<T>, label: string) {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`${label} exceeded the 5s race bound.`)),
					5_000,
				);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

async function migrationFolder() {
	const journal = JSON.parse(
		await readFile(join(migrationsRoot, "meta", "_journal.json"), "utf8"),
	) as Journal;
	const folder = await mkdtemp(
		join(tmpdir(), "affichannel-render-migrations-"),
	);
	temporaryFolders.push(folder);
	await mkdir(join(folder, "meta"), { recursive: true });
	await writeFile(
		join(folder, "meta", "_journal.json"),
		JSON.stringify(journal, null, 2),
		"utf8",
	);
	for (const entry of journal.entries)
		await copyFile(
			join(migrationsRoot, `${entry.tag}.sql`),
			join(folder, `${entry.tag}.sql`),
		);
	return folder;
}

function source(workspaceId: string, projectId: string, hash: string) {
	return {
		workspaceId,
		projectId,
		script: {
			semantic: {
				schemaVersion: "script-draft.v2" as const,
				language: "vi-VN",
				hookVariants: [{ key: "hook-a", text: "Một hook" }],
				selectedHookKey: "hook-a",
				voiceoverSegments: [{ key: "voice-a", text: "Một đoạn thoại" }],
				scenes: [
					{
						order: 1,
						durationSeconds: 15,
						visualDirection: "Cận cảnh",
						onScreenText: "Xin chào",
						voiceoverSegmentKeys: ["voice-a"],
					},
				],
				cta: { text: "Mua ngay" },
				caption: "Mô tả",
				hashtags: ["#demo"],
				disclosure: "",
				claims: [],
				claimsSourceRevision: 1,
				claimsStatus: "current" as const,
			},
			provenance: {
				scriptVersionId: "sv1",
				revision: 1,
				status: "draft" as const,
				versionNumber: null,
			},
		},
		voice: {
			segments: [
				{
					segmentKey: "voice-a",
					semantic: {
						checksum: hash,
						mimeType: "audio/mpeg" as const,
						byteSize: 10,
						sourceSampleRate: 48000,
						sourceSampleCount: "24000",
						durationMs: 500,
					},
					provenance: {
						artifactId: "va1",
						sourceScriptVersionId: "sv1",
						sourceScriptRevision: 1,
						textSnapshot: "Một đoạn thoại",
						textHash: hash,
						configId: "vc1",
						configRevision: 1,
						provider: "apikeyfun",
						voiceId: "vi-1",
						language: "vi-VN",
						speed: 1,
						storageProvider: "local" as const,
					},
				},
			],
		},
		media: [
			{
				dependencyKey: "media-background",
				role: "background",
				semantic: {
					mediaType: "image" as const,
					mimeType: "image/png" as const,
					checksumSha256: hash,
					byteSize: 100,
					width: 1080,
					height: 1920,
					durationMs: null,
				},
				provenance: { mediaAssetId: "ma1", workspaceId, projectId },
			},
		],
		fonts: {
			bundleId: "affichannel-fonts-v1",
			faces: [400, 600, 700].map((weight) => ({
				family: "Noto Sans" as const,
				weight: weight as 400 | 600 | 700,
				style: "normal" as const,
				fontId: `noto-${weight}`,
				contentSha256: hash,
			})),
		},
		config: {
			semantic: {
				compositionProfileId: "vertical-standard-v1" as const,
				outputRules: {
					language: "vi-VN",
					aspectRatio: "9:16" as const,
					subtitleSafeArea: "standard" as const,
					claimLimit: 3,
					requireFinalCta: true,
				},
			},
			provenance: { outputRulesRevision: null },
		},
		timeline: {
			fps: { numerator: 30, denominator: 1 },
			totalFrames: "450",
			scenes: [
				{
					sceneKey: "scene-1",
					order: 1,
					startFrame: "0",
					durationFrames: "450",
				},
			],
		},
		sceneComposition: {
			version: "scene-composition.v1" as const,
			scenes: [
				{
					sceneKey: "scene-1",
					layers: [
						{
							kind: "MEDIA" as const,
							layerId: "layer-media",
							zIndex: 0,
							startOffsetFrame: "0",
							durationFrames: "450",
							box: { xPx: 0, yPx: 0, widthPx: 1080, heightPx: 1920 },
							opacityBasisPoints: 10000,
							sourceMediaKey: "media-background",
							fit: "COVER" as const,
							objectPositionXBasisPoints: 5000,
							objectPositionYBasisPoints: 5000,
						},
						{
							kind: "TEXT" as const,
							layerId: "layer-text",
							zIndex: 1,
							startOffsetFrame: "0",
							durationFrames: "450",
							box: { xPx: 90, yPx: 120, widthPx: 900, heightPx: 120 },
							opacityBasisPoints: 10000,
							text: "Xin chào",
							fontStableId: "noto-700",
							fontWeight: 700 as const,
							fontStyle: "normal" as const,
							fontSizePx: 64,
							lineHeightPx: 80,
							textAlign: "CENTER" as const,
							colorRgba: { r: 255, g: 255, b: 255, a: 255 },
							maxLines: 2,
							textLayoutVersion: "affichannel-text-layout-v1" as const,
						},
					],
				},
			],
			audioTracks: [
				{
					trackId: "track-voice-a",
					sourceVoiceKey: "voice-a",
					startFrame: "0",
					durationFrames: "15",
					endFrame: "15",
					trimStartSample: "0",
					trimEndSample: "24000",
					gainMilliDb: 0,
					panBasisPoints: 0,
					fadeInSamples: "0",
					fadeOutSamples: "0",
				},
			],
		},
	};
}

const pool = createNodePostgresPool(authority.url);
try {
	const identity = await pool.query<{ database: string }>(
		"select current_database() as database",
	);
	console.log(
		`Disposable identity: database=${identity.rows[0]?.database}; host=${authority.host}; expected=${authority.database}`,
	);
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
	const folder = await migrationFolder();
	await migrate(drizzle(pool), { migrationsFolder: folder });

	const workspaceId = `render-ws-${randomUUID()}`;
	const userId = `render-user-${randomUUID()}`;
	const projectId = `render-project-${randomUUID()}`;
	const compositionVersionId = `render-cv-${randomUUID()}`;
	const hash = "a".repeat(64);
	const built = await buildCompositionInputV1(
		source(workspaceId, projectId, hash),
	);
	assert(built.ok, "Composition fixture must be buildable.");
	await db
		.insert(workspace)
		.values({ id: workspaceId, name: "Render orchestration fixture" });
	await db.insert(user).values({
		id: userId,
		name: "Render fixture",
		email: `${userId}@example.test`,
		emailVerified: true,
	});
	await db.insert(project).values({
		id: projectId,
		workspaceId,
		name: "Render fixture",
		productId: null,
		contentType: "ORGANIC",
		creationPath: "SCRIPTED",
		contentFormatKey: "script.v1",
		contentFormatVersion: 1,
		currentStepKey: "video",
		createdByUserId: userId,
	});
	await db.insert(scriptGeneration).values({
		id: `render-gen-${randomUUID()}`,
		workspaceId,
		projectId,
		createdByUserId: userId,
		idempotencyKey: `render-gen-${randomUUID()}`,
		requestHash: hash,
		parentGenerationId: null,
		mode: "full",
		provider: "fixture",
		model: "fixture",
		promptVersion: "fixture",
		outputSchemaVersion: "script-draft.v2",
		inputSnapshotJson: {},
		inputHash: hash,
		promptHash: hash,
		status: "pending",
	});
	const seedNow = new Date();
	const [generation] = await db
		.select({ id: scriptGeneration.id })
		.from(scriptGeneration)
		.where(eq(scriptGeneration.projectId, projectId))
		.limit(1);
	assert(generation, "ScriptGeneration fixture must exist.");
	await db.insert(scriptVersion).values({
		id: "sv1",
		workspaceId,
		projectId,
		sourceGenerationId: generation.id,
		status: "draft",
		versionNumber: null,
		editableSnapshotJson: source(workspaceId, projectId, hash).script.semantic,
		revision: 1,
		restoredFromVersionId: null,
		createdByUserId: userId,
		createdAt: seedNow,
		updatedAt: seedNow,
		savedAt: null,
	});
	await db.insert(compositionVersion).values({
		id: compositionVersionId,
		workspaceId,
		projectId,
		schemaVersion: "composition-input.v1",
		compositionInputJson: built.input,
		compositionFingerprint: built.fingerprint,
		sourceScriptVersionId: "sv1",
		sourceScriptRevision: 1,
		createdByUserId: userId,
		createdAt: new Date(),
	});
	const testRenderCompositionInput = structuredClone(built.input);
	testRenderCompositionInput.timeline.totalFrames = "1";
	testRenderCompositionInput.timeline.scenes =
		testRenderCompositionInput.timeline.scenes.map((scene, index) => ({
			...scene,
			startFrame: index === 0 ? "0" : "1",
			durationFrames: index === 0 ? "1" : "0",
		}));
	testRenderCompositionInput.sceneComposition.scenes =
		testRenderCompositionInput.sceneComposition.scenes.map((scene) => ({
			...scene,
			layers: scene.layers.map((layer) => ({
				...layer,
				startOffsetFrame: "0",
				durationFrames: "1",
			})),
		}));
	testRenderCompositionInput.sceneComposition.audioTracks =
		testRenderCompositionInput.sceneComposition.audioTracks.map((track) => ({
			...track,
			startFrame: "0",
			durationFrames: "1",
			endFrame: "1",
		}));
	const testRenderCompositionFingerprint = await sha256Hex(
		canonicalizeCompositionJson(
			compositionSemanticProjection(testRenderCompositionInput),
		),
	);
	const testRenderCompositionVersionId = `render-cv-21d-${randomUUID()}`;
	await db.insert(compositionVersion).values({
		id: testRenderCompositionVersionId,
		workspaceId,
		projectId,
		schemaVersion: "composition-input.v1",
		compositionInputJson: testRenderCompositionInput,
		compositionFingerprint: testRenderCompositionFingerprint,
		sourceScriptVersionId: "sv1",
		sourceScriptRevision: 1,
		createdByUserId: userId,
		createdAt: new Date(),
	});

	const profile = {
		...MP4_H264_AAC_V1,
		videoBitrateKbps: 4000,
		videoCrf: 23,
		audioBitrateKbps: 128,
		keyframeIntervalFrames: 60,
	};
	const profileFingerprint = await fingerprintOutputEncodingProfile(profile);
	const requestSpec = {
		schemaVersion: "render-request.v1" as const,
		compositionVersionId,
		compositionFingerprint: built.fingerprint,
		outputEncodingProfile: profile,
		outputEncodingProfileFingerprint: profileFingerprint,
		outputContractVersion: "output.v1",
	};
	const firstInsertRaceVersionId = `render-cv-${randomUUID()}`;
	await db.insert(compositionVersion).values({
		id: firstInsertRaceVersionId,
		workspaceId,
		projectId,
		schemaVersion: "composition-input.v1",
		compositionInputJson: built.input,
		compositionFingerprint: built.fingerprint,
		sourceScriptVersionId: "sv1",
		sourceScriptRevision: 1,
		createdByUserId: userId,
		createdAt: new Date(),
	});
	const firstInsertRaceSpec = {
		...requestSpec,
		compositionVersionId: firstInsertRaceVersionId,
	};
	const firstInsertRace = await Promise.all(
		Array.from({ length: 16 }, (_, index) =>
			repository.createRenderJob({
				actor: { workspaceId, userId },
				projectId,
				requestSpec: firstInsertRaceSpec,
				idempotencyKey: `render-first-insert-${index}-${randomUUID()}`,
			}),
		),
	);
	assert(
		new Set(firstInsertRace.map((item) => item.id)).size === 1,
		"A true first-insert race must persist and return one logical Job.",
	);
	const sameKeyRaceVersionId = `render-cv-${randomUUID()}`;
	await db.insert(compositionVersion).values({
		id: sameKeyRaceVersionId,
		workspaceId,
		projectId,
		schemaVersion: "composition-input.v1",
		compositionInputJson: built.input,
		compositionFingerprint: built.fingerprint,
		sourceScriptVersionId: "sv1",
		sourceScriptRevision: 1,
		createdByUserId: userId,
		createdAt: new Date(),
	});
	const sameKeyRaceSpec = {
		...requestSpec,
		compositionVersionId: sameKeyRaceVersionId,
	};
	const sameKeyRaceIdempotencyKey = `render-same-key-${randomUUID()}`;
	const sameKeyRace = await Promise.all(
		Array.from({ length: 16 }, () =>
			repository.createRenderJob({
				actor: { workspaceId, userId },
				projectId,
				requestSpec: sameKeyRaceSpec,
				idempotencyKey: sameKeyRaceIdempotencyKey,
			}),
		),
	);
	assert(
		new Set(sameKeyRace.map((item) => item.id)).size === 1,
		"Same-key same-identity first-insert race must return one Job ID to every caller.",
	);
	const sameKeyPersisted = await db
		.select()
		.from(renderJob)
		.where(eq(renderJob.compositionVersionId, sameKeyRaceVersionId));
	assert(
		sameKeyPersisted.length === 1 &&
			sameKeyPersisted[0]?.id === sameKeyRace[0]?.id,
		"Same-key same-identity first-insert race must persist exactly one Job.",
	);
	await db
		.update(renderJob)
		.set({
			status: "FAILED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderJob.id, sameKeyRace[0]?.id ?? "missing"));
	const conflictingIdempotencyKey = `render-conflicting-idem-${randomUUID()}`;
	const conflictingProfile = { ...profile, videoBitrateKbps: 4001 };
	const conflictingSpec = {
		...requestSpec,
		outputEncodingProfile: conflictingProfile,
		outputEncodingProfileFingerprint:
			await fingerprintOutputEncodingProfile(conflictingProfile),
	};
	const conflictingRace = await Promise.allSettled([
		repository.createRenderJob({
			actor: { workspaceId, userId },
			projectId,
			requestSpec,
			idempotencyKey: conflictingIdempotencyKey,
		}),
		repository.createRenderJob({
			actor: { workspaceId, userId },
			projectId,
			requestSpec: conflictingSpec,
			idempotencyKey: conflictingIdempotencyKey,
		}),
	]);
	assert(
		conflictingRace.filter((result) => result.status === "fulfilled").length ===
			1 &&
			conflictingRace.filter(
				(result) =>
					result.status === "rejected" &&
					result.reason instanceof repository.RenderJobError &&
					result.reason.code === "RENDER_IDEMPOTENCY_CONFLICT",
			).length === 1,
		"A true same-key conflicting race must have one winner and one typed conflict.",
	);
	await db
		.update(renderJob)
		.set({
			status: "FAILED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderJob.id, firstInsertRace[0]?.id ?? "missing"));
	const conflictingWinner = conflictingRace.find(
		(
			result,
		): result is PromiseFulfilledResult<
			Awaited<ReturnType<typeof repository.createRenderJob>>
		> => result.status === "fulfilled",
	);
	if (conflictingWinner)
		await db
			.update(renderJob)
			.set({
				status: "FAILED",
				errorCode: "TEST_CLEANUP",
				finishedAt: new Date(),
			})
			.where(eq(renderJob.id, conflictingWinner.value.id));
	const job = await repository.createRenderJob({
		actor: { workspaceId, userId },
		projectId,
		requestSpec,
		idempotencyKey: `render-idem-${randomUUID()}`,
	});
	try {
		await repository.createRenderJob({
			actor: { workspaceId, userId },
			projectId,
			requestSpec,
			operation: "RENDER_AGAIN",
			sourceRenderJobId: `missing-source-${randomUUID()}`,
			idempotencyKey: `render-again-invalid-${randomUUID()}`,
		});
		throw new Error("Bogus RENDER_AGAIN source must be rejected.");
	} catch (error) {
		assert(
			error instanceof repository.RenderJobError &&
				(error.code === "RENDER_AGAIN_SOURCE_NOT_COMPLETED" ||
					error.code === "RENDER_AGAIN_SOURCE_IDENTITY_MISMATCH"),
			"RENDER_AGAIN must validate its source before active deduplication.",
		);
	}
	const completedSourceProfile = { ...profile, videoBitrateKbps: 4050 };
	const completedSourceSpec = {
		...requestSpec,
		outputEncodingProfile: completedSourceProfile,
		outputEncodingProfileFingerprint: await fingerprintOutputEncodingProfile(
			completedSourceProfile,
		),
	};
	const completedSource = await repository.createRenderJob({
		actor: { workspaceId, userId },
		projectId,
		requestSpec: completedSourceSpec,
		idempotencyKey: `render-source-${randomUUID()}`,
	});
	await db
		.update(renderJob)
		.set({ status: "COMPLETED", finishedAt: new Date() })
		.where(eq(renderJob.id, completedSource.id));
	try {
		await repository.createRenderJob({
			actor: { workspaceId, userId },
			projectId,
			requestSpec,
			operation: "RENDER_AGAIN",
			sourceRenderJobId: completedSource.id,
			idempotencyKey: `render-again-incompatible-${randomUUID()}`,
		});
		throw new Error("Incompatible RENDER_AGAIN source must be rejected.");
	} catch (error) {
		assert(
			error instanceof repository.RenderJobError &&
				error.code === "RENDER_AGAIN_SOURCE_IDENTITY_MISMATCH",
			"RENDER_AGAIN must validate exact source request compatibility.",
		);
	}
	const duplicate = await repository.createRenderJob({
		actor: { workspaceId, userId },
		projectId,
		requestSpec,
		idempotencyKey: `render-idem-${randomUUID()}`,
	});
	assert(
		duplicate.id === job.id,
		"Active different-key dedup must return the existing Job.",
	);
	const conflictProfile = { ...profile, videoBitrateKbps: 4001 };
	try {
		await repository.createRenderJob({
			actor: { workspaceId, userId },
			projectId,
			requestSpec: {
				...requestSpec,
				outputEncodingProfile: conflictProfile,
				outputEncodingProfileFingerprint:
					await fingerprintOutputEncodingProfile(conflictProfile),
			},
			idempotencyKey: job.idempotencyKey,
		});
		throw new Error(
			"Changed request must conflict on the same idempotency key.",
		);
	} catch (error) {
		assert(
			error instanceof repository.RenderJobError &&
				error.code === "RENDER_IDEMPOTENCY_CONFLICT",
			"Same-key changed request must return IDEMPOTENCY_CONFLICT.",
		);
	}
	const concurrent = await Promise.all(
		Array.from({ length: 16 }, (_, index) =>
			repository.createRenderJob({
				actor: { workspaceId, userId },
				projectId,
				requestSpec,
				idempotencyKey: `render-concurrent-${index}-${randomUUID()}`,
			}),
		),
	);
	assert(
		concurrent.every((item) => item.id === job.id),
		"Concurrent active dedup must have one Job identity.",
	);
	try {
		await repository.createRenderJob({
			actor: { workspaceId, userId },
			projectId,
			requestSpec: {
				...requestSpec,
				outputEncodingProfile: MP4_H264_AAC_V1,
				outputEncodingProfileFingerprint: hash,
			},
			idempotencyKey: `render-invalid-${randomUUID()}`,
		});
		throw new Error("Incomplete output profile must be rejected.");
	} catch (error) {
		assert(
			error instanceof repository.RenderJobError &&
				error.code === "OUTPUT_ENCODING_PROFILE_INCOMPLETE",
			"Incomplete output profile rejection code mismatch.",
		);
	}

	const claimed = await Promise.all(
		Array.from({ length: 8 }, (_, index) =>
			repository.claimNextRenderAttempt(workspaceId, `worker-${index}`),
		),
	);
	assert(
		claimed.filter(Boolean).length === 1,
		"Exactly one worker may claim one queued Job.",
	);
	const firstClaim = claimed.find((item): item is NonNullable<typeof item> =>
		Boolean(item),
	);
	assert(firstClaim, "A claim winner is required for lease tests.");
	const attemptsAfterClaim = await db
		.select()
		.from(renderAttempt)
		.where(eq(renderAttempt.renderJobId, job.id));
	assert(
		attemptsAfterClaim.length === 1 &&
			attemptsAfterClaim[0]?.attemptNumber === 1,
		"Claim must create Attempt #1.",
	);
	await db
		.update(renderAttempt)
		.set({ leaseExpiresAt: new Date(Date.now() - 1000) })
		.where(eq(renderAttempt.id, firstClaim.attempt.id));
	const reclaimed = await repository.claimNextRenderAttempt(
		workspaceId,
		"worker-retry",
	);
	assert(
		reclaimed?.attempt.attemptNumber === 2,
		"Pre-execution lease loss must requeue a new Attempt.",
	);
	const fenced = (
		await db
			.select()
			.from(renderAttempt)
			.where(eq(renderAttempt.id, firstClaim.attempt.id))
			.limit(1)
	)[0];
	assert(fenced, "The original attempt must remain readable.");
	assert(
		fenced.status === "FENCED",
		"Pre-execution lease loss must fence the old Attempt.",
	);
	await db
		.update(renderAttempt)
		.set({
			authorizedAt: new Date(),
			technicalPreflightVersion: "composition-technical-preflight.v1",
			technicalPreflightStatus: "VALID",
			technicalEvidenceFingerprint: hash,
			technicalCheckedAt: new Date(),
		})
		.where(eq(renderAttempt.id, reclaimed.attempt.id));
	assert(
		!(await repository.markExecutionStarted({
			jobId: job.id,
			attemptId: reclaimed.attempt.id,
			attemptNumber: reclaimed.attempt.attemptNumber + 1,
			leaseOwner: "worker-retry",
		})),
		"Wrong attemptNumber must fail execution-start CAS.",
	);
	assert(
		await repository.markExecutionStarted({
			jobId: job.id,
			attemptId: reclaimed.attempt.id,
			attemptNumber: reclaimed.attempt.attemptNumber,
			leaseOwner: "worker-retry",
		}),
		"Execution marker CAS must succeed after authorization.",
	);
	await db
		.update(renderAttempt)
		.set({ leaseExpiresAt: new Date(Date.now() - 1000) })
		.where(eq(renderAttempt.id, reclaimed.attempt.id));
	assert(
		(await repository.claimNextRenderAttempt(
			workspaceId,
			"worker-after-start",
		)) === undefined,
		"Post-execution lease loss must not retry the old Job.",
	);
	assert(
		!(await repository.markExecutionStarted({
			jobId: job.id,
			attemptId: reclaimed.attempt.id,
			attemptNumber: reclaimed.attempt.attemptNumber,
			leaseOwner: "worker-retry",
		})),
		"Stale execution-start CAS must be rejected.",
	);
	assert(
		!(await repository.markIndeterminate({
			attemptId: reclaimed.attempt.id,
			jobId: job.id,
			attemptNumber: reclaimed.attempt.attemptNumber,
			leaseOwner: "worker-retry",
			errorCode: "STALE_STATE_MUTATION",
		})),
		"Stale state mutation must be rejected.",
	);
	const indeterminateJob = await repository.findRenderJob(
		{ workspaceId, userId },
		job.id,
	);
	assert(
		indeterminateJob?.status === "INDETERMINATE",
		"Post-execution lease loss must make Job INDETERMINATE.",
	);

	const secondProfile = { ...profile, videoBitrateKbps: 4100 };
	const secondSpec = {
		...requestSpec,
		outputEncodingProfile: secondProfile,
		outputEncodingProfileFingerprint:
			await fingerprintOutputEncodingProfile(secondProfile),
	};
	const secondJob = await repository.createRenderJob({
		actor: { workspaceId, userId },
		projectId,
		requestSpec: secondSpec,
		idempotencyKey: `render-second-${randomUUID()}`,
	});
	const secondClaim = await repository.claimNextRenderAttempt(
		workspaceId,
		"worker-heartbeat",
	);
	assert(
		secondClaim?.job.id === secondJob.id,
		"Second distinct request must be claimable.",
	);
	assert(
		!(await repository.heartbeatRenderAttempt({
			attemptId: secondClaim.attempt.id,
			jobId: secondJob.id,
			attemptNumber: secondClaim.attempt.attemptNumber + 1,
			leaseOwner: "worker-heartbeat",
		})),
		"Wrong attemptNumber heartbeat must be fenced.",
	);
	assert(
		await repository.heartbeatRenderAttempt({
			attemptId: secondClaim.attempt.id,
			jobId: secondJob.id,
			attemptNumber: secondClaim.attempt.attemptNumber,
			leaseOwner: "worker-heartbeat",
		}),
		"Owned heartbeat must extend the lease.",
	);
	await db
		.update(renderAttempt)
		.set({ leaseExpiresAt: new Date(Date.now() - 1000) })
		.where(eq(renderAttempt.id, secondClaim.attempt.id));
	const foreignClaim = await repository.claimNextRenderAttempt(
		`unrelated-workspace-${randomUUID()}`,
		"worker-foreign",
	);
	assert(
		foreignClaim === undefined,
		"A worker must not claim another workspace's Job.",
	);
	const stillRunningBeforeOwnerExpiry = (
		await db
			.select({ status: renderAttempt.status })
			.from(renderAttempt)
			.where(eq(renderAttempt.id, secondClaim.attempt.id))
			.limit(1)
	)[0];
	assert(
		stillRunningBeforeOwnerExpiry?.status === "RUNNING",
		"Foreign workspace claim must not expire this workspace's Attempt.",
	);
	assert(
		!(await repository.heartbeatRenderAttempt({
			attemptId: secondClaim.attempt.id,
			jobId: secondJob.id,
			attemptNumber: secondClaim.attempt.attemptNumber,
			leaseOwner: "worker-heartbeat",
		})),
		"Expired heartbeat must be rejected.",
	);
	await db
		.update(renderAttempt)
		.set({
			status: "FENCED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderAttempt.id, secondClaim.attempt.id));
	await db
		.update(renderJob)
		.set({
			status: "FAILED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderJob.id, secondJob.id));

	const wrongAttemptNumberJob = await repository.createRenderJob({
		actor: { workspaceId, userId },
		projectId,
		requestSpec: {
			...requestSpec,
			outputEncodingProfile: { ...profile, videoBitrateKbps: 4150 },
			outputEncodingProfileFingerprint: await fingerprintOutputEncodingProfile({
				...profile,
				videoBitrateKbps: 4150,
			}),
		},
		idempotencyKey: `render-wrong-attempt-number-${randomUUID()}`,
	});
	const wrongAttemptNumberClaim = await repository.claimNextRenderAttempt(
		workspaceId,
		"worker-wrong-attempt-number",
	);
	assert(
		wrongAttemptNumberClaim?.job.id === wrongAttemptNumberJob.id,
		"Wrong-attemptNumber fixture must be claimable.",
	);
	const wrongAttemptNumber = wrongAttemptNumberClaim.attempt.attemptNumber + 1;
	assert(
		!(await repository.recordTechnicalEvidence({
			attemptId: wrongAttemptNumberClaim.attempt.id,
			jobId: wrongAttemptNumberJob.id,
			attemptNumber: wrongAttemptNumber,
			leaseOwner: "worker-wrong-attempt-number",
			status: "VALID",
			reasonCode: null,
			technicalEvidenceFingerprint: hash,
		})),
		"Wrong attemptNumber technical evidence must be rejected.",
	);
	const untouchedAttemptAfterEvidence = (
		await db
			.select()
			.from(renderAttempt)
			.where(eq(renderAttempt.id, wrongAttemptNumberClaim.attempt.id))
			.limit(1)
	)[0];
	assert(
		untouchedAttemptAfterEvidence?.technicalPreflightStatus === null,
		"Wrong attemptNumber technical evidence must not mutate the Attempt.",
	);
	await db
		.update(renderAttempt)
		.set({
			technicalPreflightVersion: "composition-technical-preflight.v1",
			technicalPreflightStatus: "VALID",
			technicalEvidenceFingerprint: hash,
			technicalCheckedAt: new Date(),
		})
		.where(eq(renderAttempt.id, wrongAttemptNumberClaim.attempt.id));
	const wrongAuthorization = await repository.authorizeAttempt({
		actor: { workspaceId, userId },
		jobId: wrongAttemptNumberJob.id,
		attemptId: wrongAttemptNumberClaim.attempt.id,
		attemptNumber: wrongAttemptNumber,
		leaseOwner: "worker-wrong-attempt-number",
		technicalEvidenceFingerprint: hash,
		businessGate: (transaction) =>
			allowedBusinessGate(
				transaction,
				{ workspaceId, userId },
				compositionVersionId,
			),
	});
	assert(
		wrongAuthorization.kind === "NOT_CLAIMED",
		"Wrong attemptNumber final authorization must be rejected.",
	);
	assert(
		!(await repository.failTechnical({
			attemptId: wrongAttemptNumberClaim.attempt.id,
			jobId: wrongAttemptNumberJob.id,
			attemptNumber: wrongAttemptNumber,
			leaseOwner: "worker-wrong-attempt-number",
			errorCode: "WRONG_ATTEMPT_NUMBER_FAILURE",
		})),
		"Wrong attemptNumber failure transition must be rejected.",
	);
	assert(
		!(await repository.fenceAndRequeue({
			attemptId: wrongAttemptNumberClaim.attempt.id,
			jobId: wrongAttemptNumberJob.id,
			attemptNumber: wrongAttemptNumber,
			leaseOwner: "worker-wrong-attempt-number",
			errorCode: "WRONG_ATTEMPT_NUMBER_REQUEUE",
		})),
		"Wrong attemptNumber fence/requeue transition must be rejected.",
	);
	assert(
		!(await repository.markIndeterminate({
			attemptId: wrongAttemptNumberClaim.attempt.id,
			jobId: wrongAttemptNumberJob.id,
			attemptNumber: wrongAttemptNumber,
			leaseOwner: "worker-wrong-attempt-number",
			errorCode: "WRONG_ATTEMPT_NUMBER_INDETERMINATE",
		})),
		"Wrong attemptNumber indeterminate transition must be rejected.",
	);
	const wrongAttemptNumberJobState = await repository.findRenderJob(
		{ workspaceId, userId },
		wrongAttemptNumberJob.id,
	);
	const wrongAttemptNumberAttemptState = (
		await db
			.select()
			.from(renderAttempt)
			.where(eq(renderAttempt.id, wrongAttemptNumberClaim.attempt.id))
			.limit(1)
	)[0];
	assert(
		wrongAttemptNumberJobState?.status === "RUNNING" &&
			wrongAttemptNumberAttemptState?.status === "RUNNING" &&
			wrongAttemptNumberAttemptState.authorizedAt === null &&
			wrongAttemptNumberAttemptState.executionStartedAt === null,
		"Wrong attemptNumber matrix must not mutate Job or Attempt state.",
	);
	await db
		.update(renderAttempt)
		.set({
			status: "FENCED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderAttempt.id, wrongAttemptNumberClaim.attempt.id));
	await db
		.update(renderJob)
		.set({
			status: "FAILED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderJob.id, wrongAttemptNumberJob.id));

	const blockedProfile = { ...profile, videoBitrateKbps: 4200 };
	const blockedJob = await repository.createRenderJob({
		actor: { workspaceId, userId },
		projectId,
		requestSpec: {
			...requestSpec,
			outputEncodingProfile: blockedProfile,
			outputEncodingProfileFingerprint:
				await fingerprintOutputEncodingProfile(blockedProfile),
		},
		idempotencyKey: `render-blocked-${randomUUID()}`,
	});
	const blockedClaim = await repository.claimNextRenderAttempt(
		workspaceId,
		"worker-blocked",
	);
	assert(
		blockedClaim?.job.id === blockedJob.id,
		"Blocked-path fixture must be claimable.",
	);
	await db
		.update(renderAttempt)
		.set({
			status: "FENCED",
			errorCode: "BUSINESS_BLOCKED",
			finishedAt: new Date(),
		})
		.where(eq(renderAttempt.id, blockedClaim.attempt.id));
	await db
		.update(renderJob)
		.set({
			status: "BLOCKED",
			reasonCode: "BUSINESS_BLOCKED",
			errorCode: "BUSINESS_BLOCKED",
			finishedAt: null,
		})
		.where(eq(renderJob.id, blockedJob.id));
	const requeueOutcome = await repository.requeueBlockedRenderJob(
		{ workspaceId, userId },
		blockedJob.id,
		allowedBusinessGate,
	);
	assert(
		requeueOutcome.kind === "QUEUED",
		"A corrected business-blocked Job must have an explicit requeue path.",
	);
	const blockedReclaimed = await repository.claimNextRenderAttempt(
		workspaceId,
		"worker-blocked-retry",
	);
	assert(
		blockedReclaimed?.job.id === blockedJob.id &&
			blockedReclaimed.attempt.attemptNumber === 2 &&
			blockedReclaimed.attempt.outputReservationId !==
				blockedClaim.attempt.outputReservationId,
		"Blocked requeue must create a new Attempt and reservation.",
	);
	await db
		.update(renderAttempt)
		.set({
			status: "FENCED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderAttempt.id, blockedReclaimed.attempt.id));
	await db
		.update(renderJob)
		.set({
			status: "FAILED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderJob.id, blockedJob.id));

	async function createBlockedFixture(label: string, bitrate: number) {
		const fixtureProfile = { ...profile, videoBitrateKbps: bitrate };
		const fixture = await repository.createRenderJob({
			actor: { workspaceId, userId },
			projectId,
			requestSpec: {
				...requestSpec,
				outputEncodingProfile: fixtureProfile,
				outputEncodingProfileFingerprint:
					await fingerprintOutputEncodingProfile(fixtureProfile),
			},
			idempotencyKey: `render-blocked-${label}-${randomUUID()}`,
		});
		const claimedFixture = await repository.claimNextRenderAttempt(
			workspaceId,
			`worker-blocked-${label}`,
		);
		assert(
			claimedFixture?.job.id === fixture.id,
			`${label}: blocked fixture must be claimable.`,
		);
		await db
			.update(renderAttempt)
			.set({
				status: "FENCED",
				errorCode: "BUSINESS_BLOCKED",
				finishedAt: new Date(),
			})
			.where(eq(renderAttempt.id, claimedFixture.attempt.id));
		await db
			.update(renderJob)
			.set({
				status: "BLOCKED",
				reasonCode: "BUSINESS_BLOCKED",
				errorCode: "BUSINESS_BLOCKED",
				finishedAt: null,
			})
			.where(eq(renderJob.id, fixture.id));
		return { fixture, claimedFixture };
	}

	const stillBlockedFixture = await createBlockedFixture("still-blocked", 4250);
	const stillBlockedOutcome = await repository.requeueBlockedRenderJob(
		{ workspaceId, userId },
		stillBlockedFixture.fixture.id,
		makeBusinessGate(
			{ state: "CURRENT" },
			{
				allowed: false,
				reasonCode: "FACT_LOCK_BLOCKED",
				factLockRequirement: "REQUIRED",
				factLockOutcome: "BLOCKED",
			},
		),
	);
	assert(
		stillBlockedOutcome.kind === "BLOCKED" &&
			(
				await repository.findRenderJob(
					{ workspaceId, userId },
					stillBlockedFixture.fixture.id,
				)
			)?.status === "BLOCKED" &&
			(
				await db
					.select()
					.from(renderAttempt)
					.where(eq(renderAttempt.renderJobId, stillBlockedFixture.fixture.id))
			).length === 1,
		"CURRENT plus still-blocked must remain BLOCKED without a new Attempt.",
	);

	const staleFixture = await createBlockedFixture("stale", 4260);
	const staleRequeueOutcome = await repository.requeueBlockedRenderJob(
		{ workspaceId, userId },
		staleFixture.fixture.id,
		makeBusinessGate(
			{ state: "STALE", reason: "MEDIA_BINARY_CHANGED" },
			{
				allowed: false,
				reasonCode: "COMPOSITION_STALE",
				factLockRequirement: "NOT_REQUIRED",
				factLockOutcome: "NOT_EVALUATED",
			},
		),
	);
	assert(
		staleRequeueOutcome.kind === "FAILED" &&
			(
				await repository.findRenderJob(
					{ workspaceId, userId },
					staleFixture.fixture.id,
				)
			)?.status === "FAILED",
		"STALE blocked requeue must terminally fail the old Job.",
	);

	const unknownFixture = await createBlockedFixture("unknown", 4270);
	const unknownRequeueOutcome = await repository.requeueBlockedRenderJob(
		{ workspaceId, userId },
		unknownFixture.fixture.id,
		async () => {
			throw new CompositionError("COMPOSITION_CURRENTNESS_UNKNOWN");
		},
	);
	assert(
		unknownRequeueOutcome.kind === "RETRYABLE" &&
			(
				await repository.findRenderJob(
					{ workspaceId, userId },
					unknownFixture.fixture.id,
				)
			)?.status === "BLOCKED",
		"UNKNOWN blocked requeue must remain BLOCKED with a typed retryable outcome.",
	);
	const crossWorkspaceOutcome = await repository.requeueBlockedRenderJob(
		{ workspaceId: `foreign-${randomUUID()}`, userId },
		unknownFixture.fixture.id,
	);
	assert(
		crossWorkspaceOutcome.kind === "NOT_FOUND",
		"Cross-workspace blocked requeue must be denied as not found.",
	);
	for (const fixture of [stillBlockedFixture, unknownFixture]) {
		await db
			.update(renderJob)
			.set({
				status: "FAILED",
				errorCode: "TEST_CLEANUP",
				finishedAt: new Date(),
			})
			.where(eq(renderJob.id, fixture.fixture.id));
	}

	const differentVersionId = `render-cv-${randomUUID()}`;
	await db.insert(compositionVersion).values({
		id: differentVersionId,
		workspaceId,
		projectId,
		schemaVersion: "composition-input.v1",
		compositionInputJson: built.input,
		compositionFingerprint: built.fingerprint,
		sourceScriptVersionId: "sv1",
		sourceScriptRevision: 1,
		createdByUserId: userId,
		createdAt: new Date(),
	});
	const differentVersionJob = await repository.createRenderJob({
		actor: { workspaceId, userId },
		projectId,
		requestSpec: {
			...requestSpec,
			compositionVersionId: differentVersionId,
		},
		idempotencyKey: `render-different-version-${randomUUID()}`,
	});
	assert(
		differentVersionJob.id !== job.id &&
			differentVersionJob.compositionVersionId === differentVersionId,
		"Different CompositionVersions must never coalesce.",
	);

	// The explicit worker matrix uses deterministic adapters and cleans its
	// terminal rows between scenarios. It exercises the orchestration boundary,
	// not a production renderer.
	await db
		.update(renderAttempt)
		.set({
			status: "FENCED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderAttempt.id, blockedReclaimed.attempt.id));
	await db
		.update(renderJob)
		.set({
			status: "FAILED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderJob.id, blockedJob.id));
	await db
		.update(renderJob)
		.set({
			status: "FAILED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderJob.id, differentVersionJob.id));

	let scenarioIndex = 0;
	const runWorkerScenario = async (input: {
		label: string;
		technical: TechnicalPreflightResult;
		business?: ReturnType<typeof makeBusinessGate>;
		execute?: RenderExecutionAdapter;
		workerDependencies?: Pick<
			RenderWorkerDependencies,
			| "markIndeterminate"
			| "failJobAfterExecution"
			| "requeueAfterSideEffectFreeFailure"
		>;
	}) => {
		const scenarioProfile = {
			...profile,
			videoBitrateKbps: 4300 + scenarioIndex++,
		};
		const scenarioSpec = {
			...requestSpec,
			outputEncodingProfile: scenarioProfile,
			outputEncodingProfileFingerprint:
				await fingerprintOutputEncodingProfile(scenarioProfile),
		};
		const scenarioJob = await repository.createRenderJob({
			actor: { workspaceId, userId },
			projectId,
			requestSpec: scenarioSpec,
			idempotencyKey: `render-worker-${input.label}-${randomUUID()}`,
		});
		const result = await worker.runNextRenderAttempt(
			{ workspaceId, userId },
			`worker-${input.label}`,
			{
				technicalPreflight: async () => input.technical,
				businessPreflight: input.business,
				execute: input.execute,
				...input.workerDependencies,
			},
		);
		const [scenarioAttempt] = await db
			.select()
			.from(renderAttempt)
			.where(eq(renderAttempt.renderJobId, scenarioJob.id))
			.limit(1);
		const persistedJob = await repository.findRenderJob(
			{ workspaceId, userId },
			scenarioJob.id,
		);
		assert(persistedJob, `${input.label}: persisted Job is required.`);
		assert(scenarioAttempt, `${input.label}: persisted Attempt is required.`);
		return { result, scenarioJob, scenarioAttempt, persistedJob, scenarioSpec };
	};

	const technicalInvalid = await runWorkerScenario({
		label: "technical-invalid",
		technical: makeTechnicalPreflight(
			compositionVersionId,
			built.fingerprint,
			"INVALID",
		),
	});
	assert(
		technicalInvalid.result.kind === "FAILED" &&
			technicalInvalid.scenarioAttempt.status === "FAILED" &&
			technicalInvalid.persistedJob.status === "FAILED",
		"Technical INVALID must fail Attempt and Job.",
	);

	const technicalUnsupported = await runWorkerScenario({
		label: "technical-unsupported",
		technical: makeTechnicalPreflight(
			compositionVersionId,
			built.fingerprint,
			"UNSUPPORTED",
		),
	});
	assert(
		technicalUnsupported.result.kind === "FAILED" &&
			technicalUnsupported.scenarioAttempt.status === "FAILED" &&
			technicalUnsupported.persistedJob.status === "FAILED",
		"Technical UNSUPPORTED must fail Attempt and Job.",
	);

	const technicalUnknown = await runWorkerScenario({
		label: "technical-unknown",
		technical: makeTechnicalPreflight(
			compositionVersionId,
			built.fingerprint,
			"UNKNOWN",
		),
	});
	assert(
		technicalUnknown.result.kind === "QUEUED" &&
			technicalUnknown.scenarioAttempt.status === "FENCED" &&
			technicalUnknown.persistedJob.status === "QUEUED",
		"Technical UNKNOWN must fence and queue.",
	);
	const technicalUnknownRetry = await repository.claimNextRenderAttempt(
		workspaceId,
		"worker-technical-unknown-retry",
	);
	assert(
		technicalUnknownRetry?.job.id === technicalUnknown.scenarioJob.id,
		"Technical UNKNOWN retry must claim the same Job with a new Attempt.",
	);
	await db
		.update(renderAttempt)
		.set({
			status: "FENCED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderAttempt.id, technicalUnknownRetry.attempt.id));
	await db
		.update(renderJob)
		.set({
			status: "FAILED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderJob.id, technicalUnknownRetry.job.id));

	const businessBlocked = await runWorkerScenario({
		label: "business-blocked",
		technical: makeTechnicalPreflight(compositionVersionId, built.fingerprint),
		business: makeBusinessGate(
			{ state: "CURRENT" },
			{
				allowed: false,
				reasonCode: "FACT_LOCK_BLOCKED",
				factLockRequirement: "REQUIRED",
				factLockOutcome: "BLOCKED",
			},
		),
	});
	assert(
		businessBlocked.result.kind === "BLOCKED" &&
			businessBlocked.scenarioAttempt.status === "FENCED" &&
			businessBlocked.persistedJob.status === "BLOCKED",
		"Business BLOCKED must fence and block.",
	);

	const stale = await runWorkerScenario({
		label: "composition-stale",
		technical: makeTechnicalPreflight(compositionVersionId, built.fingerprint),
		business: makeBusinessGate(
			{ state: "STALE", reason: "MEDIA_BINARY_CHANGED" },
			{
				allowed: false,
				reasonCode: "COMPOSITION_STALE",
				factLockRequirement: "NOT_REQUIRED",
				factLockOutcome: "NOT_EVALUATED",
			},
		),
	});
	assert(
		stale.result.kind === "FAILED" &&
			stale.scenarioAttempt.status === "FENCED" &&
			stale.persistedJob.status === "FAILED",
		"Composition STALE must fence and fail.",
	);

	const businessUnknown = await runWorkerScenario({
		label: "business-unknown",
		technical: makeTechnicalPreflight(compositionVersionId, built.fingerprint),
		business: async () => {
			throw new CompositionError("COMPOSITION_CURRENTNESS_UNKNOWN");
		},
	});
	assert(
		businessUnknown.result.kind === "QUEUED" &&
			businessUnknown.scenarioAttempt.status === "FENCED" &&
			businessUnknown.persistedJob.status === "QUEUED",
		"Business/currentness UNKNOWN must fence and queue.",
	);
	const businessUnknownRetry = await repository.claimNextRenderAttempt(
		workspaceId,
		"worker-business-unknown-retry",
	);
	assert(
		businessUnknownRetry?.job.id === businessUnknown.scenarioJob.id,
		"Business UNKNOWN retry must claim the same Job with a new Attempt.",
	);
	await db
		.update(renderAttempt)
		.set({
			status: "FENCED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderAttempt.id, businessUnknownRetry.attempt.id));
	await db
		.update(renderJob)
		.set({
			status: "FAILED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderJob.id, businessUnknownRetry.job.id));

	const returnedBusinessUnknown = await runWorkerScenario({
		label: "business-unknown-returned-object",
		technical: makeTechnicalPreflight(compositionVersionId, built.fingerprint),
		business: makeBusinessGate(
			{ state: "UNKNOWN", reason: "CURRENTNESS_OBJECT_UNKNOWN" },
			{
				allowed: true,
				reasonCode: "FACT_LOCK_NOT_REQUIRED",
				factLockRequirement: "NOT_REQUIRED",
				factLockOutcome: "NOT_EVALUATED",
			},
		),
	});
	assert(
		returnedBusinessUnknown.result.kind === "QUEUED" &&
			returnedBusinessUnknown.result.persisted === true &&
			returnedBusinessUnknown.scenarioAttempt.status === "FENCED" &&
			returnedBusinessUnknown.persistedJob.status === "QUEUED",
		"Returned currentness UNKNOWN must fence and queue without invoking the adapter.",
	);
	const returnedBusinessUnknownRetry = await repository.claimNextRenderAttempt(
		workspaceId,
		"worker-business-unknown-returned-object-retry",
	);
	assert(
		returnedBusinessUnknownRetry?.job.id ===
			returnedBusinessUnknown.scenarioJob.id,
		"Returned currentness UNKNOWN must permit a later retry Attempt.",
	);
	await db
		.update(renderAttempt)
		.set({
			status: "FENCED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderAttempt.id, returnedBusinessUnknownRetry.attempt.id));
	await db
		.update(renderJob)
		.set({
			status: "FAILED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderJob.id, returnedBusinessUnknownRetry.job.id));

	let observedSnapshot: RenderAttemptExecutionSnapshot | undefined;
	const valid = await runWorkerScenario({
		label: "valid-allowed",
		technical: makeTechnicalPreflight(compositionVersionId, built.fingerprint),
		business: allowedBusinessGate,
		execute: async ({ snapshot }) => {
			observedSnapshot = snapshot;
			return { outcome: "SUCCESS" };
		},
	});
	assert(
		valid.result.kind === "INDETERMINATE" &&
			valid.scenarioAttempt.status === "INDETERMINATE" &&
			valid.persistedJob.status === "INDETERMINATE" &&
			valid.scenarioAttempt.authorizedAt !== null &&
			valid.scenarioAttempt.executionStartedAt !== null,
		"VALID + ALLOWED must authorize, mark execution, then remain indeterminate on success.",
	);
	assert(
		observedSnapshot &&
			observedSnapshot.jobId === valid.scenarioJob.id &&
			observedSnapshot.attemptId === valid.scenarioAttempt.id &&
			observedSnapshot.attemptNumber === valid.scenarioAttempt.attemptNumber &&
			observedSnapshot.execution.outputReservationId ===
				valid.scenarioAttempt.outputReservationId,
		"Execution adapter must receive the exact pinned snapshot and fencing tuple.",
	);

	const deterministicFailure = await runWorkerScenario({
		label: "adapter-deterministic-failure",
		technical: makeTechnicalPreflight(compositionVersionId, built.fingerprint),
		business: allowedBusinessGate,
		execute: async () => ({
			outcome: "FAILURE",
			classification: "DETERMINISTIC",
			sideEffectFree: true,
			errorCode: "ENCODER_INVALID_INPUT",
		}),
	});
	assert(
		deterministicFailure.result.kind === "FAILED" &&
			deterministicFailure.scenarioAttempt.status === "FAILED" &&
			deterministicFailure.persistedJob.status === "FAILED",
		"Deterministic adapter failure must fail Attempt and Job.",
	);

	const retryableFailure = await runWorkerScenario({
		label: "adapter-side-effect-free-retry",
		technical: makeTechnicalPreflight(compositionVersionId, built.fingerprint),
		business: allowedBusinessGate,
		execute: async () => ({
			outcome: "FAILURE",
			classification: "RETRYABLE",
			sideEffectFree: true,
			errorCode: "ADAPTER_RETRYABLE",
		}),
	});
	assert(
		retryableFailure.result.kind === "QUEUED" &&
			retryableFailure.scenarioAttempt.status === "FENCED" &&
			retryableFailure.persistedJob.status === "QUEUED",
		"Side-effect-free retry must fence Attempt and queue Job.",
	);
	const retryClaim = await repository.claimNextRenderAttempt(
		workspaceId,
		"worker-side-effect-free-retry-2",
	);
	assert(
		retryClaim?.job.id === retryableFailure.scenarioJob.id &&
			retryClaim.attempt.id !== retryableFailure.scenarioAttempt.id &&
			retryClaim.attempt.attemptNumber ===
				retryableFailure.scenarioAttempt.attemptNumber + 1 &&
			retryClaim.attempt.outputReservationId !==
				retryableFailure.scenarioAttempt.outputReservationId,
		"Retry claim must create a new Attempt, number, and output reservation.",
	);
	await db
		.update(renderAttempt)
		.set({
			status: "FENCED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderAttempt.id, retryClaim.attempt.id));
	await db
		.update(renderJob)
		.set({
			status: "FAILED",
			errorCode: "TEST_CLEANUP",
			finishedAt: new Date(),
		})
		.where(eq(renderJob.id, retryClaim.job.id));

	const ambiguous = await runWorkerScenario({
		label: "adapter-ambiguous-after-start",
		technical: makeTechnicalPreflight(compositionVersionId, built.fingerprint),
		business: allowedBusinessGate,
		execute: async () => ({
			outcome: "FAILURE",
			classification: "RETRYABLE",
			sideEffectFree: false,
			errorCode: "ADAPTER_AMBIGUOUS",
		}),
	});
	assert(
		ambiguous.result.kind === "INDETERMINATE" &&
			ambiguous.scenarioAttempt.status === "INDETERMINATE" &&
			ambiguous.persistedJob.status === "INDETERMINATE",
		"Ambiguous post-start adapter failure must be indeterminate.",
	);

	const successCasLoss = await runWorkerScenario({
		label: "success-cas-loss",
		technical: makeTechnicalPreflight(compositionVersionId, built.fingerprint),
		business: allowedBusinessGate,
		execute: async () => ({ outcome: "SUCCESS" }),
		workerDependencies: {
			markIndeterminate: async () => false,
		},
	});
	assert(
		successCasLoss.result.kind === "RECONCILIATION_REQUIRED" &&
			successCasLoss.result.persisted === false &&
			successCasLoss.result.reason === "STATE_TRANSITION_LOST" &&
			successCasLoss.scenarioAttempt.status === "RUNNING" &&
			successCasLoss.scenarioAttempt.executionStartedAt !== null &&
			successCasLoss.persistedJob.status === "RUNNING",
		"Success CAS loss with unresolved DB state must require reconciliation.",
	);

	const successCasLossWithWinner = await runWorkerScenario({
		label: "success-cas-loss-with-winner",
		technical: makeTechnicalPreflight(compositionVersionId, built.fingerprint),
		business: allowedBusinessGate,
		execute: async () => ({ outcome: "SUCCESS" }),
		workerDependencies: {
			markIndeterminate: async (mutation) => {
				assert(
					await repository.markIndeterminate(mutation),
					"Injected winner must persist INDETERMINATE before returning a lost CAS.",
				);
				return false;
			},
		},
	});
	assert(
		successCasLossWithWinner.result.kind === "INDETERMINATE" &&
			successCasLossWithWinner.result.persisted === true &&
			successCasLossWithWinner.scenarioAttempt.status === "INDETERMINATE" &&
			successCasLossWithWinner.persistedJob.status === "INDETERMINATE",
		"Success CAS loss may report INDETERMINATE only after authoritative proof.",
	);

	const deterministicFailureCasLoss = await runWorkerScenario({
		label: "deterministic-failure-cas-loss",
		technical: makeTechnicalPreflight(compositionVersionId, built.fingerprint),
		business: allowedBusinessGate,
		execute: async () => ({
			outcome: "FAILURE",
			classification: "DETERMINISTIC",
			sideEffectFree: true,
			errorCode: "DETERMINISTIC_CAS_LOSS",
		}),
		workerDependencies: {
			failJobAfterExecution: async () => false,
		},
	});
	assert(
		deterministicFailureCasLoss.result.kind === "RECONCILIATION_REQUIRED" &&
			deterministicFailureCasLoss.result.persisted === false &&
			deterministicFailureCasLoss.scenarioAttempt.status === "RUNNING" &&
			deterministicFailureCasLoss.persistedJob.status === "RUNNING",
		"Deterministic failure CAS loss must not report FAILED without proof.",
	);

	const retryCasLoss = await runWorkerScenario({
		label: "retry-cas-loss",
		technical: makeTechnicalPreflight(compositionVersionId, built.fingerprint),
		business: allowedBusinessGate,
		execute: async () => ({
			outcome: "FAILURE",
			classification: "RETRYABLE",
			sideEffectFree: true,
			errorCode: "RETRY_CAS_LOSS",
		}),
		workerDependencies: {
			requeueAfterSideEffectFreeFailure: async () => false,
		},
	});
	assert(
		retryCasLoss.result.kind === "RECONCILIATION_REQUIRED" &&
			retryCasLoss.result.persisted === false &&
			retryCasLoss.scenarioAttempt.status === "RUNNING" &&
			retryCasLoss.persistedJob.status === "RUNNING",
		"Side-effect-free retry CAS loss must not report QUEUED without proof.",
	);

	for (const scenario of [
		successCasLoss,
		successCasLossWithWinner,
		deterministicFailureCasLoss,
		retryCasLoss,
	]) {
		await db
			.update(renderAttempt)
			.set({
				status: "FENCED",
				errorCode: "TEST_CLEANUP",
				finishedAt: new Date(),
			})
			.where(eq(renderAttempt.id, scenario.scenarioAttempt.id));
		await db
			.update(renderJob)
			.set({
				status: "FAILED",
				errorCode: "TEST_CLEANUP",
				finishedAt: new Date(),
			})
			.where(eq(renderJob.id, scenario.scenarioJob.id));
	}

	async function createRaceClaim(label: string, bitrate: number) {
		const raceProfile = { ...profile, videoBitrateKbps: bitrate };
		const raceJob = await repository.createRenderJob({
			actor: { workspaceId, userId },
			projectId,
			requestSpec: {
				...requestSpec,
				outputEncodingProfile: raceProfile,
				outputEncodingProfileFingerprint:
					await fingerprintOutputEncodingProfile(raceProfile),
			},
			idempotencyKey: `render-race-${label}-${randomUUID()}`,
		});
		const raceClaim = await repository.claimNextRenderAttempt(
			workspaceId,
			`worker-race-${label}`,
		);
		assert(raceClaim?.job.id === raceJob.id, `${label}: race claim mismatch.`);
		return raceClaim;
	}

	async function cleanupRaceClaim(
		raceClaim: NonNullable<
			Awaited<ReturnType<typeof repository.claimNextRenderAttempt>>
		>,
	) {
		await db
			.update(renderAttempt)
			.set({
				status: "FENCED",
				errorCode: "TEST_CLEANUP",
				finishedAt: new Date(),
			})
			.where(eq(renderAttempt.id, raceClaim.attempt.id));
		await db
			.update(renderJob)
			.set({
				status: "FAILED",
				errorCode: "TEST_CLEANUP",
				finishedAt: new Date(),
			})
			.where(eq(renderJob.id, raceClaim.job.id));
	}

	const expiryVsAuthorization = await createRaceClaim(
		"expiry-authorization",
		4510,
	);
	await db
		.update(renderAttempt)
		.set({
			leaseExpiresAt: new Date(Date.now() - 1000),
			authorizedAt: new Date(),
			technicalPreflightStatus: "VALID",
			technicalEvidenceFingerprint: hash,
			technicalCheckedAt: new Date(),
		})
		.where(eq(renderAttempt.id, expiryVsAuthorization.attempt.id));
	const [expiryAuthorizationResult, expiryWinner] = await bounded(
		Promise.all([
			repository.authorizeAttempt({
				actor: { workspaceId, userId },
				jobId: expiryVsAuthorization.job.id,
				attemptId: expiryVsAuthorization.attempt.id,
				attemptNumber: expiryVsAuthorization.attempt.attemptNumber,
				leaseOwner: expiryVsAuthorization.attempt.leaseOwner,
				technicalEvidenceFingerprint: hash,
				businessGate: (transaction) =>
					allowedBusinessGate(
						transaction,
						{ workspaceId, userId },
						compositionVersionId,
					),
			}),
			repository.claimNextRenderAttempt(workspaceId, "worker-race-expiry-a"),
		]),
		"expiry versus final authorization",
	);
	assert(
		expiryAuthorizationResult.kind === "NOT_CLAIMED" &&
			expiryWinner?.job.id === expiryVsAuthorization.job.id,
		"Expiry versus final authorization must have one valid winner without a deadlock.",
	);
	const [expiredAuthorizationAttempt] = await db
		.select()
		.from(renderAttempt)
		.where(eq(renderAttempt.id, expiryVsAuthorization.attempt.id));
	assert(
		expiredAuthorizationAttempt?.status === "FENCED" &&
			(expiryWinner === undefined || expiryWinner.job.status === "RUNNING"),
		"Expiry versus authorization must not split Job and Attempt state.",
	);
	if (expiryWinner) await cleanupRaceClaim(expiryWinner);

	const expiryVsExecution = await createRaceClaim("expiry-execution", 4520);
	await db
		.update(renderAttempt)
		.set({
			leaseExpiresAt: new Date(Date.now() - 1000),
			authorizedAt: new Date(),
			technicalPreflightStatus: "VALID",
			technicalEvidenceFingerprint: hash,
			technicalCheckedAt: new Date(),
		})
		.where(eq(renderAttempt.id, expiryVsExecution.attempt.id));
	const [expiryExecutionResult, expiryExecutionWinner] = await bounded(
		Promise.all([
			repository.markExecutionStarted({
				jobId: expiryVsExecution.job.id,
				attemptId: expiryVsExecution.attempt.id,
				attemptNumber: expiryVsExecution.attempt.attemptNumber,
				leaseOwner: expiryVsExecution.attempt.leaseOwner,
			}),
			repository.claimNextRenderAttempt(workspaceId, "worker-race-expiry-b"),
		]),
		"expiry versus execution-start CAS",
	);
	assert(
		expiryExecutionResult === false &&
			expiryExecutionWinner?.job.id === expiryVsExecution.job.id,
		"Expiry versus execution-start CAS must have one valid winner without a deadlock.",
	);
	const [expiredExecutionAttempt] = await db
		.select()
		.from(renderAttempt)
		.where(eq(renderAttempt.id, expiryVsExecution.attempt.id));
	assert(
		expiredExecutionAttempt?.status === "FENCED" &&
			(expiryExecutionWinner === undefined ||
				expiryExecutionWinner.job.status === "RUNNING"),
		"Expiry versus execution-start CAS must not split Job and Attempt state.",
	);
	if (expiryExecutionWinner) await cleanupRaceClaim(expiryExecutionWinner);

	const failureVsExecution = await createRaceClaim("failure-execution", 4530);
	await db
		.update(renderAttempt)
		.set({
			authorizedAt: new Date(),
			technicalPreflightStatus: "VALID",
			technicalEvidenceFingerprint: hash,
			technicalCheckedAt: new Date(),
		})
		.where(eq(renderAttempt.id, failureVsExecution.attempt.id));
	const [failureResult, executionResult] = await bounded(
		Promise.all([
			repository.failTechnical({
				jobId: failureVsExecution.job.id,
				attemptId: failureVsExecution.attempt.id,
				attemptNumber: failureVsExecution.attempt.attemptNumber,
				leaseOwner: failureVsExecution.attempt.leaseOwner,
				errorCode: "TECHNICAL_RACE_FAILURE",
			}),
			repository.markExecutionStarted({
				jobId: failureVsExecution.job.id,
				attemptId: failureVsExecution.attempt.id,
				attemptNumber: failureVsExecution.attempt.attemptNumber,
				leaseOwner: failureVsExecution.attempt.leaseOwner,
			}),
		]),
		"failure/fence versus execution-start CAS",
	);
	assert(
		Number(failureResult) + Number(executionResult) === 1,
		"Failure versus execution-start CAS must have exactly one winner.",
	);
	const failureExecutionJob = await repository.findRenderJob(
		{ workspaceId, userId },
		failureVsExecution.job.id,
	);
	const [failureExecutionAttempt] = await db
		.select()
		.from(renderAttempt)
		.where(eq(renderAttempt.id, failureVsExecution.attempt.id));
	assert(
		failureResult
			? failureExecutionJob?.status === "FAILED" &&
					failureExecutionAttempt?.status === "FAILED" &&
					failureExecutionAttempt.executionStartedAt === null
			: executionResult &&
					failureExecutionJob?.status === "RUNNING" &&
					failureExecutionAttempt?.executionStartedAt !== null &&
					failureExecutionAttempt.status === "RUNNING",
		"Failure/execution race must leave a consistent winner state.",
	);
	if (executionResult) {
		const reconciled = await repository.markIndeterminate({
			jobId: failureVsExecution.job.id,
			attemptId: failureVsExecution.attempt.id,
			attemptNumber: failureVsExecution.attempt.attemptNumber,
			leaseOwner: failureVsExecution.attempt.leaseOwner,
			errorCode: "TEST_CLEANUP",
		});
		assert(
			reconciled,
			"Execution winner must remain owner-mutable for cleanup.",
		);
	}

	const outputRoot = await mkdtemp(
		join(tmpdir(), "affichannel-render-21d-output-"),
	);
	temporaryFolders.push(outputRoot);
	const outputStorage = new LocalRenderOutputStorage({ rootDir: outputRoot });
	function fixtureBody() {
		return new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(deterministicRenderOutputFixture);
				controller.close();
			},
		});
	}
	function outputKey(scenario: {
		job: { id: string };
		attempt: { id: string };
	}) {
		return createRenderOutputStorageKey({
			workspaceId,
			projectId,
			renderJobId: scenario.job.id,
			renderAttemptId: scenario.attempt.id,
			outputReservationId: scenario.attempt.outputReservationId,
		});
	}
	async function expectStorageFailure(promise: Promise<unknown>, code: string) {
		try {
			await promise;
		} catch (error) {
			assert(
				typeof error === "object" &&
					error !== null &&
					(error as { code?: unknown }).code === code,
				`Expected storage failure ${code}.`,
			);
			return;
		}
		throw new Error(`Expected storage failure ${code}.`);
	}

	async function prepareArtifactScenario(
		label: string,
		status: "RUNNING" | "INDETERMINATE",
	) {
		const scenarioSalt = [...label].reduce(
			(total, character) => total + character.charCodeAt(0),
			0,
		);
		const scenarioProfile = {
			...profile,
			videoBitrateKbps: 5000 + scenarioSalt,
		};
		const scenarioFingerprint =
			await fingerprintOutputEncodingProfile(scenarioProfile);
		const scenarioRequestSpec = {
			...requestSpec,
			compositionVersionId: testRenderCompositionVersionId,
			compositionFingerprint: testRenderCompositionFingerprint,
			outputEncodingProfile: scenarioProfile,
			outputEncodingProfileFingerprint: scenarioFingerprint,
		};
		const job = await repository.createRenderJob({
			actor: { workspaceId, userId },
			projectId,
			requestSpec: scenarioRequestSpec,
			idempotencyKey: `render-21d-${label}-${randomUUID()}`,
		});
		const now = new Date();
		const attemptId = randomUUID();
		const outputReservationId = randomUUID();
		await db
			.update(renderJob)
			.set({
				status,
				attemptCount: 1,
				finishedAt: status === "INDETERMINATE" ? now : null,
			})
			.where(eq(renderJob.id, job.id));
		await db.insert(renderAttempt).values({
			id: attemptId,
			workspaceId,
			renderJobId: job.id,
			attemptNumber: 1,
			status,
			leaseOwner: `worker-21d-${label}`,
			leaseExpiresAt:
				status === "RUNNING"
					? new Date(now.getTime() + 60_000)
					: new Date(now.getTime() - 60_000),
			claimedAt: now,
			lastHeartbeatAt: now,
			authorizedAt: now,
			executionStartedAt: now,
			outputReservationId,
			finishedAt: status === "INDETERMINATE" ? now : null,
		});
		const [attempt] = await db
			.select()
			.from(renderAttempt)
			.where(eq(renderAttempt.id, attemptId))
			.limit(1);
		assert(attempt, `${label}: Attempt setup must persist.`);
		return { job, attempt };
	}

	const missingArtifact = await prepareArtifactScenario("missing", "RUNNING");
	await expectStorageFailure(
		artifactRepository.finalizeRenderArtifact({
			jobId: missingArtifact.job.id,
			attemptId: missingArtifact.attempt.id,
			attemptNumber: 1,
			leaseOwner: missingArtifact.attempt.leaseOwner,
			storage: outputStorage,
		}),
		"RENDER_OUTPUT_STORAGE_NOT_FOUND",
	);
	const [missingJobState] = await db
		.select({ status: renderJob.status })
		.from(renderJob)
		.where(eq(renderJob.id, missingArtifact.job.id));
	const [missingAttemptState] = await db
		.select({ status: renderAttempt.status })
		.from(renderAttempt)
		.where(eq(renderAttempt.id, missingArtifact.attempt.id));
	assert(
		missingJobState?.status === "RUNNING" &&
			missingAttemptState?.status === "RUNNING" &&
			(
				await db
					.select({ id: renderArtifact.id })
					.from(renderArtifact)
					.where(eq(renderArtifact.renderJobId, missingArtifact.job.id))
			).length === 0,
		"A missing object and fabricated absence cannot complete an Artifact, Attempt, or Job.",
	);

	const deletedArtifact = await prepareArtifactScenario("deleted", "RUNNING");
	await outputStorage.createOnce({
		storageKey: outputKey(deletedArtifact),
		body: fixtureBody(),
	});
	await outputStorage.deleteProvenOrphan({
		storageKey: outputKey(deletedArtifact),
		byteSize: deterministicRenderOutputFixtureProvenance.byteSize,
		checksumSha256: deterministicRenderOutputFixtureProvenance.sha256,
	});
	await expectStorageFailure(
		artifactRepository.finalizeRenderArtifact({
			jobId: deletedArtifact.job.id,
			attemptId: deletedArtifact.attempt.id,
			attemptNumber: 1,
			leaseOwner: deletedArtifact.attempt.leaseOwner,
			storage: outputStorage,
		}),
		"RENDER_OUTPUT_STORAGE_NOT_FOUND",
	);

	const conflictingBytesArtifact = await prepareArtifactScenario(
		"conflicting-bytes",
		"RUNNING",
	);
	await outputStorage.createOnce({
		storageKey: outputKey(conflictingBytesArtifact),
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2, 3]));
				controller.close();
			},
		}),
	});
	await expectStorageFailure(
		artifactRepository.finalizeRenderArtifact({
			jobId: conflictingBytesArtifact.job.id,
			attemptId: conflictingBytesArtifact.attempt.id,
			attemptNumber: 1,
			leaseOwner: conflictingBytesArtifact.attempt.leaseOwner,
			storage: outputStorage,
		}),
		"RENDER_OUTPUT_INVALID",
	);

	const wrongMimeR2Artifact = await prepareArtifactScenario(
		"r2-wrong-mime",
		"RUNNING",
	);
	const wrongMimeR2Storage = new R2RenderOutputStorage(
		{
			async putObject() {},
			async headObject() {
				return {
					byteSize: deterministicRenderOutputFixture.byteLength,
					contentType: "application/octet-stream",
					etag: null,
					checksumSha256: deterministicRenderOutputFixtureProvenance.sha256,
				};
			},
			async getObject() {
				return {
					stream: fixtureBody(),
					byteSize: deterministicRenderOutputFixture.byteLength,
					contentType: "video/mp4",
				};
			},
			async deleteObject() {},
		},
		{ tempRoot: outputRoot },
	);
	await expectStorageFailure(
		artifactRepository.finalizeRenderArtifact({
			jobId: wrongMimeR2Artifact.job.id,
			attemptId: wrongMimeR2Artifact.attempt.id,
			attemptNumber: 1,
			leaseOwner: wrongMimeR2Artifact.attempt.leaseOwner,
			storage: wrongMimeR2Storage,
		}),
		"RENDER_OUTPUT_STORAGE_CONFLICT",
	);
	const [wrongMimeJobState] = await db
		.select({ status: renderJob.status })
		.from(renderJob)
		.where(eq(renderJob.id, wrongMimeR2Artifact.job.id));
	const [wrongMimeAttemptState] = await db
		.select({ status: renderAttempt.status })
		.from(renderAttempt)
		.where(eq(renderAttempt.id, wrongMimeR2Artifact.attempt.id));
	assert(
		wrongMimeJobState?.status === "RUNNING" &&
			wrongMimeAttemptState?.status === "RUNNING" &&
			(
				await db
					.select({ id: renderArtifact.id })
					.from(renderArtifact)
					.where(eq(renderArtifact.renderJobId, wrongMimeR2Artifact.job.id))
			).length === 0,
		"A wrong-MIME R2 object cannot complete an Artifact, Attempt, or Job.",
	);

	const provenanceArtifact = await prepareArtifactScenario(
		"provenance-tampered",
		"RUNNING",
	);
	await db
		.update(renderJob)
		.set({
			requestSpecJson: {
				...provenanceArtifact.job.requestSpec,
				outputContractVersion: "tampered-output-contract.v1",
			},
		})
		.where(eq(renderJob.id, provenanceArtifact.job.id));
	await expectRenderArtifactError(
		artifactRepository.finalizeRenderArtifact({
			jobId: provenanceArtifact.job.id,
			attemptId: provenanceArtifact.attempt.id,
			attemptNumber: 1,
			leaseOwner: provenanceArtifact.attempt.leaseOwner,
			storage: outputStorage,
		}),
		"RENDER_ARTIFACT_PROVENANCE_INVALID",
	);

	const normalArtifact = await prepareArtifactScenario("normal", "RUNNING");
	await outputStorage.createOnce({
		storageKey: outputKey(normalArtifact),
		body: fixtureBody(),
	});
	const finalizedArtifact = await artifactRepository.finalizeRenderArtifact({
		jobId: normalArtifact.job.id,
		attemptId: normalArtifact.attempt.id,
		attemptNumber: 1,
		leaseOwner: normalArtifact.attempt.leaseOwner,
		storage: outputStorage,
	});
	const [normalJobState] = await db
		.select({ status: renderJob.status })
		.from(renderJob)
		.where(eq(renderJob.id, normalArtifact.job.id));
	const [normalAttemptState] = await db
		.select({ status: renderAttempt.status })
		.from(renderAttempt)
		.where(eq(renderAttempt.id, normalArtifact.attempt.id));
	const normalArtifacts = await db
		.select({ id: renderArtifact.id })
		.from(renderArtifact)
		.where(eq(renderArtifact.renderJobId, normalArtifact.job.id));
	assert(
		finalizedArtifact.id &&
			finalizedArtifact.renderAttemptId === normalArtifact.attempt.id &&
			normalJobState?.status === "COMPLETED" &&
			normalAttemptState?.status === "COMPLETED" &&
			normalArtifacts.length === 1,
		"Normal 21D finalization must atomically create exactly one Artifact and complete Attempt then Job.",
	);
	const idempotentArtifact = await artifactRepository.finalizeRenderArtifact({
		jobId: normalArtifact.job.id,
		attemptId: normalArtifact.attempt.id,
		attemptNumber: 1,
		leaseOwner: normalArtifact.attempt.leaseOwner,
		storage: outputStorage,
	});
	assert(
		idempotentArtifact.id === finalizedArtifact.id &&
			(
				await db
					.select({ id: renderArtifact.id })
					.from(renderArtifact)
					.where(eq(renderArtifact.renderJobId, normalArtifact.job.id))
			).length === 1,
		"An exact finalize replay must be idempotent and must not create a second Artifact.",
	);

	const concurrentArtifact = await prepareArtifactScenario(
		"concurrent",
		"RUNNING",
	);
	const concurrentResults = await Promise.all([
		artifactRepository.finalizeRenderArtifact({
			jobId: concurrentArtifact.job.id,
			attemptId: concurrentArtifact.attempt.id,
			attemptNumber: 1,
			leaseOwner: concurrentArtifact.attempt.leaseOwner,
			storage: outputStorage,
			body: fixtureBody(),
		}),
		artifactRepository.finalizeRenderArtifact({
			jobId: concurrentArtifact.job.id,
			attemptId: concurrentArtifact.attempt.id,
			attemptNumber: 1,
			leaseOwner: concurrentArtifact.attempt.leaseOwner,
			storage: outputStorage,
			body: fixtureBody(),
		}),
	]);
	assert(
		concurrentResults[0]?.id === concurrentResults[1]?.id &&
			(
				await db
					.select({ id: renderArtifact.id })
					.from(renderArtifact)
					.where(eq(renderArtifact.renderJobId, concurrentArtifact.job.id))
			).length === 1,
		"Concurrent exact finalization must return one immutable Artifact ID.",
	);

	const staleArtifact = await prepareArtifactScenario("stale", "RUNNING");
	await outputStorage.createOnce({
		storageKey: outputKey(staleArtifact),
		body: fixtureBody(),
	});
	await expectRenderArtifactError(
		artifactRepository.finalizeRenderArtifact({
			jobId: staleArtifact.job.id,
			attemptId: staleArtifact.attempt.id,
			attemptNumber: 99,
			leaseOwner: staleArtifact.attempt.leaseOwner,
			storage: outputStorage,
		}),
		"RENDER_ATTEMPT_NOT_FOUND",
	);
	await expectRenderArtifactError(
		artifactRepository.finalizeRenderArtifact({
			jobId: staleArtifact.job.id,
			attemptId: staleArtifact.attempt.id,
			attemptNumber: 1,
			leaseOwner: "wrong-worker",
			storage: outputStorage,
		}),
		"RENDER_ARTIFACT_FENCED",
	);
	const [uncompletedJob] = await db
		.select({ status: renderJob.status })
		.from(renderJob)
		.where(eq(renderJob.id, staleArtifact.job.id));
	const [uncompletedAttempt] = await db
		.select({ status: renderAttempt.status })
		.from(renderAttempt)
		.where(eq(renderAttempt.id, staleArtifact.attempt.id));
	assert(
		uncompletedJob?.status === "RUNNING" &&
			uncompletedAttempt?.status === "RUNNING",
		"A failed artifact proof must not complete the Job or Attempt.",
	);
	await db
		.update(renderAttempt)
		.set({ leaseExpiresAt: new Date(Date.now() - 60_000) })
		.where(eq(renderAttempt.id, staleArtifact.attempt.id));
	await expectRenderArtifactError(
		artifactRepository.finalizeRenderArtifact({
			jobId: staleArtifact.job.id,
			attemptId: staleArtifact.attempt.id,
			attemptNumber: 1,
			leaseOwner: staleArtifact.attempt.leaseOwner,
			storage: outputStorage,
		}),
		"RENDER_ARTIFACT_FENCED",
	);
	assert(
		(
			await db
				.select({ id: renderArtifact.id })
				.from(renderArtifact)
				.where(eq(renderArtifact.renderJobId, staleArtifact.job.id))
		).length === 0,
		"An expired worker must not normal-finalize an Artifact.",
	);

	const noObjectReconciliation = await prepareArtifactScenario(
		"reconcile-missing",
		"INDETERMINATE",
	);
	await expectStorageFailure(
		artifactRepository.reconcileRenderArtifact({
			jobId: noObjectReconciliation.job.id,
			attemptId: noObjectReconciliation.attempt.id,
			attemptNumber: 1,
			storage: outputStorage,
		}),
		"RENDER_OUTPUT_STORAGE_NOT_FOUND",
	);
	assert(
		(
			await db
				.select({ id: renderArtifact.id })
				.from(renderArtifact)
				.where(eq(renderArtifact.renderJobId, noObjectReconciliation.job.id))
		).length === 0,
		"Indeterminate reconciliation without an exact object must not complete.",
	);

	const reconciledArtifact = await prepareArtifactScenario(
		"reconcile",
		"INDETERMINATE",
	);
	await outputStorage.createOnce({
		storageKey: outputKey(reconciledArtifact),
		body: fixtureBody(),
	});
	const reconciled = await artifactRepository.reconcileRenderArtifact({
		jobId: reconciledArtifact.job.id,
		attemptId: reconciledArtifact.attempt.id,
		attemptNumber: 1,
		storage: outputStorage,
	});
	const [reconciledJobState] = await db
		.select({ status: renderJob.status })
		.from(renderJob)
		.where(eq(renderJob.id, reconciledArtifact.job.id));
	const [reconciledAttemptState] = await db
		.select({ status: renderAttempt.status })
		.from(renderAttempt)
		.where(eq(renderAttempt.id, reconciledArtifact.attempt.id));
	assert(
		reconciled.id &&
			reconciledJobState?.status === "COMPLETED" &&
			reconciledAttemptState?.status === "COMPLETED",
		"Trusted reconciliation must finalize an eligible expired INDETERMINATE Attempt without a current lease.",
	);

	const reconciliationRace = await prepareArtifactScenario(
		"reconcile-race",
		"INDETERMINATE",
	);
	await outputStorage.createOnce({
		storageKey: outputKey(reconciliationRace),
		body: fixtureBody(),
	});
	const reconciliationRaceResults = await Promise.allSettled([
		artifactRepository.reconcileRenderArtifact({
			jobId: reconciliationRace.job.id,
			attemptId: reconciliationRace.attempt.id,
			attemptNumber: 1,
			storage: outputStorage,
		}),
		artifactRepository.finalizeRenderArtifact({
			jobId: reconciliationRace.job.id,
			attemptId: reconciliationRace.attempt.id,
			attemptNumber: 1,
			leaseOwner: reconciliationRace.attempt.leaseOwner,
			storage: outputStorage,
			body: fixtureBody(),
		}),
	]);
	assert(
		reconciliationRaceResults.some((result) => result.status === "fulfilled") &&
			(
				await db
					.select({ id: renderArtifact.id })
					.from(renderArtifact)
					.where(eq(renderArtifact.renderJobId, reconciliationRace.job.id))
			).length === 1,
		"Concurrent normal/reconciliation finalize must resolve to one immutable Artifact.",
	);

	const orphanScenario = await prepareArtifactScenario("orphan", "RUNNING");
	await outputStorage.createOnce({
		storageKey: outputKey(orphanScenario),
		body: fixtureBody(),
	});
	const orphanFinishedAt = new Date();
	await db
		.update(renderAttempt)
		.set({ status: "FAILED", finishedAt: orphanFinishedAt })
		.where(eq(renderAttempt.id, orphanScenario.attempt.id));
	await db
		.update(renderJob)
		.set({ status: "FAILED", finishedAt: orphanFinishedAt })
		.where(eq(renderJob.id, orphanScenario.job.id));
	const orphanInspection = await orphanService.inspectRenderOutputOwnership({
		storage: outputStorage,
		workspaceId,
		projectId,
		renderJobId: orphanScenario.job.id,
		renderAttemptId: orphanScenario.attempt.id,
		attemptNumber: 1,
		outputReservationId: orphanScenario.attempt.outputReservationId,
	});
	assert(
		orphanInspection.status === "PROVEN_ORPHAN",
		"Terminal unreferenced output must be classified as a proven orphan.",
	);
	await db
		.update(renderAttempt)
		.set({ status: "RUNNING", finishedAt: null })
		.where(eq(renderAttempt.id, orphanScenario.attempt.id));
	await db
		.update(renderJob)
		.set({ status: "RUNNING", finishedAt: null })
		.where(eq(renderJob.id, orphanScenario.job.id));
	let orphanDeletionRejected = false;
	try {
		await orphanService.deleteProvenRenderOutputOrphan({
			storage: outputStorage,
			workspaceId,
			projectId,
			renderJobId: orphanScenario.job.id,
			renderAttemptId: orphanScenario.attempt.id,
			attemptNumber: 1,
			outputReservationId: orphanScenario.attempt.outputReservationId,
			byteSize: deterministicRenderOutputFixtureProvenance.byteSize,
			checksumSha256: deterministicRenderOutputFixtureProvenance.sha256,
		});
	} catch (error) {
		orphanDeletionRejected =
			error instanceof Error &&
			error.message === "RENDER_OUTPUT_ORPHAN_NOT_PROVEN";
	}
	assert(
		orphanDeletionRejected,
		"A stale orphan inspection must be rejected before physical deletion.",
	);
	assert(
		(await outputStorage.head(outputKey(orphanScenario))) !== null,
		"A stale orphan inspection must not delete an output after ownership becomes active.",
	);
	await db
		.update(renderAttempt)
		.set({ status: "FAILED", finishedAt: new Date() })
		.where(eq(renderAttempt.id, orphanScenario.attempt.id));
	await db
		.update(renderJob)
		.set({ status: "FAILED", finishedAt: new Date() })
		.where(eq(renderJob.id, orphanScenario.job.id));
	await orphanService.deleteProvenRenderOutputOrphan({
		storage: outputStorage,
		workspaceId,
		projectId,
		renderJobId: orphanScenario.job.id,
		renderAttemptId: orphanScenario.attempt.id,
		attemptNumber: 1,
		outputReservationId: orphanScenario.attempt.outputReservationId,
		byteSize: deterministicRenderOutputFixtureProvenance.byteSize,
		checksumSha256: deterministicRenderOutputFixtureProvenance.sha256,
	});
	assert(
		(await outputStorage.head(outputKey(orphanScenario))) === null,
		"A proven orphan may be physically deleted only after the final ownership check.",
	);

	const completedWithoutArtifact = await prepareArtifactScenario(
		"completed-without-artifact",
		"RUNNING",
	);
	await outputStorage.createOnce({
		storageKey: outputKey(completedWithoutArtifact),
		body: fixtureBody(),
	});
	const impossibleCompletedAt = new Date();
	await db
		.update(renderAttempt)
		.set({ status: "COMPLETED", finishedAt: impossibleCompletedAt })
		.where(eq(renderAttempt.id, completedWithoutArtifact.attempt.id));
	await db
		.update(renderJob)
		.set({ status: "COMPLETED", finishedAt: impossibleCompletedAt })
		.where(eq(renderJob.id, completedWithoutArtifact.job.id));
	const impossibleCompletedInspection =
		await orphanService.inspectRenderOutputOwnership({
			storage: outputStorage,
			workspaceId,
			projectId,
			renderJobId: completedWithoutArtifact.job.id,
			renderAttemptId: completedWithoutArtifact.attempt.id,
			attemptNumber: 1,
			outputReservationId: completedWithoutArtifact.attempt.outputReservationId,
		});
	assert(
		impossibleCompletedInspection.status === "PROTECTED",
		"Attempt COMPLETED without an Artifact must remain protected from orphan deletion.",
	);
	let impossibleCompletedDeletionRejected = false;
	try {
		await orphanService.deleteProvenRenderOutputOrphan({
			storage: outputStorage,
			workspaceId,
			projectId,
			renderJobId: completedWithoutArtifact.job.id,
			renderAttemptId: completedWithoutArtifact.attempt.id,
			attemptNumber: 1,
			outputReservationId: completedWithoutArtifact.attempt.outputReservationId,
			byteSize: deterministicRenderOutputFixtureProvenance.byteSize,
			checksumSha256: deterministicRenderOutputFixtureProvenance.sha256,
		});
	} catch (error) {
		impossibleCompletedDeletionRejected =
			error instanceof Error &&
			error.message === "RENDER_OUTPUT_ORPHAN_NOT_PROVEN";
	}
	assert(
		impossibleCompletedDeletionRejected &&
			(await outputStorage.head(outputKey(completedWithoutArtifact))) !== null,
		"An impossible completed state must never be physically deleted as an orphan.",
	);
	console.log(
		"21D immutable Artifact atomic finalize, stale-worker fencing, idempotency, and trusted reconciliation: PASS",
	);

	const allAttempts = await db
		.select({ reservation: renderAttempt.outputReservationId })
		.from(renderAttempt);
	assert(
		new Set(allAttempts.map((row) => row.reservation)).size ===
			allAttempts.length,
		"Every Attempt must have a unique server reservation.",
	);
	console.log(
		"21C idempotency, active dedup, claim concurrency, fencing, heartbeat, and reservation uniqueness: PASS",
	);
} finally {
	await pool.end();
	for (const folder of temporaryFolders)
		await rm(folder, { recursive: true, force: true });
}
