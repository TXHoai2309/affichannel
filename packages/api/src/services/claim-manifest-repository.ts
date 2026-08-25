import { randomUUID } from "node:crypto";
import type {
	BuiltClaimManifest,
	ClaimManifest,
	ClaimManifestClaim,
	ClaimManifestSource,
} from "@affichannel/core";
import { canonicalizeJson, parseBuiltClaimManifest } from "@affichannel/core";
import { claimManifest, db } from "@affichannel/db";
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gt,
	lt,
	or,
	sql,
} from "drizzle-orm";

type ClaimManifestRow = typeof claimManifest.$inferSelect;
export type ClaimManifestRepositoryTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];

export const claimManifestRepositoryErrorCodes = [
	"CLAIM_MANIFEST_INPUT_INVALID",
	"CLAIM_MANIFEST_CONFLICT",
	"CLAIM_MANIFEST_PERSISTED_DATA_INVALID",
] as const;

export type ClaimManifestRepositoryErrorCode =
	(typeof claimManifestRepositoryErrorCodes)[number];

export class ClaimManifestRepositoryError extends Error {
	readonly code: ClaimManifestRepositoryErrorCode;

	constructor(code: ClaimManifestRepositoryErrorCode) {
		super(code);
		this.name = "ClaimManifestRepositoryError";
		this.code = code;
	}
}

export type CreateOrReuseClaimManifestInput = Readonly<{
	workspaceId: string;
	projectId: string;
	builtManifest: BuiltClaimManifest;
	createdByUserId: string;
}>;

export type CreateOrReuseClaimManifestResult = Readonly<{
	created: boolean;
	manifest: ClaimManifest;
}>;

export type ClaimManifestHistoryCursor = Readonly<{
	createdAt: string;
	id: string;
}>;

export type ListClaimManifestsForProjectInput = Readonly<{
	workspaceId: string;
	projectId: string;
	direction: "newest_first" | "oldest_first";
	limit: number;
	cursor?: ClaimManifestHistoryCursor;
}>;

export type ClaimManifestHistoryPage = Readonly<{
	items: readonly ClaimManifest[];
	nextCursor: ClaimManifestHistoryCursor | null;
}>;

function persistedDataInvalid(): ClaimManifestRepositoryError {
	return new ClaimManifestRepositoryError(
		"CLAIM_MANIFEST_PERSISTED_DATA_INVALID",
	);
}

function builtManifestFromRow(row: ClaimManifestRow): BuiltClaimManifest {
	return {
		workspaceId: row.workspaceId,
		projectId: row.projectId,
		source: row.sourceSnapshotJson as ClaimManifestSource,
		productId: row.productId,
		schemaVersion: row.schemaVersion as BuiltClaimManifest["schemaVersion"],
		builderVersion: row.builderVersion as BuiltClaimManifest["builderVersion"],
		claims: row.claimsJson as readonly ClaimManifestClaim[],
		claimCount: row.claimCount,
		isEmpty: row.isEmpty,
		fingerprint: row.fingerprint,
	};
}

function sourceColumnsFromManifest(manifest: BuiltClaimManifest) {
	return {
		sourceType: manifest.source.sourceType,
		sourceScriptVersionId:
			manifest.source.sourceType === "SCRIPT_VERSION"
				? manifest.source.scriptVersionId
				: null,
		sourceScriptRevision:
			manifest.source.sourceType === "SCRIPT_VERSION"
				? manifest.source.scriptVersionRevision
				: null,
		sourceContentHash: manifest.source.sourceContentHash,
	};
}

function semanticPersistenceProjectionFromManifest(
	manifest: BuiltClaimManifest,
) {
	return {
		...manifest,
		...sourceColumnsFromManifest(manifest),
	};
}

function semanticPersistenceProjectionFromRow(row: ClaimManifestRow) {
	return {
		...builtManifestFromRow(row),
		sourceType: row.sourceType,
		sourceScriptVersionId: row.sourceScriptVersionId,
		sourceScriptRevision: row.sourceScriptRevision,
		sourceContentHash: row.sourceContentHash,
	};
}

function hasExactSemanticPayload(
	row: ClaimManifestRow,
	manifest: BuiltClaimManifest,
): boolean {
	try {
		return (
			canonicalizeJson(semanticPersistenceProjectionFromRow(row)) ===
			canonicalizeJson(semanticPersistenceProjectionFromManifest(manifest))
		);
	} catch {
		return false;
	}
}

async function mapClaimManifestRow(
	row: ClaimManifestRow,
): Promise<ClaimManifest> {
	const built = builtManifestFromRow(row);
	const expectedSourceColumns = sourceColumnsFromManifest(built);
	if (
		row.sourceType !== expectedSourceColumns.sourceType ||
		row.sourceScriptVersionId !== expectedSourceColumns.sourceScriptVersionId ||
		row.sourceScriptRevision !== expectedSourceColumns.sourceScriptRevision ||
		row.sourceContentHash !== expectedSourceColumns.sourceContentHash ||
		!row.id.trim() ||
		!row.createdByUserId.trim() ||
		!(row.createdAt instanceof Date) ||
		!Number.isFinite(row.createdAt.getTime())
	) {
		throw persistedDataInvalid();
	}

	let validated: BuiltClaimManifest;
	try {
		validated = await parseBuiltClaimManifest(built);
	} catch {
		throw persistedDataInvalid();
	}
	return Object.freeze({
		...validated,
		id: row.id,
		createdByUserId: row.createdByUserId,
		createdAt: row.createdAt,
	});
}

function assertCreateInputScope(
	input: CreateOrReuseClaimManifestInput,
	manifest: BuiltClaimManifest,
): void {
	if (
		!input.workspaceId.trim() ||
		!input.projectId.trim() ||
		!input.createdByUserId.trim() ||
		manifest.workspaceId !== input.workspaceId ||
		manifest.projectId !== input.projectId
	) {
		throw new ClaimManifestRepositoryError("CLAIM_MANIFEST_INPUT_INVALID");
	}
}

async function createOrReuseClaimManifestWithTransaction(
	transaction: ClaimManifestRepositoryTransaction,
	input: CreateOrReuseClaimManifestInput,
): Promise<CreateOrReuseClaimManifestResult> {
	let manifest: BuiltClaimManifest;
	try {
		manifest = await parseBuiltClaimManifest(input.builtManifest);
	} catch {
		throw new ClaimManifestRepositoryError("CLAIM_MANIFEST_INPUT_INVALID");
	}
	assertCreateInputScope(input, manifest);
	const sourceColumns = sourceColumnsFromManifest(manifest);

	const [inserted] = await transaction
		.insert(claimManifest)
		.values({
			id: randomUUID(),
			workspaceId: input.workspaceId,
			projectId: input.projectId,
			...sourceColumns,
			sourceSnapshotJson: manifest.source,
			productId: manifest.productId,
			schemaVersion: manifest.schemaVersion,
			builderVersion: manifest.builderVersion,
			claimsJson: manifest.claims,
			claimCount: manifest.claimCount,
			isEmpty: manifest.isEmpty,
			fingerprint: manifest.fingerprint,
			createdByUserId: input.createdByUserId,
		})
		.onConflictDoNothing({
			target: [
				claimManifest.workspaceId,
				claimManifest.projectId,
				claimManifest.fingerprint,
			],
		})
		.returning();

	if (inserted) {
		return {
			created: true,
			manifest: await mapClaimManifestRow(inserted),
		};
	}

	const [existing] = await transaction
		.select()
		.from(claimManifest)
		.where(
			and(
				eq(claimManifest.workspaceId, input.workspaceId),
				eq(claimManifest.projectId, input.projectId),
				eq(claimManifest.fingerprint, manifest.fingerprint),
			),
		)
		.limit(1);
	if (!existing) throw persistedDataInvalid();
	if (!hasExactSemanticPayload(existing, manifest)) {
		throw new ClaimManifestRepositoryError("CLAIM_MANIFEST_CONFLICT");
	}
	return {
		created: false,
		manifest: await mapClaimManifestRow(existing),
	};
}

export function createOrReuseClaimManifestInTransaction(
	transaction: ClaimManifestRepositoryTransaction,
	input: CreateOrReuseClaimManifestInput,
): Promise<CreateOrReuseClaimManifestResult> {
	return createOrReuseClaimManifestWithTransaction(transaction, input);
}

export async function createOrReuseClaimManifest(
	input: CreateOrReuseClaimManifestInput,
): Promise<CreateOrReuseClaimManifestResult> {
	return db.transaction((transaction) =>
		createOrReuseClaimManifestWithTransaction(transaction, input),
	);
}

export async function getClaimManifestById(input: {
	workspaceId: string;
	projectId: string;
	claimManifestId: string;
}): Promise<ClaimManifest | null> {
	const [row] = await db
		.select()
		.from(claimManifest)
		.where(
			and(
				eq(claimManifest.workspaceId, input.workspaceId),
				eq(claimManifest.projectId, input.projectId),
				eq(claimManifest.id, input.claimManifestId),
			),
		)
		.limit(1);
	return row ? mapClaimManifestRow(row) : null;
}

export async function listClaimManifestsForProject(
	input: ListClaimManifestsForProjectInput,
): Promise<ClaimManifestHistoryPage> {
	if (
		!input.workspaceId.trim() ||
		!input.projectId.trim() ||
		!(["newest_first", "oldest_first"] as const).includes(input.direction) ||
		!Number.isFinite(input.limit) ||
		!Number.isInteger(input.limit) ||
		input.limit < 1 ||
		(input.cursor !== undefined &&
			(!input.cursor.createdAt.trim() ||
				!Number.isFinite(Date.parse(input.cursor.createdAt)) ||
				!input.cursor.id.trim()))
	) {
		throw new ClaimManifestRepositoryError("CLAIM_MANIFEST_INPUT_INVALID");
	}

	const newer = input.direction === "oldest_first";
	const cursorPredicate = input.cursor
		? or(
				newer
					? gt(
							claimManifest.createdAt,
							sql`${input.cursor.createdAt}::timestamptz`,
						)
					: lt(
							claimManifest.createdAt,
							sql`${input.cursor.createdAt}::timestamptz`,
						),
				and(
					eq(
						claimManifest.createdAt,
						sql`${input.cursor.createdAt}::timestamptz`,
					),
					newer
						? gt(claimManifest.id, input.cursor.id)
						: lt(claimManifest.id, input.cursor.id),
				),
			)
		: undefined;
	const rows = await db
		.select({
			...getTableColumns(claimManifest),
			cursorCreatedAt: sql<string>`${claimManifest.createdAt}::text`,
		})
		.from(claimManifest)
		.where(
			and(
				eq(claimManifest.workspaceId, input.workspaceId),
				eq(claimManifest.projectId, input.projectId),
				cursorPredicate,
			),
		)
		.orderBy(
			newer ? asc(claimManifest.createdAt) : desc(claimManifest.createdAt),
			newer ? asc(claimManifest.id) : desc(claimManifest.id),
		)
		.limit(input.limit + 1);
	const hasNextPage = rows.length > input.limit;
	const pageRows = rows.slice(0, input.limit);
	const items = await Promise.all(pageRows.map(mapClaimManifestRow));
	const last = pageRows.at(-1);
	return {
		items,
		nextCursor:
			hasNextPage && last
				? { createdAt: last.cursorCreatedAt, id: last.id }
				: null,
	};
}
