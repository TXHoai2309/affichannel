import { randomUUID } from "node:crypto";
import {
	CONTENT_FORMAT_DEFAULTS,
	canonicalizeQuickImageClaimSourceDocument,
	canonicalQuickImageClaimSourceJson,
	classifyPersistedProjectIdentity,
	type QuickImageClaimSourceAuthority,
	type QuickImageClaimSourceDocument,
	quickImageClaimSourceContentHash,
} from "@affichannel/core";
import {
	db,
	project,
	type QuickImageClaimSourceRow,
	quickImageClaimSource,
} from "@affichannel/db";
import { and, eq, isNull } from "drizzle-orm";
import type { DbTransaction } from "./fact-dependency-repository";

type DbQuery = typeof db | DbTransaction;

export const quickImageClaimSourceErrorCodes = [
	"QUICK_IMAGE_CLAIM_SOURCE_PROJECT_NOT_FOUND",
	"QUICK_IMAGE_CLAIM_SOURCE_IDENTITY_INVALID",
	"QUICK_IMAGE_CLAIM_SOURCE_INVALID",
] as const;

export type QuickImageClaimSourceErrorCode =
	(typeof quickImageClaimSourceErrorCodes)[number];

export class QuickImageClaimSourceServiceError extends Error {
	constructor(public readonly code: QuickImageClaimSourceErrorCode) {
		super(code);
		this.name = "QuickImageClaimSourceServiceError";
	}
}

export type SetQuickImageClaimSourceInput = Readonly<{
	workspaceId: string;
	projectId: string;
	document: QuickImageClaimSourceDocument;
}>;

export type SetQuickImageClaimSourceResult = Readonly<{
	kind: "CREATED" | "UPDATED" | "NOOP";
	source: QuickImageClaimSourceAuthority;
}>;

function isCanonicalQuickImageProject(record: {
	productId: string | null;
	contentType: string | null;
	creationPath: string | null;
	contentFormatKey: string | null;
	contentFormatVersion: number | null;
}) {
	const classification = classifyPersistedProjectIdentity(record);
	return (
		classification.kind === "canonical" &&
		classification.identity.creationPath === "QUICK_IMAGE" &&
		classification.identity.contentFormat.key ===
			CONTENT_FORMAT_DEFAULTS.QUICK_IMAGE.key &&
		classification.identity.contentFormat.version ===
			CONTENT_FORMAT_DEFAULTS.QUICK_IMAGE.version
	);
}

async function mapRow(
	row: QuickImageClaimSourceRow,
): Promise<QuickImageClaimSourceAuthority> {
	let document: QuickImageClaimSourceDocument;
	try {
		document = canonicalizeQuickImageClaimSourceDocument(row.sourceJson);
	} catch {
		throw new QuickImageClaimSourceServiceError(
			"QUICK_IMAGE_CLAIM_SOURCE_INVALID",
		);
	}
	if (row.sourceSchemaVersion !== document.version) {
		throw new QuickImageClaimSourceServiceError(
			"QUICK_IMAGE_CLAIM_SOURCE_INVALID",
		);
	}
	const expectedHash = await quickImageClaimSourceContentHash(document);
	if (expectedHash !== row.sourceContentHashSha256) {
		throw new QuickImageClaimSourceServiceError(
			"QUICK_IMAGE_CLAIM_SOURCE_INVALID",
		);
	}
	return Object.freeze({
		id: row.id,
		workspaceId: row.workspaceId,
		projectId: row.projectId,
		revision: row.revision,
		sourceSchemaVersion: document.version,
		document,
		sourceContentHashSha256: row.sourceContentHashSha256,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

async function requireQuickImageProject(
	query: DbQuery,
	workspaceId: string,
	projectId: string,
	lock: boolean,
) {
	const builder = query
		.select({
			id: project.id,
			workspaceId: project.workspaceId,
			productId: project.productId,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
			archivedAt: project.archivedAt,
		})
		.from(project)
		.where(
			and(
				eq(project.workspaceId, workspaceId),
				eq(project.id, projectId),
				isNull(project.archivedAt),
			),
		)
		.limit(1);
	const [record] = await (lock
		? builder.for("update", { of: project })
		: builder);
	if (!record)
		throw new QuickImageClaimSourceServiceError(
			"QUICK_IMAGE_CLAIM_SOURCE_PROJECT_NOT_FOUND",
		);
	if (!isCanonicalQuickImageProject(record))
		throw new QuickImageClaimSourceServiceError(
			"QUICK_IMAGE_CLAIM_SOURCE_IDENTITY_INVALID",
		);
	return record;
}

export async function getQuickImageClaimSourceInTransaction(
	transaction: DbTransaction,
	input: { workspaceId: string; projectId: string },
): Promise<QuickImageClaimSourceAuthority | null> {
	const [row] = await transaction
		.select()
		.from(quickImageClaimSource)
		.where(
			and(
				eq(quickImageClaimSource.workspaceId, input.workspaceId),
				eq(quickImageClaimSource.projectId, input.projectId),
			),
		)
		.limit(1);
	return row ? mapRow(row) : null;
}

export async function getQuickImageClaimSource(input: {
	workspaceId: string;
	projectId: string;
}): Promise<QuickImageClaimSourceAuthority | null> {
	return db.transaction((transaction) =>
		getQuickImageClaimSourceInTransaction(transaction, input),
	);
}

export async function setQuickImageClaimSource(
	input: SetQuickImageClaimSourceInput,
): Promise<SetQuickImageClaimSourceResult> {
	const document = canonicalizeQuickImageClaimSourceDocument(input.document);
	const sourceContentHashSha256 =
		await quickImageClaimSourceContentHash(document);
	return db.transaction(async (transaction) => {
		await requireQuickImageProject(
			transaction,
			input.workspaceId,
			input.projectId,
			true,
		);
		const current = await getQuickImageClaimSourceInTransaction(transaction, {
			workspaceId: input.workspaceId,
			projectId: input.projectId,
		});
		if (current) {
			if (
				canonicalQuickImageClaimSourceJson(current.document) ===
				canonicalQuickImageClaimSourceJson(document)
			)
				return { kind: "NOOP" as const, source: current };
			const [updated] = await transaction
				.update(quickImageClaimSource)
				.set({
					revision: current.revision + 1,
					sourceSchemaVersion: document.version,
					sourceJson: document,
					sourceContentHashSha256,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(quickImageClaimSource.workspaceId, input.workspaceId),
						eq(quickImageClaimSource.projectId, input.projectId),
						eq(quickImageClaimSource.revision, current.revision),
					),
				)
				.returning();
			if (!updated)
				throw new QuickImageClaimSourceServiceError(
					"QUICK_IMAGE_CLAIM_SOURCE_INVALID",
				);
			return { kind: "UPDATED" as const, source: await mapRow(updated) };
		}
		const [created] = await transaction
			.insert(quickImageClaimSource)
			.values({
				id: randomUUID(),
				workspaceId: input.workspaceId,
				projectId: input.projectId,
				revision: 1,
				sourceSchemaVersion: document.version,
				sourceJson: document,
				sourceContentHashSha256,
			})
			.returning();
		if (!created)
			throw new QuickImageClaimSourceServiceError(
				"QUICK_IMAGE_CLAIM_SOURCE_INVALID",
			);
		return { kind: "CREATED" as const, source: await mapRow(created) };
	});
}
