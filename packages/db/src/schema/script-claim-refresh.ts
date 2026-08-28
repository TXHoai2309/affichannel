import { sql } from "drizzle-orm";
import {
	bigint,
	check,
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
import { scriptVersion } from "./script-version";
import { workspace } from "./workspace";

export const scriptClaimRefreshRun = pgTable(
	"script_claim_refresh_run",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		scriptVersionId: text("script_version_id")
			.notNull()
			.references(() => scriptVersion.id, { onDelete: "restrict" }),
		sourceScriptRevision: integer("source_script_revision").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		requestHash: text("request_hash").notNull(),
		inputSnapshotJson: jsonb("input_snapshot_json").notNull(),
		inputHash: text("input_hash").notNull(),
		sourceContentHash: text("source_content_hash").notNull(),
		promptHash: text("prompt_hash").notNull(),
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		promptVersion: text("prompt_version").notNull(),
		outputSchemaVersion: text("output_schema_version").notNull(),
		status: text("status").notNull(),
		providerRequestId: text("provider_request_id"),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		estimatedCostMicros: bigint("estimated_cost_micros", { mode: "bigint" }),
		actualCostMicros: bigint("actual_cost_micros", { mode: "bigint" }),
		currency: text("currency"),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		executionClaimedAt: timestamp("execution_claimed_at", {
			withTimezone: true,
		}),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
		resultScriptRevision: integer("result_script_revision"),
	},
	(table) => [
		check(
			"script_claim_refresh_source_revision_check",
			sql`${table.sourceScriptRevision} > 0`,
		),
		check(
			"script_claim_refresh_result_revision_check",
			sql`${table.resultScriptRevision} is null or ${table.resultScriptRevision} = ${table.sourceScriptRevision} + 1`,
		),
		check(
			"script_claim_refresh_hash_check",
			sql`${table.requestHash} ~ '^[0-9a-f]{64}$'
				and ${table.inputHash} ~ '^[0-9a-f]{64}$'
				and ${table.sourceContentHash} ~ '^[0-9a-f]{64}$'
				and ${table.promptHash} ~ '^[0-9a-f]{64}$'`,
		),
		check(
			"script_claim_refresh_status_check",
			sql`${table.status} in ('pending', 'completed', 'failed', 'indeterminate')`,
		),
		check(
			"script_claim_refresh_status_shape_check",
			sql`(
				(${table.status} = 'pending'
					and ${table.finishedAt} is null
					and ${table.resultScriptRevision} is null)
				or
				(${table.status} = 'completed'
					and ${table.finishedAt} is not null
					and ${table.resultScriptRevision} is not null
					and ${table.errorCode} is null
					and ${table.errorMessage} is null)
				or
				(${table.status} in ('failed', 'indeterminate')
					and ${table.finishedAt} is not null
					and ${table.resultScriptRevision} is null)
			)`,
		),
		check(
			"script_claim_refresh_error_pair_check",
			sql`(${table.errorCode} is null and ${table.errorMessage} is null)
				or (${table.errorCode} is not null and ${table.errorMessage} is not null)`,
		),
		check(
			"script_claim_refresh_idempotency_key_check",
			sql`length(trim(${table.idempotencyKey})) between 8 and 200`,
		),
		check(
			"script_claim_refresh_token_check",
			sql`(${table.inputTokens} is null or ${table.inputTokens} >= 0)
				and (${table.outputTokens} is null or ${table.outputTokens} >= 0)`,
		),
		check(
			"script_claim_refresh_cost_check",
			sql`(${table.estimatedCostMicros} is null or ${table.estimatedCostMicros} >= 0)
				and (${table.actualCostMicros} is null or ${table.actualCostMicros} >= 0)`,
		),
		check(
			"script_claim_refresh_currency_check",
			sql`((${table.estimatedCostMicros} is null and ${table.actualCostMicros} is null and ${table.currency} is null)
				or ((${table.estimatedCostMicros} is not null or ${table.actualCostMicros} is not null)
					and ${table.currency} ~ '^[A-Z]{3}$'))`,
		),
		uniqueIndex("script_claim_refresh_idempotency_unique").on(
			table.workspaceId,
			table.idempotencyKey,
		),
		uniqueIndex("script_claim_refresh_pending_semantic_unique")
			.on(table.workspaceId, table.projectId, table.requestHash)
			.where(sql`${table.status} = 'pending'`),
		index("script_claim_refresh_project_history_idx").on(
			table.workspaceId,
			table.projectId,
			table.createdAt,
			table.id,
		),
		index("script_claim_refresh_script_history_idx").on(
			table.workspaceId,
			table.scriptVersionId,
			table.sourceScriptRevision,
			table.createdAt,
			table.id,
		),
	],
);
