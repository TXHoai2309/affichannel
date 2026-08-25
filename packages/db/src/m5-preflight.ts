import {
	type ContentFormatRegistry,
	createM5PreflightAccumulator,
	type M5PreflightResult,
} from "@affichannel/core";
import type { Pool } from "pg";

import { scanLegacyProjectInventoryBatch } from "./legacy-affiliate-inventory";

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 10_000;

export async function runDatabaseM5Preflight(
	pool: Pool,
	options: {
		batchSize?: number;
		maxDiagnosticIds?: number;
		registry?: ContentFormatRegistry;
	} = {},
): Promise<M5PreflightResult> {
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
	if (
		!Number.isInteger(batchSize) ||
		batchSize < 1 ||
		batchSize > MAX_BATCH_SIZE
	) {
		throw new Error(
			`batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}.`,
		);
	}

	const accumulator = createM5PreflightAccumulator({
		maxDiagnosticIds: options.maxDiagnosticIds,
		registry: options.registry,
	});
	let cursor: string | null = null;
	while (true) {
		const rows = await scanLegacyProjectInventoryBatch(pool, {
			cursor,
			batchSize,
		});
		for (const row of rows) {
			accumulator.add({
				id: row.id,
				contentType: row.contentType,
				creationPath: row.creationPath,
				contentFormatKey: row.contentFormatKey,
				contentFormatVersion: row.contentFormatVersion,
				hasProduct: row.hasProduct,
			});
		}
		if (rows.length < batchSize) break;
		cursor = rows.at(-1)?.id ?? null;
	}
	return accumulator.finish();
}

export type M5SchemaPostflight = {
	m5SchemaEnforced: boolean;
	productIdNullable: boolean;
	retainedConstraints: readonly string[];
	retainedIndexes: readonly string[];
	preflight: M5PreflightResult;
	ready: boolean;
};

export async function runM5SchemaPostflight(
	pool: Pool,
): Promise<M5SchemaPostflight> {
	const columns = await pool.query<{
		columnName: string;
		isNullable: "YES" | "NO";
	}>(
		`
			select column_name as "columnName", is_nullable as "isNullable"
			from information_schema.columns
			where table_schema = current_schema()
				and table_name = 'project'
				and column_name = any($1::text[])
		`,
		[
			[
				"content_type",
				"creation_path",
				"content_format_key",
				"content_format_version",
				"product_id",
			],
		],
	);
	const nullable = new Map(
		columns.rows.map((column) => [column.columnName, column.isNullable]),
	);
	const identityColumns = [
		"content_type",
		"creation_path",
		"content_format_key",
		"content_format_version",
	] as const;
	const m5SchemaEnforced = identityColumns.every(
		(column) => nullable.get(column) === "NO",
	);
	const productIdNullable = nullable.get("product_id") === "YES";

	const expectedConstraints = [
		"project_content_type_check",
		"project_creation_path_check",
		"project_content_format_pair_check",
		"project_current_step_key_check",
		"project_product_id_product_id_fk",
	] as const;
	const constraints = await pool.query<{ constraintName: string }>(
		`
			select conname as "constraintName"
			from pg_constraint
			where conrelid = 'project'::regclass
				and conname = any($1::text[])
		`,
		[[...expectedConstraints]],
	);
	const retainedConstraints = constraints.rows.map((row) => row.constraintName);
	const indexes = await pool.query<{ indexName: string }>(
		`select indexname as "indexName"
		 from pg_indexes
		 where schemaname = current_schema()
		   and tablename = 'project'
		   and indexname = 'project_product_id_idx'`,
	);
	const retainedIndexes = indexes.rows.map((row) => row.indexName);
	const preflight = await runDatabaseM5Preflight(pool);
	const ready =
		m5SchemaEnforced &&
		productIdNullable &&
		expectedConstraints.every((name) => retainedConstraints.includes(name)) &&
		retainedIndexes.includes("project_product_id_idx") &&
		preflight.readyForM5;

	return {
		m5SchemaEnforced,
		productIdNullable,
		retainedConstraints,
		retainedIndexes,
		preflight,
		ready,
	};
}
