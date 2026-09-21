import {
	aiBudgetPeriods,
	aiOperationStatuses,
	aiProviderCallStages,
	aiReservationStatuses,
} from "@affichannel/core";
import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { project } from "./project";
import { workspace } from "./workspace";

const statusSql = (values: readonly string[]) =>
	sql.raw(values.map((value) => `'${value}'`).join(", "));

export const aiGovernanceSettings = pgTable(
	"ai_governance_settings",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		providerId: text("provider_id").notNull(),
		modelId: text("model_id").notNull(),
		providerEnabled: boolean("provider_enabled").notNull().default(false),
		modelEnabled: boolean("model_enabled").notNull().default(false),
		killSwitch: boolean("kill_switch").notNull().default(true),
		pricingVersion: text("pricing_version"),
		budgetPeriod: text("budget_period").notNull().default("MONTHLY"),
		budgetPeriodStart: date("budget_period_start", {
			mode: "string",
		}).notNull(),
		budgetLimitMicros: bigint("budget_limit_micros", {
			mode: "bigint",
		}).notNull(),
		budgetCurrency: text("budget_currency").notNull(),
		reservedMicros: bigint("reserved_micros", { mode: "bigint" })
			.notNull()
			.default(sql`0`),
		settledMicros: bigint("settled_micros", { mode: "bigint" })
			.notNull()
			.default(sql`0`),
		version: integer("version").notNull().default(1),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		updatedByUserId: text("updated_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		check(
			"ai_governance_settings_period_check",
			sql`${table.budgetPeriod} in (${statusSql(aiBudgetPeriods)})`,
		),
		check(
			"ai_governance_settings_amount_check",
			sql`${table.budgetLimitMicros} >= 0 and ${table.reservedMicros} >= 0 and ${table.settledMicros} >= 0`,
		),
		check(
			"ai_governance_settings_currency_check",
			sql`${table.budgetCurrency} ~ '^[A-Z]{3}$'`,
		),
		check("ai_governance_settings_version_check", sql`${table.version} > 0`),
		uniqueIndex("ai_governance_settings_workspace_unique").on(
			table.workspaceId,
		),
		index("ai_governance_settings_provider_idx").on(
			table.workspaceId,
			table.providerId,
			table.modelId,
		),
	],
);

export const aiPricingVersion = pgTable(
	"ai_pricing_version",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		providerId: text("provider_id").notNull(),
		modelId: text("model_id").notNull(),
		operationKind: text("operation_kind").notNull(),
		pricingVersion: text("pricing_version").notNull(),
		currency: text("currency").notNull(),
		unit: text("unit").notNull(),
		inputMicrosPerMillionTokens: bigint("input_micros_per_million_tokens", {
			mode: "bigint",
		}).notNull(),
		outputMicrosPerMillionTokens: bigint("output_micros_per_million_tokens", {
			mode: "bigint",
		}).notNull(),
		fixedMicros: bigint("fixed_micros", { mode: "bigint" })
			.notNull()
			.default(sql`0`),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"ai_pricing_version_amount_check",
			sql`${table.inputMicrosPerMillionTokens} >= 0 and ${table.outputMicrosPerMillionTokens} >= 0 and ${table.fixedMicros} >= 0`,
		),
		check(
			"ai_pricing_version_currency_check",
			sql`${table.currency} ~ '^[A-Z]{3}$'`,
		),
		check(
			"ai_pricing_version_unit_check",
			sql`${table.unit} in ('REQUEST', 'TOKENS')`,
		),
		uniqueIndex("ai_pricing_version_identity_unique").on(
			table.workspaceId,
			table.providerId,
			table.modelId,
			table.operationKind,
			table.pricingVersion,
		),
		index("ai_pricing_version_workspace_idx").on(
			table.workspaceId,
			table.createdAt,
		),
	],
);

export const aiOperation = pgTable(
	"ai_operation",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id").references(() => project.id, {
			onDelete: "restrict",
		}),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		operationKind: text("operation_kind").notNull(),
		capability: text("capability").notNull(),
		providerId: text("provider_id").notNull(),
		modelId: text("model_id").notNull(),
		requestHash: text("request_hash").notNull(),
		hashVersion: text("hash_version").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		correlationId: text("correlation_id").notNull(),
		requestMetadataJson: jsonb("request_metadata_json").notNull(),
		status: text("status").notNull().default("PENDING"),
		callStage: text("call_stage").notNull().default("NOT_STARTED"),
		leaseOwner: text("lease_owner"),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
		fenceToken: integer("fence_token").notNull().default(1),
		attemptCount: integer("attempt_count").notNull().default(0),
		providerRequestId: text("provider_request_id"),
		pricingVersion: text("pricing_version"),
		currency: text("currency"),
		estimatedCostMicros: bigint("estimated_cost_micros", {
			mode: "bigint",
		}).notNull(),
		reservedCostMicros: bigint("reserved_cost_micros", {
			mode: "bigint",
		}).notNull(),
		actualCostMicros: bigint("actual_cost_micros", { mode: "bigint" }),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		usageJson: jsonb("usage_json"),
		safeErrorJson: jsonb("safe_error_json"),
		artifactEvidenceJson: jsonb("artifact_evidence_json"),
		errorCategory: text("error_category"),
		latencyMs: integer("latency_ms"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
	},
	(table) => [
		check(
			"ai_operation_status_check",
			sql`${table.status} in (${statusSql(aiOperationStatuses)})`,
		),
		check(
			"ai_operation_call_stage_check",
			sql`${table.callStage} in (${statusSql(aiProviderCallStages)})`,
		),
		check(
			"ai_operation_hash_check",
			sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
		),
		check(
			"ai_operation_amount_check",
			sql`${table.estimatedCostMicros} >= 0 and ${table.reservedCostMicros} >= 0 and (${table.actualCostMicros} is null or ${table.actualCostMicros} >= 0)`,
		),
		check(
			"ai_operation_currency_check",
			sql`${table.currency} is null or ${table.currency} ~ '^[A-Z]{3}$'`,
		),
		check(
			"ai_operation_finished_shape_check",
			sql`(${table.status} = 'PENDING' and ${table.finishedAt} is null) or (${table.status} <> 'PENDING' and ${table.finishedAt} is not null)`,
		),
		check(
			"ai_operation_lease_shape_check",
			sql`(${table.leaseOwner} is null and ${table.leaseExpiresAt} is null) or (${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)`,
		),
		uniqueIndex("ai_operation_workspace_idempotency_unique").on(
			table.workspaceId,
			table.idempotencyKey,
		),
		uniqueIndex("ai_operation_workspace_hash_unique").on(
			table.workspaceId,
			table.requestHash,
		),
		uniqueIndex("ai_operation_workspace_provider_request_unique").on(
			table.workspaceId,
			table.providerRequestId,
		),
		index("ai_operation_workspace_created_idx").on(
			table.workspaceId,
			table.createdAt,
		),
		index("ai_operation_workspace_filter_idx").on(
			table.workspaceId,
			table.providerId,
			table.status,
			table.createdAt,
		),
		index("ai_operation_lease_idx").on(
			table.status,
			table.leaseExpiresAt,
			table.id,
		),
		index("ai_operation_project_idx").on(
			table.workspaceId,
			table.projectId,
			table.createdAt,
		),
	],
);

export const aiBudgetReservation = pgTable(
	"ai_budget_reservation",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		operationId: text("operation_id")
			.notNull()
			.references(() => aiOperation.id, { onDelete: "restrict" }),
		status: text("status").notNull().default("ACTIVE"),
		amountMicros: bigint("amount_micros", { mode: "bigint" }).notNull(),
		currency: text("currency").notNull(),
		periodStart: date("period_start", { mode: "string" }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		settledAt: timestamp("settled_at", { withTimezone: true }),
		releasedAt: timestamp("released_at", { withTimezone: true }),
	},
	(table) => [
		check(
			"ai_budget_reservation_status_check",
			sql`${table.status} in (${statusSql(aiReservationStatuses)})`,
		),
		check(
			"ai_budget_reservation_amount_check",
			sql`${table.amountMicros} >= 0 and ${table.currency} ~ '^[A-Z]{3}$'`,
		),
		uniqueIndex("ai_budget_reservation_operation_unique").on(table.operationId),
		index("ai_budget_reservation_workspace_status_idx").on(
			table.workspaceId,
			table.status,
			table.createdAt,
		),
	],
);

export const aiOperationAudit = pgTable(
	"ai_operation_audit",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		operationId: text("operation_id")
			.notNull()
			.references(() => aiOperation.id, { onDelete: "cascade" }),
		eventType: text("event_type").notNull(),
		status: text("status").notNull(),
		correlationId: text("correlation_id").notNull(),
		providerRequestId: text("provider_request_id"),
		safeMetadataJson: jsonb("safe_metadata_json"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("ai_operation_audit_operation_created_idx").on(
			table.operationId,
			table.createdAt,
		),
		index("ai_operation_audit_workspace_created_idx").on(
			table.workspaceId,
			table.createdAt,
		),
	],
);

export const aiReconciliation = pgTable(
	"ai_reconciliation",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		operationId: text("operation_id")
			.notNull()
			.references(() => aiOperation.id, { onDelete: "cascade" }),
		action: text("action").notNull(),
		outcome: text("outcome").notNull(),
		evidenceJson: jsonb("evidence_json"),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("ai_reconciliation_operation_created_idx").on(
			table.operationId,
			table.createdAt,
		),
		index("ai_reconciliation_workspace_created_idx").on(
			table.workspaceId,
			table.createdAt,
		),
	],
);

export type AiGovernanceSettingsRow = typeof aiGovernanceSettings.$inferSelect;
export type AiPricingVersionRow = typeof aiPricingVersion.$inferSelect;
export type AiOperationRow = typeof aiOperation.$inferSelect;
export type AiBudgetReservationRow = typeof aiBudgetReservation.$inferSelect;
