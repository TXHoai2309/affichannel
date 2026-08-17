import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ScriptVersionEditableSnapshot } from "@affichannel/core";
import dotenv from "dotenv";

dotenv.config({
	path: resolve(process.cwd(), "apps/web/.env"),
	override: true,
});

const { SCRIPT_OUTPUT_SCHEMA_VERSION, scriptGenerationSections } = await import(
	"@affichannel/core"
);
const {
	contentBrief,
	db,
	factDependency,
	product,
	project,
	projectStepStatus,
	scriptGeneration,
	scriptVersion,
	user,
} = await import("@affichannel/db");
const { and, eq, inArray } = await import("drizzle-orm");
const {
	autosaveScriptVersion,
	getCurrentScriptVersion,
	initializeScriptVersion,
} = await import("../packages/api/src/services/script-version-service");
const { getWorkspaceActor } = await import(
	"../packages/api/src/services/workspace"
);

const email = process.env.E2E_AUTH_EMAIL?.trim();

if (!email) {
	throw new Error("E2E_AUTH_EMAIL is required for ScriptVersion integration.");
}

const baseSnapshot: ScriptVersionEditableSnapshot = {
	schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
	language: "vi-VN",
	hookVariants: [
		{ key: "hook-1", text: "Bạn có đang dùng tai nghe sai cách?" },
		{ key: "hook-2", text: "Một thay đổi nhỏ cho trải nghiệm nghe tốt hơn." },
		{ key: "hook-3", text: "Đây là điều mình kiểm tra đầu tiên." },
	],
	voiceoverSegments: [
		{ key: "intro", text: "Mình thử sản phẩm trong một ngày." },
	],
	scenes: [
		{
			order: 1,
			durationSeconds: 5,
			visualDirection: "Cầm sản phẩm trước máy quay.",
			onScreenText: "Trải nghiệm thực tế",
			voiceoverSegmentKeys: ["intro"],
		},
	],
	cta: { text: "Xem thêm thông tin ở phần mô tả." },
	caption: "Một trải nghiệm ngắn gọn và dễ kiểm chứng.",
	hashtags: ["#review"],
	disclosure: "Nội dung có liên kết affiliate.",
	claims: [],
};

type Fixture = {
	workspaceId: string;
	userId: string;
	projectIds: string[];
	productIds: string[];
	generationIds: string[];
	dependencyIds: string[];
};

const fixture: Fixture = {
	workspaceId: "",
	userId: "",
	projectIds: [],
	productIds: [],
	generationIds: [],
	dependencyIds: [],
};

function hash(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

function outputSnapshot() {
	return structuredClone({
		schemaVersion: baseSnapshot.schemaVersion,
		language: baseSnapshot.language,
		hookVariants: baseSnapshot.hookVariants,
		voiceoverSegments: baseSnapshot.voiceoverSegments,
		scenes: baseSnapshot.scenes,
		cta: baseSnapshot.cta,
		caption: baseSnapshot.caption,
		hashtags: baseSnapshot.hashtags,
		disclosure: baseSnapshot.disclosure,
		claims: baseSnapshot.claims,
	});
}

async function createFixtureProject(
	actor: {
		workspaceId: string;
		userId: string;
	},
	label: string,
) {
	const productId = randomUUID();
	const projectId = randomUUID();
	const now = new Date();
	await db.insert(product).values({
		id: productId,
		workspaceId: actor.workspaceId,
		name: `US009 Phase1 Product ${label}`,
		category: "Audio",
		status: "active",
		currency: "VND",
		createdByUserId: actor.userId,
	});
	await db.insert(project).values({
		id: projectId,
		workspaceId: actor.workspaceId,
		name: `US009 Phase1 Project ${label}`,
		productId,
		currentStepKey: "product",
		createdByUserId: actor.userId,
	});
	await db.insert(contentBrief).values({
		id: randomUUID(),
		projectId,
		platform: "tiktok",
		goal: "Kiểm thử ScriptVersion foundation",
		durationSeconds: 30,
		angle: "Trải nghiệm thực tế",
		description: "Fixture integration.",
	});
	await db.insert(projectStepStatus).values(
		[
			"product",
			"content",
			"fact-lock",
			"voice",
			"video",
			"preview",
			"completed",
		].map((stepKey) => ({
			id: randomUUID(),
			projectId,
			stepKey,
			status: stepKey === "product" ? "not_started" : "not_started",
			createdAt: now,
			updatedAt: now,
		})),
	);
	fixture.projectIds.push(projectId);
	fixture.productIds.push(productId);
	return projectId;
}

async function createCompletedGeneration(
	actor: { workspaceId: string; userId: string },
	projectId: string,
	label: string,
) {
	const id = randomUUID();
	const now = new Date();
	await db.insert(scriptGeneration).values({
		id,
		workspaceId: actor.workspaceId,
		projectId,
		createdByUserId: actor.userId,
		idempotencyKey: `us009-phase1-${label}-${id}`,
		requestHash: hash(`request-${id}`),
		parentGenerationId: null,
		mode: "full",
		provider: "deterministic",
		model: "phase1-test-model",
		promptVersion: "script-prompt.v2",
		outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		inputSnapshotJson: {
			snapshotVersion: "script-input.v2",
			facts: [{ id: `phase1-fact-${label}`, revision: 1 }],
		},
		inputHash: hash(`input-${id}`),
		promptHash: hash(`prompt-${id}`),
		status: "completed",
		outputJson: outputSnapshot(),
		validSections: [...scriptGenerationSections],
		invalidSections: [],
		providerRequestId: `phase1-provider-${id}`,
		inputTokens: 10,
		outputTokens: 20,
		estimatedCostMicros: null,
		actualCostMicros: null,
		currency: null,
		errorCode: null,
		finishedAt: now,
		createdAt: now,
	});
	fixture.generationIds.push(id);
	return id;
}

async function createNonEditableGeneration(
	actor: { workspaceId: string; userId: string },
	projectId: string,
	status: "partial" | "failed" | "indeterminate" | "pending",
	label: string,
) {
	const id = randomUUID();
	const now = new Date();
	const validSections = status === "partial" ? ["hook"] : [];
	const invalidSections =
		status === "partial"
			? scriptGenerationSections.filter((section) => section !== "hook")
			: [];
	await db.insert(scriptGeneration).values({
		id,
		workspaceId: actor.workspaceId,
		projectId,
		createdByUserId: actor.userId,
		idempotencyKey: `us009-phase1-${label}-${id}`,
		requestHash: hash(`request-${id}`),
		parentGenerationId: null,
		mode: "full",
		provider: "deterministic",
		model: "phase1-test-model",
		promptVersion: "script-prompt.v2",
		outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		inputSnapshotJson: { snapshotVersion: "script-input.v2", facts: [] },
		inputHash: hash(`input-${id}`),
		promptHash: hash(`prompt-${id}`),
		status,
		outputJson: status === "partial" ? outputSnapshot() : null,
		validSections,
		invalidSections,
		providerRequestId: null,
		inputTokens: null,
		outputTokens: null,
		estimatedCostMicros: null,
		actualCostMicros: null,
		currency: null,
		errorCode: status === "failed" ? "AI_PROVIDER_ERROR" : null,
		finishedAt: status === "pending" ? null : now,
		createdAt: now,
	});
	fixture.generationIds.push(id);
	return id;
}

async function createDependency(
	actor: { workspaceId: string },
	generationId: string,
	state: "current" | "invalidated",
) {
	const id = randomUUID();
	await db.insert(factDependency).values({
		id,
		workspaceId: actor.workspaceId,
		productFactId: `phase1-fact-${id}`,
		factRevision: 1,
		dependentType: "script_generation",
		dependentId: generationId,
		detachedAt: null,
		invalidatedAt: state === "invalidated" ? new Date() : null,
		invalidationReason: state === "invalidated" ? "fact_changed" : null,
	});
	fixture.dependencyIds.push(id);
}

async function expectError(operation: () => Promise<unknown>, code: string) {
	try {
		await operation();
	} catch (error) {
		if (error && typeof error === "object" && "code" in error) {
			if ((error as { code?: string }).code === code) return error;
		}
		throw error;
	}
	throw new Error(`Expected ${code} but operation succeeded.`);
}

async function run() {
	const [fixedUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	if (!fixedUser) throw new Error("E2E fixed account does not exist.");
	const actor = await getWorkspaceActor(fixedUser.id);
	if (!actor) throw new Error("E2E fixed account has no internal workspace.");
	fixture.workspaceId = actor.workspaceId;
	fixture.userId = actor.userId;

	try {
		const primaryProjectId = await createFixtureProject(actor, "primary");
		if ((await getCurrentScriptVersion(actor, primaryProjectId)) !== null) {
			throw new Error("Empty project did not return a null current version.");
		}
		const primaryGenerationId = await createCompletedGeneration(
			actor,
			primaryProjectId,
			"primary",
		);
		await createDependency(actor, primaryGenerationId, "current");

		const initialized = await initializeScriptVersion(actor, {
			projectId: primaryProjectId,
			sourceGenerationId: primaryGenerationId,
		});
		if (initialized.revision !== 1 || initialized.status !== "draft") {
			throw new Error("Initialize did not create revision 1 draft.");
		}
		if (initialized.editableSnapshot.claimsSourceRevision !== 1) {
			throw new Error("Initial claims revision was not pinned.");
		}

		const hashtagSave = await autosaveScriptVersion(actor, {
			scriptVersionId: initialized.id,
			baseRevision: initialized.revision,
			editableSnapshot: {
				...initialized.editableSnapshot,
				hashtags: ["#review", "#tai-nghe"],
			},
		});
		if (
			hashtagSave.revision !== 2 ||
			hashtagSave.editableSnapshot.claimsStatus !== "current"
		) {
			throw new Error("Non-claim autosave did not preserve current claims.");
		}

		const claimEdit = await autosaveScriptVersion(actor, {
			scriptVersionId: initialized.id,
			baseRevision: hashtagSave.revision,
			editableSnapshot: {
				...hashtagSave.editableSnapshot,
				voiceoverSegments: [
					{ key: "intro", text: "Mình đã kiểm tra kỹ sản phẩm." },
				],
			},
		});
		if (
			claimEdit.revision !== 3 ||
			claimEdit.editableSnapshot.claimsStatus !== "stale"
		) {
			throw new Error("Claim-relevant autosave did not stale claims.");
		}

		const conflict = await expectError(
			() =>
				autosaveScriptVersion(actor, {
					scriptVersionId: initialized.id,
					baseRevision: hashtagSave.revision,
					editableSnapshot: hashtagSave.editableSnapshot,
				}),
			"SCRIPT_VERSION_CONFLICT",
		);
		if (
			!(conflict && "metadata" in conflict) ||
			(conflict as { metadata?: { latestRevision?: number } }).metadata
				?.latestRevision !== 3
		) {
			throw new Error("Conflict did not report latest revision 3.");
		}

		const reopened = await getCurrentScriptVersion(actor, primaryProjectId);
		if (reopened?.revision !== 3 || reopened.id !== initialized.id) {
			throw new Error("Re-query did not return persisted current draft.");
		}
		if (
			reopened.editableSnapshot.voiceoverSegments[0]?.text !==
			"Mình đã kiểm tra kỹ sản phẩm."
		) {
			throw new Error("Conflict changed the authoritative snapshot.");
		}

		await expectError(
			() =>
				autosaveScriptVersion(actor, {
					scriptVersionId: initialized.id,
					baseRevision: reopened.revision,
					editableSnapshot: {
						...reopened.editableSnapshot,
						language: "en-US",
						claims: [{ text: "client claim", occurrence: { section: "cta" } }],
						claimsSourceRevision: 999,
						claimsStatus: "current",
					},
				}),
			"INVALID_SCRIPT_VERSION_SNAPSHOT",
		);
		const afterMetadataTamper = await getCurrentScriptVersion(
			actor,
			primaryProjectId,
		);
		if (afterMetadataTamper?.revision !== reopened.revision) {
			throw new Error("Rejected metadata tampering changed the draft.");
		}

		const metadataProtected = await autosaveScriptVersion(actor, {
			scriptVersionId: initialized.id,
			baseRevision: reopened.revision,
			editableSnapshot: {
				...reopened.editableSnapshot,
				hashtags: ["#metadata"],
				claimsSourceRevision: 999,
				claimsStatus: "current",
			},
		});
		if (
			metadataProtected.editableSnapshot.language !== "vi-VN" ||
			metadataProtected.editableSnapshot.claims.length !== 0 ||
			metadataProtected.editableSnapshot.claimsSourceRevision !== 1 ||
			metadataProtected.editableSnapshot.claimsStatus !== "stale"
		) {
			throw new Error("Client changed server-owned ScriptVersion metadata.");
		}

		const structuralTampering: Array<
			[
				string,
				(
					current: ScriptVersionEditableSnapshot,
				) => ScriptVersionEditableSnapshot,
			]
		> = [
			[
				"hook key",
				(current) => ({
					...current,
					hookVariants: [
						{ ...current.hookVariants[0], key: "hook-tampered" },
						...current.hookVariants.slice(1),
					],
				}),
			],
			[
				"voiceover key and scene reference",
				(current) => ({
					...current,
					voiceoverSegments: [{ key: "voiceover-tampered", text: "Voiceover" }],
					scenes: [
						{
							...current.scenes[0],
							voiceoverSegmentKeys: ["voiceover-tampered"],
						},
					],
				}),
			],
			[
				"scene structure",
				(current) => ({
					...current,
					scenes: [
						...current.scenes,
						{
							order: current.scenes.length + 1,
							durationSeconds: 5,
							visualDirection: "Cảnh thêm",
							onScreenText: null,
							voiceoverSegmentKeys: [],
						},
					],
				}),
			],
			[
				"claims and occurrence",
				(current) => ({
					...current,
					claims: [{ text: "Client claim", occurrence: { section: "cta" } }],
				}),
			],
			["language", (current) => ({ ...current, language: "en-US" })],
		];
		for (const [label, edit] of structuralTampering) {
			const before = await getCurrentScriptVersion(actor, primaryProjectId);
			if (!before) throw new Error(`Missing draft before ${label} tampering.`);
			await expectError(
				() =>
					autosaveScriptVersion(actor, {
						scriptVersionId: before.id,
						baseRevision: before.revision,
						editableSnapshot: edit(before.editableSnapshot),
					}),
				"INVALID_SCRIPT_VERSION_SNAPSHOT",
			);
			const after = await getCurrentScriptVersion(actor, primaryProjectId);
			if (
				!after ||
				after.revision !== before.revision ||
				JSON.stringify(after.editableSnapshot) !==
					JSON.stringify(before.editableSnapshot)
			) {
				throw new Error(`${label} tampering changed the persisted draft.`);
			}
		}
		const idempotent = await initializeScriptVersion(actor, {
			projectId: primaryProjectId,
			sourceGenerationId: primaryGenerationId,
		});
		if (idempotent.id !== initialized.id) {
			throw new Error("Same source initialization was not idempotent.");
		}

		const secondGenerationId = await createCompletedGeneration(
			actor,
			primaryProjectId,
			"second-source",
		);
		await expectError(
			() =>
				initializeScriptVersion(actor, {
					projectId: primaryProjectId,
					sourceGenerationId: secondGenerationId,
				}),
			"SCRIPT_VERSION_DRAFT_ALREADY_EXISTS",
		);
		const afterNewSource = await getCurrentScriptVersion(
			actor,
			primaryProjectId,
		);
		if (afterNewSource?.sourceGenerationId !== primaryGenerationId) {
			throw new Error("New generation replaced the pinned current draft.");
		}

		await db.insert(scriptVersion).values({
			id: randomUUID(),
			workspaceId: actor.workspaceId,
			projectId: primaryProjectId,
			sourceGenerationId: primaryGenerationId,
			status: "saved",
			versionNumber: 1,
			editableSnapshotJson: reopened.editableSnapshot,
			revision: 1,
			createdByUserId: actor.userId,
			savedAt: new Date(),
		});
		const [saved] = await db
			.select({ id: scriptVersion.id })
			.from(scriptVersion)
			.where(
				and(
					eq(scriptVersion.projectId, primaryProjectId),
					eq(scriptVersion.status, "saved"),
				),
			)
			.limit(1);
		if (!saved) throw new Error("Saved version fixture was not created.");
		await expectError(
			() =>
				autosaveScriptVersion(actor, {
					scriptVersionId: saved.id,
					baseRevision: 1,
					editableSnapshot: reopened.editableSnapshot,
				}),
			"SCRIPT_VERSION_IMMUTABLE",
		);

		const concurrentProjectId = await createFixtureProject(actor, "concurrent");
		const concurrentGenerationId = await createCompletedGeneration(
			actor,
			concurrentProjectId,
			"concurrent",
		);
		const concurrentResults = await Promise.all(
			Array.from({ length: 2 }, () =>
				initializeScriptVersion(actor, {
					projectId: concurrentProjectId,
					sourceGenerationId: concurrentGenerationId,
				}),
			),
		);
		if (
			concurrentResults[0].id !== concurrentResults[1].id ||
			concurrentResults[0].revision !== 1
		) {
			throw new Error(
				"Concurrent initialization did not converge on one draft.",
			);
		}

		const invalidatedProjectId = await createFixtureProject(
			actor,
			"invalidated",
		);
		const invalidatedGenerationId = await createCompletedGeneration(
			actor,
			invalidatedProjectId,
			"invalidated",
		);
		await createDependency(actor, invalidatedGenerationId, "invalidated");
		await expectError(
			() =>
				initializeScriptVersion(actor, {
					projectId: invalidatedProjectId,
					sourceGenerationId: invalidatedGenerationId,
				}),
			"SCRIPT_GENERATION_INVALIDATED",
		);

		await expectError(
			() =>
				initializeScriptVersion(
					{ ...actor, workspaceId: "workspace-outside-scope" },
					{
						projectId: primaryProjectId,
						sourceGenerationId: primaryGenerationId,
					},
				),
			"SCRIPT_GENERATION_NOT_FOUND",
		);
		const outsideActor = { ...actor, workspaceId: "workspace-outside-scope" };
		if (
			(await getCurrentScriptVersion(outsideActor, primaryProjectId)) !== null
		) {
			throw new Error("Cross-workspace getCurrent leaked a draft.");
		}
		await expectError(
			() =>
				autosaveScriptVersion(outsideActor, {
					scriptVersionId: initialized.id,
					baseRevision: 1,
					editableSnapshot: initialized.editableSnapshot,
				}),
			"SCRIPT_VERSION_NOT_FOUND",
		);

		const [draftRows] = await Promise.all([
			db
				.select({ id: scriptVersion.id })
				.from(scriptVersion)
				.where(
					and(
						eq(scriptVersion.projectId, concurrentProjectId),
						eq(scriptVersion.status, "draft"),
					),
				),
		]);
		if (draftRows.length !== 1)
			throw new Error("Draft uniqueness proof failed.");

		for (const status of [
			"partial",
			"failed",
			"indeterminate",
			"pending",
		] as const) {
			const projectId = await createFixtureProject(actor, `reject-${status}`);
			const generationId = await createNonEditableGeneration(
				actor,
				projectId,
				status,
				`reject-${status}`,
			);
			await expectError(
				() =>
					initializeScriptVersion(actor, {
						projectId,
						sourceGenerationId: generationId,
					}),
				"SCRIPT_GENERATION_NOT_EDITABLE",
			);
		}

		console.log(
			"AFF-US-009 Phase 1 runtime proof passed: initialize, idempotency, concurrent convergence, getCurrent, explicit autosave merge, structural tamper rejection, final snapshot validation, claims stale, immutable saved version, invalidation guard, and workspace scope.",
		);
	} finally {
		await cleanup();
	}
}

async function cleanup() {
	if (fixture.generationIds.length > 0) {
		await db
			.delete(scriptVersion)
			.where(inArray(scriptVersion.sourceGenerationId, fixture.generationIds));
		await db
			.delete(factDependency)
			.where(inArray(factDependency.dependentId, fixture.generationIds));
		await db
			.delete(scriptGeneration)
			.where(inArray(scriptGeneration.id, fixture.generationIds));
	}
	if (fixture.projectIds.length > 0) {
		await db
			.delete(scriptVersion)
			.where(inArray(scriptVersion.projectId, fixture.projectIds));
		await db
			.delete(projectStepStatus)
			.where(inArray(projectStepStatus.projectId, fixture.projectIds));
		await db
			.delete(contentBrief)
			.where(inArray(contentBrief.projectId, fixture.projectIds));
		await db.delete(project).where(inArray(project.id, fixture.projectIds));
	}
	if (fixture.productIds.length > 0) {
		await db.delete(product).where(inArray(product.id, fixture.productIds));
	}
}

await run();
