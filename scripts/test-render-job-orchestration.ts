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

type Journal = { entries: Array<{ idx: number; tag: string }> };
const migrationsRoot = resolve("packages/db/src/migrations");
const temporaryFolders: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
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
	const job = await repository.createRenderJob({
		actor: { workspaceId, userId },
		projectId,
		requestSpec,
		idempotencyKey: `render-idem-${randomUUID()}`,
	});
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
		await repository.markExecutionStarted({
			jobId: job.id,
			attemptId: reclaimed.attempt.id,
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
			leaseOwner: "worker-retry",
		})),
		"Stale execution-start CAS must be rejected.",
	);
	assert(
		!(await repository.markIndeterminate({
			attemptId: reclaimed.attempt.id,
			jobId: job.id,
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
			leaseOwner: "wrong-owner",
		})),
		"Wrong owner heartbeat must be fenced.",
	);
	assert(
		await repository.heartbeatRenderAttempt({
			attemptId: secondClaim.attempt.id,
			jobId: secondJob.id,
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
	assert(
		await repository.requeueBlockedRenderJob(
			{ workspaceId, userId },
			blockedJob.id,
		),
		"A business-blocked Job must have an explicit requeue path.",
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
