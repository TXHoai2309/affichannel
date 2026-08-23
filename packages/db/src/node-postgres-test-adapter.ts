import { Pool } from "pg";

export function createNodePostgresPool(connectionString: string) {
	return new Pool({ connectionString });
}
