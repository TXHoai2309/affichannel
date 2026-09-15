import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mediaAssetUsageTypes } from "@affichannel/core";
import { compositionVersion } from "@affichannel/db/schema/composition-version";
import { mediaAsset, mediaAssetLink } from "@affichannel/db/schema/media-asset";
import { quickImageSettings } from "@affichannel/db/schema/quick-image-settings";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

const dialect = new PgDialect();
const migrationSql = readFileSync(
	fileURLToPath(
		new URL(
			"../../../../../packages/db/src/migrations/0026_quick_image_database_foundation.sql",
			import.meta.url,
		),
	),
	"utf8",
);

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
	return getTableConfig(table).columns.map((column) => column.name);
}

function checkSql(table: Parameters<typeof getTableConfig>[0], name: string) {
	const check = getTableConfig(table).checks.find(
		(candidate) => candidate.name === name,
	);
	if (!check) throw new Error(`Missing schema check: ${name}`);
	return dialect.sqlToQuery(check.value).sql;
}

function indexConfig(
	table: Parameters<typeof getTableConfig>[0],
	name: string,
) {
	const index = getTableConfig(table).indexes.find(
		(candidate) => candidate.config.name === name,
	);
	if (!index) throw new Error(`Missing schema index: ${name}`);
	return index.config;
}

describe("AFF-US-022 US22-A Slice 2 database foundation", () => {
	it("defines the Quick Image settings duration, revision, and unique authority", () => {
		expect(columnNames(quickImageSettings)).toEqual([
			"id",
			"workspace_id",
			"project_id",
			"duration_seconds",
			"revision",
			"created_at",
			"updated_at",
		]);
		expect(
			checkSql(quickImageSettings, "quick_image_settings_duration_check"),
		).toContain("in (5, 10, 15)");
		expect(
			checkSql(quickImageSettings, "quick_image_settings_revision_check"),
		).toContain("> 0");
		expect(
			indexConfig(
				quickImageSettings,
				"quick_image_settings_workspace_project_unique",
			).columns,
		).toHaveLength(2);
	});

	it("preserves project resources and limits current-source uniqueness to its role", () => {
		expect(mediaAssetUsageTypes).toEqual([
			"project_resource",
			"quick_image_current_source",
		]);
		const currentSourceIndex = indexConfig(
			mediaAssetLink,
			"media_asset_link_current_source_unique",
		);
		expect(currentSourceIndex.columns).toHaveLength(2);
		if (!currentSourceIndex.where)
			throw new Error("Current-source index must be partial");
		expect(dialect.sqlToQuery(currentSourceIndex.where).sql).toBe(
			`"media_asset_link"."usage_type" = 'quick_image_current_source'`,
		);
		expect(
			indexConfig(mediaAssetLink, "media_asset_link_scope_unique").columns,
		).toHaveLength(4);
	});

	it("defines nullable static-raster proof fields with coherent DB checks", () => {
		expect(columnNames(mediaAsset)).toEqual(
			expect.arrayContaining([
				"image_analysis_version",
				"image_frame_count",
				"image_exif_orientation",
				"image_has_transparency",
			]),
		);
		expect(
			checkSql(mediaAsset, "media_asset_image_analysis_frame_count_check"),
		).toContain("is null or");
		expect(
			checkSql(mediaAsset, "media_asset_image_analysis_orientation_check"),
		).toContain("between 1 and 8");
		const proofShape = checkSql(
			mediaAsset,
			"media_asset_image_analysis_shape_check",
		);
		expect(proofShape).toContain("static-raster-v1");
		for (const field of [
			"image_analysis_version",
			"image_frame_count",
			"image_exif_orientation",
			"image_has_transparency",
		]) {
			expect(proofShape).toContain(`"media_asset"."${field}" is not null`);
		}
	});

	it("defines discriminated Scripted/Quick Image lineage and V1/V2 schema support", () => {
		expect(columnNames(compositionVersion)).toEqual(
			expect.arrayContaining([
				"source_kind",
				"source_script_version_id",
				"source_script_revision",
				"source_media_asset_id",
				"source_media_checksum_sha256",
				"source_media_storage_provider",
				"source_media_storage_key",
				"source_media_mime_type",
				"source_media_byte_size",
				"source_media_width",
				"source_media_height",
			]),
		);
		const lineage = checkSql(
			compositionVersion,
			"composition_version_source_lineage_check",
		);
		expect(lineage).toContain("'SCRIPTED'");
		expect(lineage).toContain("'QUICK_IMAGE'");
		for (const field of [
			"source_media_asset_id",
			"source_media_checksum_sha256",
			"source_media_storage_provider",
			"source_media_storage_key",
			"source_media_mime_type",
			"source_media_byte_size",
			"source_media_width",
			"source_media_height",
		]) {
			expect(lineage).toContain(`"composition_version"."${field}" is not null`);
		}
		expect(lineage).toContain("source_script_version_id");
		expect(lineage).toContain("source_media_asset_id");
		expect(
			checkSql(compositionVersion, "composition_version_schema_version_check"),
		).toContain("'composition-input.v1', 'composition-input.v2'");
		const sourceMediaForeignKey = getTableConfig(
			compositionVersion,
		).foreignKeys.find((foreignKey) =>
			foreignKey.getName().includes("source_media_asset_id"),
		);
		expect(sourceMediaForeignKey?.onDelete).toBe("restrict");
		expect(
			indexConfig(
				compositionVersion,
				"composition_version_source_media_asset_idx",
			).columns,
		).toHaveLength(2);
	});

	it("keeps migration generation safe and unapplied", () => {
		expect(migrationSql).toContain(
			'ALTER TABLE "composition_version" ADD COLUMN "source_kind" text;',
		);
		expect(migrationSql).toContain(
			`UPDATE "composition_version" SET "source_kind" = 'SCRIPTED' WHERE "source_kind" IS NULL;`,
		);
		expect(migrationSql).toContain(
			'ALTER TABLE "composition_version" ALTER COLUMN "source_kind" SET NOT NULL;',
		);
		expect(migrationSql).not.toMatch(/DROP TABLE|DELETE FROM/i);
		expect(migrationSql).not.toContain("DROP DEFAULT");
	});
});
