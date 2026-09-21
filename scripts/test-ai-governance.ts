import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const url = process.env.AFFICHANNEL_US29_TEST_DATABASE_URL?.trim();
const confirmation = process.env.AFFICHANNEL_US29_TEST_DATABASE_CONFIRM;
if (!url || confirmation !== "DISPOSABLE_US29_DB_CONFIRMED") {
	throw new Error(
		"REFUSED: US29 requires an explicit disposable loopback PostgreSQL authority.",
	);
}
const parsedUrl = new URL(url);
if (
	!(
		parsedUrl.protocol === "postgres:" || parsedUrl.protocol === "postgresql:"
	) ||
	parsedUrl.hostname !== "127.0.0.1"
) {
	throw new Error("REFUSED: US29 database must be loopback-only PostgreSQL.");
}

process.env.NODE_ENV = "test";
process.env.SKIP_ENV_VALIDATION = "1";
process.env.AFFICHANNEL_AI_TEST_MODE = "1";
process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = url;
process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM = "DISPOSABLE_DB_CONFIRMED";
for (const key of ["DATABASE_URL", "DATABASE_URL_DIRECT"] as const) {
	delete process.env[key];
}

const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { drizzle } = await import("drizzle-orm/node-postgres");
const { and, eq } = await import("drizzle-orm");
const { createNodePostgresPool } = await import(
	"../packages/db/src/node-postgres-test-adapter.ts"
);
const {
	aiGovernanceSettings,
	aiOperation,
	aiOperationAudit,
	aiBudgetReservation,
	db,
	user,
	workspace,
} = await import("../packages/db/src/index.ts");
const {
	AiGovernanceError,
	executeDeterministicTestOperation,
	getAiBudgetState,
	getAiGovernanceSettings,
	getAiOperation,
	getAiReleaseGateStatus,
	getAllowedAiRecoveryActions,
	getDeterministicAdapterCallCount,
	listAiOperations,
	listAiProviderRegistry,
	prepareAiOperation,
	reconcileAiOperation,
	updateAiGovernanceSettings,
} = await import("../packages/api/src/services/ai-governance-service.ts");
const { aiGovernanceSettingsInputSchema, governedOperationInputSchema } =
	await import("@affichannel/core");

const pool = createNodePostgresPool(url);
const actor = {
	workspaceId: `us29-workspace-${randomUUID()}`,
	userId: `us29-user-${randomUUID()}`,
};
const otherActor = {
	workspaceId: `us29-other-${randomUUID()}`,
	userId: `us29-other-user-${randomUUID()}`,
};
const migrationsFolder = resolve("packages/db/src/migrations");

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function expectCode(code: string, callback: () => Promise<unknown>) {
	try {
		await callback();
	} catch (error) {
		assert(
			error instanceof AiGovernanceError,
			`${code}: expected AiGovernanceError`,
		);
		assert(error.code === code, `${code}: received ${error.code}`);
		return;
	}
	throw new Error(`${code}: expected rejection`);
}

async function configure(
	input: Partial<Parameters<typeof updateAiGovernanceSettings>[1]> = {},
) {
	const current = await getAiGovernanceSettings(actor);
	return updateAiGovernanceSettings(actor, {
		expectedVersion: current.version > 0 ? current.version : null,
		providerId: "deterministic",
		modelId: "deterministic-text-v1",
		providerEnabled: true,
		modelEnabled: true,
		killSwitch: false,
		pricingVersion: "deterministic-text.v2",
		budgetPeriod: "MONTHLY",
		budgetLimitMicros: 100,
		budgetCurrency: "VND",
		...input,
	});
}

function operationInput(key: string, prompt = key) {
	return {
		operationKind: "TEXT_GENERATION" as const,
		capability: "TEXT_GENERATION" as const,
		idempotencyKey: key,
		semanticInput: {
			prompt,
			inputTokens: 8,
			outputTokens: 0,
			requestOptions: { temperature: 0 },
		},
	};
}

async function prepare(key: string, prompt = key) {
	return prepareAiOperation(actor, operationInput(key, prompt));
}

try {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
	await migrate(drizzle(pool), { migrationsFolder });
	await db.insert(user).values([
		{
			id: actor.userId,
			name: "US29 Test",
			email: `${actor.userId}@example.test`,
			emailVerified: true,
		},
		{
			id: otherActor.userId,
			name: "US29 Other",
			email: `${otherActor.userId}@example.test`,
			emailVerified: true,
		},
	]);
	await db.insert(workspace).values([
		{ id: actor.workspaceId, name: "US29 disposable", timezone: "UTC" },
		{ id: otherActor.workspaceId, name: "US29 other", timezone: "UTC" },
	]);

	const registry = await listAiProviderRegistry();
	assert(
		registry.providers.some(
			(provider) => provider.providerId === "deterministic",
		),
		"Server registry must expose deterministic provider.",
	);
	assert(
		registry.pricing.every(
			(pricing) => !("apiKey" in pricing) && !("secret" in pricing),
		),
		"Registry response must not expose secrets.",
	);
	await expectCode("AI_MODEL_NOT_FOUND", () =>
		updateAiGovernanceSettings(actor, {
			expectedVersion: null,
			providerId: "deterministic",
			modelId: "client-override",
			providerEnabled: true,
			modelEnabled: true,
			killSwitch: false,
			pricingVersion: "deterministic-text.v2",
			budgetPeriod: "MONTHLY",
			budgetLimitMicros: 100,
			budgetCurrency: "VND",
		}),
	);
	assert(
		!governedOperationInputSchema.safeParse({
			...operationInput(`unknown-${randomUUID()}`),
			providerId: "apikeyfun",
		}).success,
		"Operation input must reject client provider override.",
	);

	await configure({ budgetLimitMicros: 10 });
	const concurrent = await Promise.allSettled([
		prepare(`concurrent-a-${randomUUID()}`, "concurrent-a"),
		prepare(`concurrent-b-${randomUUID()}`, "concurrent-b"),
	]);
	assert(
		concurrent.filter((result) => result.status === "fulfilled").length === 1,
		"Exactly one concurrent reservation must succeed.",
	);
	assert(
		concurrent.filter(
			(result) =>
				result.status === "rejected" &&
				result.reason instanceof AiGovernanceError &&
				result.reason.code === "AI_BUDGET_EXCEEDED",
		).length === 1,
		"Exactly one concurrent reservation must fail closed on budget.",
	);
	const concurrentBudget = await getAiBudgetState(actor);
	assert(
		concurrentBudget.reservedMicros === 8 &&
			concurrentBudget.reservedMicros + concurrentBudget.settledMicros <=
				concurrentBudget.budgetLimitMicros,
		"Reservation must stay within budget.",
	);
	const concurrencyOperation = concurrent.find(
		(result): result is PromiseFulfilledResult<{ id: string }> =>
			result.status === "fulfilled",
	)?.value;
	assert(concurrencyOperation, "Concurrent success operation missing.");
	await executeDeterministicTestOperation(
		actor,
		concurrencyOperation.id,
		"success",
	);
	await configure({ budgetLimitMicros: 100 });

	const completed = await prepare(`success-${randomUUID()}`, "success");
	const completedResult = await executeDeterministicTestOperation(
		actor,
		completed.id,
		"success",
	);
	assert(
		completedResult.status === "COMPLETED" && completedResult.providerRequestId,
		"Deterministic success must finalize with providerRequestId.",
	);
	assert(
		getDeterministicAdapterCallCount(completed.id) === 1,
		"Success adapter call count must be one.",
	);
	const replay = await prepare(completed.idempotencyKey, "success");
	assert(
		replay.id === completed.id &&
			getDeterministicAdapterCallCount(completed.id) === 1,
		"Completed idempotency replay must not call adapter again.",
	);

	const definitive = await prepare(`definitive-${randomUUID()}`, "definitive");
	assert(
		(
			await executeDeterministicTestOperation(
				actor,
				definitive.id,
				"definitive_failure",
			)
		).status === "FAILED",
		"Definitive failure must be FAILED.",
	);
	const beforeSend = await prepare(
		`before-send-${randomUUID()}`,
		"before-send",
	);
	assert(
		(
			await executeDeterministicTestOperation(
				actor,
				beforeSend.id,
				"timeout_before_send",
			)
		).status === "FAILED",
		"Timeout before send must release as FAILED.",
	);
	const uncertain = await prepare(`uncertain-${randomUUID()}`, "uncertain");
	assert(
		(
			await executeDeterministicTestOperation(
				actor,
				uncertain.id,
				"timeout_after_possible_send",
			)
		).status === "INDETERMINATE",
		"Possible send timeout must be INDETERMINATE.",
	);
	const uncertainReplay = await prepare(
		`uncertain-replay-${randomUUID()}`,
		"uncertain",
	);
	assert(
		uncertainReplay.id === uncertain.id &&
			getDeterministicAdapterCallCount(uncertain.id) === 1,
		"Canonical hash must prevent blind uncertain replay.",
	);
	assert(
		(await getAllowedAiRecoveryActions(actor, uncertain.id)).includes(
			"ACKNOWLEDGE_UNRESOLVED",
		),
		"Uncertain operation must expose explicit recovery only.",
	);

	const stale = await prepare(`stale-${randomUUID()}`, "stale");
	await db
		.update(aiOperation)
		.set({
			leaseOwner: "stale-worker",
			leaseExpiresAt: new Date(Date.now() - 10_000),
			callStage: "NOT_STARTED",
		})
		.where(eq(aiOperation.id, stale.id));
	assert(
		(await executeDeterministicTestOperation(actor, stale.id, "success"))
			.status === "COMPLETED",
		"Expired NOT_STARTED lease must be safely reclaimable.",
	);
	const stalePossible = await prepare(
		`stale-possible-${randomUUID()}`,
		"stale-possible",
	);
	await db
		.update(aiOperation)
		.set({
			leaseOwner: "stale-worker",
			leaseExpiresAt: new Date(Date.now() - 10_000),
			callStage: "POSSIBLY_SENT",
		})
		.where(eq(aiOperation.id, stalePossible.id));
	assert(
		(
			await executeDeterministicTestOperation(
				actor,
				stalePossible.id,
				"success",
			)
		).status === "INDETERMINATE" &&
			getDeterministicAdapterCallCount(stalePossible.id) === 0,
		"Expired POSSIBLY_SENT lease must not retry adapter.",
	);

	const orphan = await prepare(`orphan-${randomUUID()}`, "orphan");
	assert(
		(
			await executeDeterministicTestOperation(
				actor,
				orphan.id,
				"orphan_artifact",
			)
		).status === "INDETERMINATE",
		"Orphan artifact must remain indeterminate before recovery.",
	);
	const orphanAttached = await reconcileAiOperation(
		actor,
		orphan.id,
		"ATTACH_ORPHAN_ARTIFACT",
	);
	assert(
		orphanAttached.status === "COMPLETED",
		`Explicit orphan attach must settle once: ${JSON.stringify(orphanAttached)}`,
	);
	assert(
		(await reconcileAiOperation(actor, orphan.id, "ATTACH_ORPHAN_ARTIFACT"))
			.status === "COMPLETED" &&
			getDeterministicAdapterCallCount(orphan.id) === 1,
		"Orphan recovery replay must be idempotent and adapter-free.",
	);
	const dbFailure = await prepare(`db-failure-${randomUUID()}`, "db-failure");
	assert(
		(await executeDeterministicTestOperation(actor, dbFailure.id, "db_failure"))
			.status === "INDETERMINATE",
		"DB failure simulation must not become success.",
	);
	assert(
		(await reconcileAiOperation(actor, dbFailure.id, "RECONCILE")).status ===
			"INDETERMINATE",
		"Unresolved reconciliation must remain indeterminate.",
	);

	const redacted = await prepareAiOperation(actor, {
		...operationInput(`redaction-${randomUUID()}`, "redaction"),
		semanticInput: {
			prompt: "redaction",
			inputTokens: 8,
			outputTokens: 0,
			requestOptions: {
				apiKey: "api-secret",
				authorization: "Bearer api-secret",
			},
		},
	});
	const [redactedRow] = await db
		.select()
		.from(aiOperation)
		.where(eq(aiOperation.id, redacted.id));
	assert(
		!JSON.stringify(redactedRow?.requestMetadataJson).includes("api-secret"),
		"Request metadata must redact secret values.",
	);
	const auditRows = await db
		.select()
		.from(aiOperationAudit)
		.where(
			and(
				eq(aiOperationAudit.workspaceId, actor.workspaceId),
				eq(aiOperationAudit.operationId, redacted.id),
			),
		);
	assert(
		auditRows.every(
			(row) => !JSON.stringify(row.safeMetadataJson).includes("api-secret"),
		),
		"Audit metadata must redact secret values.",
	);

	assert(
		(await listAiOperations(otherActor)).length === 0,
		"Other workspace must not see operations.",
	);
	await expectCode("AI_OPERATION_NOT_FOUND", () =>
		getAiOperation(otherActor, completed.id),
	);

	const versionOne = await prepare(`pricing-v1-${randomUUID()}`, "pricing-v1");
	assert(
		versionOne.pricingVersion === "deterministic-text.v2",
		"Initial pricing version must be persisted.",
	);
	await executeDeterministicTestOperation(actor, versionOne.id, "success");
	const changed = await configure({
		pricingVersion: "deterministic-text.v1",
		budgetLimitMicros: 1000,
	});
	assert(
		changed.pricingVersion === "deterministic-text.v1",
		"Pricing version update must be server-owned and versioned.",
	);
	const versionTwo = await prepare(
		`pricing-v1-new-${randomUUID()}`,
		"pricing-v1-new",
	);
	assert(
		versionTwo.pricingVersion === "deterministic-text.v1" &&
			versionOne.pricingVersion !== versionTwo.pricingVersion,
		"Historical operation must retain original pricing version.",
	);
	await configure({ killSwitch: true });
	await expectCode("AI_KILL_SWITCH_ACTIVE", () =>
		prepare(`killed-${randomUUID()}`),
	);
	await configure({ killSwitch: false });
	const currentSettings = await getAiGovernanceSettings(actor);
	await db
		.update(aiGovernanceSettings)
		.set({ pricingVersion: null })
		.where(eq(aiGovernanceSettings.workspaceId, actor.workspaceId));
	await expectCode("AI_PRICING_UNAVAILABLE", () =>
		prepare(`missing-pricing-${randomUUID()}`),
	);
	await configure({
		expectedVersion: currentSettings.version,
		pricingVersion: "deterministic-text.v1",
	});

	const paidSettingsInput = aiGovernanceSettingsInputSchema.parse({
		expectedVersion: (await getAiGovernanceSettings(actor)).version,
		providerId: "apikeyfun",
		modelId: "claude-sonnet-4-6",
		providerEnabled: true,
		modelEnabled: true,
		killSwitch: false,
		pricingVersion: "apikeyfun-text.v1",
		budgetPeriod: "MONTHLY",
		budgetLimitMicros: 100,
		budgetCurrency: "USD",
	});
	await updateAiGovernanceSettings(actor, paidSettingsInput);
	await expectCode("AI_PRODUCTION_RELEASE_BLOCKED", () =>
		prepareAiOperation(actor, {
			...operationInput(`paid-text-${randomUUID()}`, "paid-text"),
			semanticInput: { prompt: "paid-text", inputTokens: 1, outputTokens: 1 },
		}),
	);
	await expectCode("AI_CAPABILITY_NOT_ALLOWED", () =>
		prepareAiOperation(actor, {
			operationKind: "IMAGE_TO_VIDEO",
			capability: "IMAGE_TO_VIDEO",
			idempotencyKey: `paid-image-${randomUUID()}`,
			semanticInput: {
				sourceFingerprint: "source",
				motionPlanFingerprint: "motion",
				durationSeconds: 5,
			},
		}),
	);
	assert(
		getAiReleaseGateStatus().paidExecutionReleased === false,
		"Future US28 paid release gate must remain closed.",
	);
	await configure({
		pricingVersion: "deterministic-text.v1",
		budgetCurrency: "VND",
		budgetLimitMicros: 1000,
	});

	const migrationCount = await pool.query(
		"select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_name like 'ai_%' and table_name <> 'ai_settings'",
	);
	assert(
		Number(migrationCount.rows[0]?.count) === 6,
		"Zero-to-current migration must create six AI governance tables.",
	);
	const reservations = await db
		.select()
		.from(aiBudgetReservation)
		.where(eq(aiBudgetReservation.workspaceId, actor.workspaceId));
	assert(
		reservations.some((reservation) => reservation.status === "UNCERTAIN") &&
			reservations.some((reservation) => reservation.status === "SETTLED"),
		"Acceptance must retain both uncertain and settled reservation evidence.",
	);
	console.log(
		"US29/US30 registry, pricing, reservation concurrency, idempotency, uncertainty, lease, recovery, redaction, workspace isolation, kill switch and release gate: PASS",
	);
} finally {
	await pool.end();
}
