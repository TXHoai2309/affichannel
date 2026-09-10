import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { compositionVersion } from "./composition-version";
import { project } from "./project";
import { workspace } from "./workspace";

export const renderJob = pgTable(
	"render_job",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		compositionVersionId: text("composition_version_id")
			.notNull()
			.references(() => compositionVersion.id, { onDelete: "restrict" }),
		compositionFingerprint: text("composition_fingerprint").notNull(),
		canonicalRequestHash: text("canonical_request_hash").notNull(),
		requestSpecJson: jsonb("request_spec_json").notNull(),
		outputEncodingProfileJson: jsonb("output_encoding_profile_json").notNull(),
		outputEncodingProfileFingerprint: text(
			"output_encoding_profile_fingerprint",
		).notNull(),
		outputContractVersion: text("output_contract_version").notNull(),
		operation: text("operation").notNull(),
		sourceRenderJobId: text("source_render_job_id"),
		idempotencyKey: text("idempotency_key").notNull(),
		status: text("status").notNull().default("QUEUED"),
		attemptCount: integer("attempt_count").notNull().default(0),
		reasonCode: text("reason_code"),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
	},
	(table) => [
		foreignKey({
			name: "render_job_source_render_job_fk",
			columns: [table.sourceRenderJobId],
			foreignColumns: [table.id],
		}),
		check(
			"render_job_scope_hash_check",
			sql`${table.compositionFingerprint} ~ '^[a-f0-9]{64}$' and ${table.canonicalRequestHash} ~ '^[a-f0-9]{64}$' and ${table.outputEncodingProfileFingerprint} ~ '^[a-f0-9]{64}$'`,
		),
		check(
			"render_job_operation_check",
			sql`${table.operation} in ('START_RENDER', 'RENDER_AGAIN')`,
		),
		check(
			"render_job_operation_source_check",
			sql`(${table.operation} = 'START_RENDER' and ${table.sourceRenderJobId} is null) or (${table.operation} = 'RENDER_AGAIN' and ${table.sourceRenderJobId} is not null)`,
		),
		check(
			"render_job_status_check",
			sql`${table.status} in ('QUEUED', 'RUNNING', 'BLOCKED', 'COMPLETED', 'FAILED', 'INDETERMINATE')`,
		),
		check("render_job_attempt_count_check", sql`${table.attemptCount} >= 0`),
		check(
			"render_job_idempotency_key_check",
			sql`length(trim(${table.idempotencyKey})) between 8 and 200`,
		),
		check(
			"render_job_finished_shape_check",
			sql`(${table.status} in ('QUEUED', 'RUNNING', 'BLOCKED') and ${table.finishedAt} is null) or (${table.status} in ('COMPLETED', 'FAILED', 'INDETERMINATE') and ${table.finishedAt} is not null)`,
		),
		uniqueIndex("render_job_workspace_idempotency_unique").on(
			table.workspaceId,
			table.idempotencyKey,
		),
		uniqueIndex("render_job_active_identity_unique")
			.on(
				table.workspaceId,
				table.projectId,
				table.compositionVersionId,
				table.canonicalRequestHash,
			)
			.where(
				sql`${table.status} in ('QUEUED', 'RUNNING', 'BLOCKED', 'INDETERMINATE')`,
			),
		index("render_job_claim_queue_idx").on(
			table.workspaceId,
			table.status,
			table.createdAt,
			table.id,
		),
		index("render_job_project_created_idx").on(
			table.workspaceId,
			table.projectId,
			table.createdAt,
			table.id,
		),
	],
);

export const renderAttempt = pgTable(
	"render_attempt",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		renderJobId: text("render_job_id")
			.notNull()
			.references(() => renderJob.id, { onDelete: "cascade" }),
		attemptNumber: integer("attempt_number").notNull(),
		status: text("status").notNull().default("RUNNING"),
		leaseOwner: text("lease_owner").notNull(),
		leaseExpiresAt: timestamp("lease_expires_at", {
			withTimezone: true,
		}).notNull(),
		claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
		lastHeartbeatAt: timestamp("last_heartbeat_at", {
			withTimezone: true,
		}).notNull(),
		authorizedAt: timestamp("authorized_at", { withTimezone: true }),
		authorizationEvidenceFingerprint: text(
			"authorization_evidence_fingerprint",
		),
		technicalPreflightVersion: text("technical_preflight_version"),
		technicalPreflightStatus: text("technical_preflight_status"),
		technicalPreflightReasonCode: text("technical_preflight_reason_code"),
		technicalEvidenceFingerprint: text("technical_evidence_fingerprint"),
		technicalCheckedAt: timestamp("technical_checked_at", {
			withTimezone: true,
		}),
		executionStartedAt: timestamp("execution_started_at", {
			withTimezone: true,
		}),
		outputReservationId: text("output_reservation_id").notNull(),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
	},
	(table) => [
		check("render_attempt_number_check", sql`${table.attemptNumber} > 0`),
		check(
			"render_attempt_status_check",
			sql`${table.status} in ('RUNNING', 'COMPLETED', 'FAILED', 'INDETERMINATE', 'FENCED')`,
		),
		check(
			"render_attempt_hash_check",
			sql`(${table.authorizationEvidenceFingerprint} is null or ${table.authorizationEvidenceFingerprint} ~ '^[a-f0-9]{64}$') and (${table.technicalEvidenceFingerprint} is null or ${table.technicalEvidenceFingerprint} ~ '^[a-f0-9]{64}$')`,
		),
		check(
			"render_attempt_preflight_status_check",
			sql`${table.technicalPreflightStatus} is null or ${table.technicalPreflightStatus} in ('VALID', 'INVALID', 'UNSUPPORTED', 'UNKNOWN')`,
		),
		check(
			"render_attempt_finished_shape_check",
			sql`(${table.status} = 'RUNNING' and ${table.finishedAt} is null) or (${table.status} <> 'RUNNING' and ${table.finishedAt} is not null)`,
		),
		check(
			"render_attempt_execution_marker_check",
			sql`${table.executionStartedAt} is null or ${table.authorizedAt} is not null`,
		),
		uniqueIndex("render_attempt_job_number_unique").on(
			table.renderJobId,
			table.attemptNumber,
		),
		uniqueIndex("render_attempt_active_job_unique")
			.on(table.renderJobId)
			.where(sql`${table.status} = 'RUNNING'`),
		uniqueIndex("render_attempt_output_reservation_unique").on(
			table.outputReservationId,
		),
		index("render_attempt_lease_idx").on(
			table.status,
			table.leaseExpiresAt,
			table.id,
		),
		index("render_attempt_job_status_idx").on(
			table.renderJobId,
			table.status,
			table.createdAt,
		),
	],
);

export type RenderJobRow = typeof renderJob.$inferSelect;
export type RenderAttemptRow = typeof renderAttempt.$inferSelect;
