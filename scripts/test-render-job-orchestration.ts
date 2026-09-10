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
	CompositionError,
	fingerprintOutputEncodingProfile,
	MP4_H264_AAC_V1,
} = await import("@affichannel/core");
const {
	compositionVersion,
	db,
	project,
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
