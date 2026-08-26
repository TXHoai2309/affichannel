import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { claimManifest } from "./claim-manifest";
import { project } from "./project";
import { scriptVersion } from "./script-version";
import { workspace } from "./workspace";

export const factLockRun = pgTable(
	"fact_lock_run",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		scriptVersionId: text("script_version_id").references(
			() => scriptVersion.id,
			{ onDelete: "restrict" },
		),
		sourceScriptRevision: integer("source_script_revision"),
		inputMode: text("input_mode"),
		claimManifestId: text("claim_manifest_id").references(
			() => claimManifest.id,
			{ onDelete: "restrict" },
		),
		claimManifestFingerprint: text("claim_manifest_fingerprint"),
		idempotencyKey: text("idempotency_key").notNull(),
		requestHash: text("request_hash").notNull(),
		inputSnapshotJson: jsonb("input_snapshot_json").notNull(),
		inputHash: text("input_hash").notNull(),
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
	},
	(table) => [
		check(
			"fact_lock_run_status_check",
			sql`${table.status} in ('pending', 'review_required', 'passed', 'failed', 'indeterminate')`,
		),
		check(
			"fact_lock_run_source_revision_check",
			sql`${table.sourceScriptRevision} is null or ${table.sourceScriptRevision} > 0`,
		),
		check(
			"fact_lock_run_script_provenance_pair_check",
			sql`(${table.scriptVersionId} is null and ${table.sourceScriptRevision} is null) or (${table.scriptVersionId} is not null and ${table.sourceScriptRevision} is not null and ${table.sourceScriptRevision} > 0)`,
		),
		check(
			"fact_lock_run_input_mode_check",
			sql`${table.inputMode} is null or ${table.inputMode} = 'MANIFEST_V1'`,
		),
		check(
			"fact_lock_run_mode_shape_check",
			sql`(
				(${table.inputMode} is null
					and ${table.claimManifestId} is null
					and ${table.claimManifestFingerprint} is null
					and ${table.scriptVersionId} is not null
					and ${table.sourceScriptRevision} is not null
					and ${table.sourceScriptRevision} > 0)
				or
				(${table.inputMode} is not null
					and ${table.inputMode} = 'MANIFEST_V1'
					and ${table.claimManifestId} is not null
					and ${table.claimManifestFingerprint} is not null
					and ${table.claimManifestFingerprint} ~ '^[a-f0-9]{64}$'
					and ((${table.scriptVersionId} is null and ${table.sourceScriptRevision} is null)
						or (${table.scriptVersionId} is not null and ${table.sourceScriptRevision} is not null and ${table.sourceScriptRevision} > 0)))
			)`,
		),
		check(
			"fact_lock_run_manifest_fingerprint_check",
			sql`${table.claimManifestFingerprint} is null or ${table.claimManifestFingerprint} ~ '^[a-f0-9]{64}$'`,
		),
		check(
			"fact_lock_run_idempotency_length_check",
			sql`length(trim(${table.idempotencyKey})) between 8 and 200`,
		),
		check(
			"fact_lock_run_hash_check",
			sql`${table.requestHash} ~ '^[a-f0-9]{64}$' and ${table.inputHash} ~ '^[a-f0-9]{64}$' and ${table.promptHash} ~ '^[a-f0-9]{64}$'`,
		),
		check(
			"fact_lock_run_token_check",
			sql`(${table.inputTokens} is null or ${table.inputTokens} >= 0) and (${table.outputTokens} is null or ${table.outputTokens} >= 0)`,
		),
		check(
			"fact_lock_run_cost_check",
			sql`(${table.estimatedCostMicros} is null or ${table.estimatedCostMicros} >= 0) and (${table.actualCostMicros} is null or ${table.actualCostMicros} >= 0)`,
		),
		check(
			"fact_lock_run_currency_check",
			sql`((${table.estimatedCostMicros} is null and ${table.actualCostMicros} is null and ${table.currency} is null) or ((${table.estimatedCostMicros} is not null or ${table.actualCostMicros} is not null) and ${table.currency} ~ '^[A-Z]{3}$'))`,
		),
		check(
			"fact_lock_run_finished_shape_check",
			sql`(${table.status} = 'pending' and ${table.finishedAt} is null) or (${table.status} <> 'pending' and ${table.finishedAt} is not null)`,
		),
		uniqueIndex("fact_lock_run_idempotency_unique").on(
			table.workspaceId,
			table.idempotencyKey,
		),
		uniqueIndex("fact_lock_run_pending_scope_unique")
			.on(
				table.workspaceId,
				table.projectId,
				table.scriptVersionId,
				table.sourceScriptRevision,
			)
			.where(sql`${table.status} = 'pending' and ${table.inputMode} is null`),
		uniqueIndex("fact_lock_run_manifest_pending_scope_unique")
			.on(table.workspaceId, table.projectId, table.requestHash)
			.where(
				sql`${table.status} = 'pending' and ${table.inputMode} = 'MANIFEST_V1'`,
			),
		index("fact_lock_run_project_latest_idx").on(
			table.workspaceId,
			table.projectId,
			table.createdAt,
			table.id,
		),
		index("fact_lock_run_script_version_idx").on(
			table.workspaceId,
			table.scriptVersionId,
			table.sourceScriptRevision,
		),
		index("fact_lock_run_claim_manifest_idx").on(
			table.workspaceId,
			table.claimManifestId,
		),
		index("fact_lock_run_status_idx").on(
			table.workspaceId,
			table.status,
			table.createdAt,
		),
	],
);

export const factLockClaim = pgTable(
	"fact_lock_claim",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		runId: text("run_id")
			.notNull()
			.references(() => factLockRun.id, { onDelete: "cascade" }),
		claimKey: text("claim_key").notNull(),
		claimText: text("claim_text").notNull(),
		occurrenceJson: jsonb("occurrence_json").notNull(),
		classificationStatus: text("classification_status").notNull(),
		reviewStatus: text("review_status").notNull(),
		reason: text("reason").notNull(),
		confidence: real("confidence"),
		suggestionText: text("suggestion_text"),
		factRevision: integer("fact_revision"),
		checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
		reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, {
			onDelete: "restrict",
		}),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
		reviewNote: text("review_note"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"fact_lock_claim_classification_check",
			sql`${table.classificationStatus} in ('SUPPORTED', 'NEEDS_REVIEW', 'UNSUPPORTED', 'PROHIBITED')`,
		),
		check(
			"fact_lock_claim_review_check",
			sql`(${table.classificationStatus} = 'SUPPORTED' and ${table.reviewStatus} = 'AUTO_PASSED') or (${table.classificationStatus} = 'NEEDS_REVIEW' and ${table.reviewStatus} in ('UNRESOLVED', 'MANUAL_APPROVED')) or (${table.classificationStatus} in ('UNSUPPORTED', 'PROHIBITED') and ${table.reviewStatus} = 'UNRESOLVED')`,
		),
		check(
			"fact_lock_claim_confidence_check",
			sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
		),
		check(
			"fact_lock_claim_revision_check",
			sql`${table.factRevision} is null or ${table.factRevision} > 0`,
		),
		check(
			"fact_lock_claim_review_metadata_check",
			sql`((${table.reviewStatus} = 'MANUAL_APPROVED' and ${table.reviewedByUserId} is not null and ${table.reviewedAt} is not null) or (${table.reviewStatus} in ('AUTO_PASSED', 'UNRESOLVED') and ${table.reviewedByUserId} is null and ${table.reviewedAt} is null))`,
		),
		uniqueIndex("fact_lock_claim_run_key_unique").on(
			table.runId,
			table.claimKey,
		),
		index("fact_lock_claim_workspace_run_idx").on(
			table.workspaceId,
			table.runId,
		),
		index("fact_lock_claim_classification_idx").on(
			table.workspaceId,
			table.classificationStatus,
			table.reviewStatus,
		),
	],
);

export const factLockClaimFact = pgTable(
	"fact_lock_claim_fact",
	{
		claimId: text("claim_id")
			.notNull()
			.references(() => factLockClaim.id, { onDelete: "cascade" }),
		factId: text("fact_id").notNull(),
		factRevision: integer("fact_revision").notNull(),
		relation: text("relation").notNull(),
	},
	(table) => [
		primaryKey({
			columns: [
				table.claimId,
				table.factId,
				table.factRevision,
				table.relation,
			],
		}),
		check(
			"fact_lock_claim_fact_revision_check",
			sql`${table.factRevision} > 0`,
		),
		check(
			"fact_lock_claim_fact_relation_check",
			sql`${table.relation} in ('supports', 'related', 'contradicts')`,
		),
		index("fact_lock_claim_fact_fact_revision_idx").on(
			table.factId,
			table.factRevision,
		),
		index("fact_lock_claim_fact_claim_idx").on(table.claimId),
	],
);
