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
