import {
	scriptGenerationModes,
	scriptGenerationSections,
	scriptGenerationStatuses,
} from "@affichannel/core/script-generation/types";
import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { project } from "./project";
import { workspace } from "./workspace";

const sectionArray = `ARRAY['${scriptGenerationSections.join("','")}']::text[]`;

export const scriptGeneration = pgTable(
	"script_generation",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		idempotencyKey: text("idempotency_key").notNull(),
		requestHash: text("request_hash").notNull(),
		parentGenerationId: text("parent_generation_id"),
		mode: text("mode").notNull(),
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		promptVersion: text("prompt_version").notNull(),
		outputSchemaVersion: text("output_schema_version").notNull(),
		inputSnapshotJson: jsonb("input_snapshot_json").notNull(),
		inputHash: text("input_hash").notNull(),
		promptHash: text("prompt_hash").notNull(),
		status: text("status").notNull(),
		outputJson: jsonb("output_json"),
		validSections: text("valid_sections")
			.array()
			.notNull()
			.default(sql`ARRAY[]::text[]`),
		invalidSections: text("invalid_sections")
			.array()
			.notNull()
			.default(sql`ARRAY[]::text[]`),
		providerRequestId: text("provider_request_id"),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		estimatedCostMicros: bigint("estimated_cost_micros", { mode: "bigint" }),
		actualCostMicros: bigint("actual_cost_micros", { mode: "bigint" }),
		currency: text("currency"),
		errorCode: text("error_code"),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"script_generation_status_check",
			sql`${table.status} in (${sql.raw(scriptGenerationStatuses.map((value) => `'${value}'`).join(", "))})`,
		),
		check(
			"script_generation_mode_check",
			sql`${table.mode} in (${sql.raw(scriptGenerationModes.map((value) => `'${value}'`).join(", "))})`,
		),
		check(
			"script_generation_request_hash_check",
			sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
		),
		check(
			"script_generation_input_hash_check",
			sql`${table.inputHash} ~ '^[0-9a-f]{64}$'`,
		),
		check(
			"script_generation_prompt_hash_check",
			sql`${table.promptHash} ~ '^[0-9a-f]{64}$'`,
		),
		check(
			"script_generation_idempotency_key_check",
			sql`length(trim(${table.idempotencyKey})) between 8 and 200`,
		),
		check(
			"script_generation_mode_parent_check",
			sql`(${table.mode} = 'full' and ${table.parentGenerationId} is null) or (${table.mode} = 'repair' and ${table.parentGenerationId} is not null)`,
		),
		check(
			"script_generation_status_output_check",
			sql`(${table.status} in ('completed', 'partial') and ${table.outputJson} is not null) or (${table.status} in ('pending', 'failed', 'indeterminate') and ${table.outputJson} is null)`,
		),
		check(
			"script_generation_status_finished_check",
			sql`(${table.status} = 'pending' and ${table.finishedAt} is null) or (${table.status} <> 'pending' and ${table.finishedAt} is not null)`,
		),
		check(
			"script_generation_sections_check",
			sql`${table.validSections} <@ ${sql.raw(sectionArray)} and ${table.invalidSections} <@ ${sql.raw(sectionArray)} and not (${table.validSections} && ${table.invalidSections})`,
		),
		check(
			"script_generation_state_shape_check",
			sql`(
			(${table.status} = 'completed' and ${table.outputJson} is not null and cardinality(${table.validSections}) = ${sql.raw(String(scriptGenerationSections.length))} and cardinality(${table.invalidSections}) = 0 and (${table.validSections} || ${table.invalidSections}) @> ${sql.raw(sectionArray)})
			or (${table.status} = 'partial' and ${table.outputJson} is not null and cardinality(${table.validSections}) > 0 and cardinality(${table.invalidSections}) > 0 and cardinality(${table.validSections} || ${table.invalidSections}) = ${sql.raw(String(scriptGenerationSections.length))} and (${table.validSections} || ${table.invalidSections}) @> ${sql.raw(sectionArray)})
			or (${table.status} = 'failed' and ${table.outputJson} is null and cardinality(${table.validSections}) = 0)
			or ${table.status} in ('pending', 'indeterminate')
		)`,
		),
		check(
			"script_generation_sections_unique_check",
			sql.raw(
				scriptGenerationSections
					.flatMap((section) => [
						`cardinality(array_positions("script_generation"."valid_sections", '${section}')) <= 1`,
						`cardinality(array_positions("script_generation"."invalid_sections", '${section}')) <= 1`,
					])
					.join(" and "),
			),
		),
		check(
			"script_generation_token_check",
			sql`${table.inputTokens} is null or ${table.inputTokens} >= 0`,
		),
		check(
			"script_generation_output_token_check",
			sql`${table.outputTokens} is null or ${table.outputTokens} >= 0`,
		),
		check(
			"script_generation_estimated_cost_check",
			sql`${table.estimatedCostMicros} is null or ${table.estimatedCostMicros} >= 0`,
		),
		check(
			"script_generation_actual_cost_check",
			sql`${table.actualCostMicros} is null or ${table.actualCostMicros} >= 0`,
		),
		check(
			"script_generation_cost_currency_check",
			sql`((${table.estimatedCostMicros} is null and ${table.actualCostMicros} is null and ${table.currency} is null) or ((${table.estimatedCostMicros} is not null or ${table.actualCostMicros} is not null) and ${table.currency} ~ '^[A-Z]{3}$'))`,
		),
		uniqueIndex("script_generation_idempotency_unique").on(
			table.workspaceId,
			table.idempotencyKey,
		),
		unique("script_generation_scope_id_unique").on(
			table.workspaceId,
			table.projectId,
			table.id,
		),
		uniqueIndex("script_generation_pending_project_unique")
			.on(table.workspaceId, table.projectId)
			.where(sql`${table.status} = 'pending'`),
		index("script_generation_latest_idx").on(
			table.workspaceId,
			table.projectId,
			table.createdAt,
			table.id,
		),
		index("script_generation_parent_idx").on(
			table.workspaceId,
			table.parentGenerationId,
		),
		index("script_generation_created_by_user_idx").on(table.createdByUserId),
		foreignKey({
			name: "script_generation_parent_scope_fk",
			columns: [table.workspaceId, table.projectId, table.parentGenerationId],
			foreignColumns: [table.workspaceId, table.projectId, table.id],
		}),
	],
);
