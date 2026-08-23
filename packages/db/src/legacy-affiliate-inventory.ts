import type { Pool, PoolClient } from "pg";

export type LegacyProjectInventoryRow = {
	id: string;
	workspaceId: string;
	contentType: string | null;
	creationPath: string | null;
	contentFormatKey: string | null;
	contentFormatVersion: number | null;
	hasProduct: boolean;
};

async function readBatch(
	client: PoolClient,
	cursor: string | null,
	batchSize: number,
): Promise<LegacyProjectInventoryRow[]> {
	const result = await client.query<LegacyProjectInventoryRow>(
		`
			select
				id,
				workspace_id as "workspaceId",
				content_type as "contentType",
				creation_path as "creationPath",
				content_format_key as "contentFormatKey",
				content_format_version as "contentFormatVersion",
				(product_id is not null) as "hasProduct"
			from project
			where ($1::text is null or id > $1::text)
			order by id asc
			limit $2
		`,
		[cursor, batchSize],
	);
	return result.rows;
}

/** Execute one bounded, read-only keyset page. */
export async function scanLegacyProjectInventoryBatch(
	pool: Pool,
	input: { cursor: string | null; batchSize: number },
): Promise<LegacyProjectInventoryRow[]> {
	const client = await pool.connect();
	try {
		await client.query("begin transaction read only");
		const rows = await readBatch(client, input.cursor, input.batchSize);
		await client.query("commit");
		return rows;
	} catch (error) {
		await client.query("rollback").catch(() => undefined);
		throw error;
	} finally {
		client.release();
	}
}

export type LegacyAffiliateCasBatchResult = {
	updatedProjectIds: string[];
	skippedProjectIds: string[];
};

/**
 * Canonical M2B bounded CAS update. The raw SQL intentionally omits updated_at
 * and every non-identity column, avoiding ORM on-update behavior.
 */
export async function applyLegacyAffiliateCandidateBatch(
	pool: Pool,
	projectIds: string[],
): Promise<LegacyAffiliateCasBatchResult> {
	if (projectIds.length === 0) {
		return { updatedProjectIds: [], skippedProjectIds: [] };
	}

	const client = await pool.connect();
	try {
		await client.query("begin");
		const result = await client.query<{ id: string }>(
			`
				update project
				set
					content_type = 'AFFILIATE',
					creation_path = 'SCRIPTED',
					content_format_key = 'SCRIPTED_STANDARD',
					content_format_version = 1
				where id = any($1::text[])
					and content_type is null
					and creation_path is null
					and content_format_key is null
					and content_format_version is null
					and product_id is not null
				returning id
			`,
			[projectIds],
		);
		await client.query("commit");
		const updated = new Set(result.rows.map((row) => row.id));
		return {
			updatedProjectIds: projectIds.filter((id) => updated.has(id)),
			skippedProjectIds: projectIds.filter((id) => !updated.has(id)),
		};
	} catch (error) {
		await client.query("rollback").catch(() => undefined);
		throw error;
	} finally {
		client.release();
	}
}
