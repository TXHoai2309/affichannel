import type {
	ClaimManifestClaim,
	ClaimManifestSource,
} from "@affichannel/core";
import { sql } from "drizzle-orm";
import {
	boolean,
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
import { product } from "./product";
import { project } from "./project";
import { scriptVersion } from "./script-version";
import { workspace } from "./workspace";

export const claimManifest = pgTable(
	"claim_manifest",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		sourceType: text("source_type").notNull(),
		sourceScriptVersionId: text("source_script_version_id").references(
			() => scriptVersion.id,
			{ onDelete: "restrict" },
		),
		sourceScriptRevision: integer("source_script_revision"),
		sourceSnapshotJson: jsonb("source_snapshot_json")
			.$type<ClaimManifestSource>()
			.notNull(),
		sourceContentHash: text("source_content_hash").notNull(),
		productId: text("product_id").references(() => product.id, {
			onDelete: "restrict",
		}),
		schemaVersion: text("schema_version").notNull(),
		builderVersion: text("builder_version").notNull(),
		claimsJson: jsonb("claims_json")
			.$type<readonly ClaimManifestClaim[]>()
			.notNull(),
		claimCount: integer("claim_count").notNull(),
		isEmpty: boolean("is_empty").notNull(),
		fingerprint: text("fingerprint").notNull(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"claim_manifest_source_type_check",
			sql`${table.sourceType} in ('SCRIPT_VERSION', 'NO_SCRIPT')`,
		),
		check(
			"claim_manifest_source_pair_check",
			sql`(
				(${table.sourceType} = 'SCRIPT_VERSION'
					and ${table.sourceScriptVersionId} is not null
					and ${table.sourceScriptRevision} is not null
					and ${table.sourceScriptRevision} > 0)
				or
				(${table.sourceType} = 'NO_SCRIPT'
					and ${table.sourceScriptVersionId} is null
					and ${table.sourceScriptRevision} is null)
			)`,
		),
		check(
			"claim_manifest_source_snapshot_check",
			sql`jsonb_typeof(${table.sourceSnapshotJson}) = 'object'
				and ${table.sourceSnapshotJson} ->> 'sourceType' = ${table.sourceType}`,
		),
		check(
			"claim_manifest_source_content_hash_check",
			sql`${table.sourceContentHash} ~ '^[0-9a-f]{64}$'`,
		),
		check(
			"claim_manifest_schema_version_check",
			sql`${table.schemaVersion} = 'claim-manifest.v1'`,
		),
		check(
			"claim_manifest_builder_version_check",
			sql`${table.builderVersion} ~ '^claim-manifest-builder\\.v[1-9][0-9]*$'`,
		),
		check(
			"claim_manifest_claims_array_check",
			sql`jsonb_typeof(${table.claimsJson}) = 'array'`,
		),
		check(
			"claim_manifest_claim_count_check",
			sql`${table.claimCount} between 0 and 64`,
		),
		check(
			"claim_manifest_claim_count_matches_check",
			sql`case
				when jsonb_typeof(${table.claimsJson}) = 'array'
				then jsonb_array_length(${table.claimsJson}) = ${table.claimCount}
				else false
			end`,
		),
		check(
			"claim_manifest_is_empty_check",
			sql`${table.isEmpty} = (${table.claimCount} = 0)`,
		),
		check(
			"claim_manifest_fingerprint_check",
			sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`,
		),
		uniqueIndex("claim_manifest_scope_fingerprint_unique").on(
			table.workspaceId,
			table.projectId,
			table.fingerprint,
		),
		index("claim_manifest_project_history_idx").on(
			table.workspaceId,
			table.projectId,
			table.createdAt,
			table.id,
		),
		index("claim_manifest_script_source_idx").on(
			table.workspaceId,
			table.sourceScriptVersionId,
			table.sourceScriptRevision,
		),
		index("claim_manifest_product_id_idx").on(table.productId),
	],
);
