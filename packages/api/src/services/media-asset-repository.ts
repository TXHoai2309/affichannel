import {
	assertDisplayName,
	assertMediaAssetOrigin,
	assertMediaAssetStatusTransition,
	assertMediaAssetStorageProvider,
	assertReadyMetadata,
	assertSafeMediaAssetStorageKey,
	type MediaAsset,
	MediaAssetError,
	type MediaAssetLink,
	type MediaAssetReadyMetadata,
	type MediaAssetStorageProvider,
	type MediaAssetUsageType,
	type MediaType,
	type MediaUsageRights,
	normalizeMediaTags,
	sanitizeOriginalFilename,
} from "@affichannel/core";
import { db, mediaAsset, mediaAssetLink, project } from "@affichannel/db";
import {
	and,
	desc,
	eq,
	exists,
	ilike,
	inArray,
	isNotNull,
	isNull,
	lt,
	or,
	sql,
} from "drizzle-orm";

import type { WorkspaceActor } from "./workspace";

export type MediaAssetRecord = MediaAsset;
export type MediaAssetLinkRecord = MediaAssetLink;

export type MediaAssetCursor = { updatedAt: string; id: string };

export function encodeMediaAssetCursor(cursor: MediaAssetCursor) {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeMediaAssetCursor(
	value: string,
): MediaAssetCursor | undefined {
	try {
		const parsed = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8"),
		) as Partial<MediaAssetCursor>;
		if (
			typeof parsed.updatedAt !== "string" ||
			typeof parsed.id !== "string" ||
			!parsed.id
		)
			return undefined;
		const date = new Date(parsed.updatedAt);
		return Number.isNaN(date.getTime())
			? undefined
			: { updatedAt: date.toISOString(), id: parsed.id };
	} catch {
		return undefined;
	}
}

function escapeLikePattern(value: string) {
	return value.replace(/[\\%_]/g, "\\$&");
}

function toMediaAssetRecord(
	record: typeof mediaAsset.$inferSelect,
): MediaAsset {
	return {
		...record,
		origin: record.origin as MediaAsset["origin"],
		mediaType: record.mediaType as MediaAsset["mediaType"],
		status: record.status as MediaAsset["status"],
		storageProvider: record.storageProvider as MediaAssetStorageProvider,
		usageRights: record.usageRights as MediaUsageRights,
		tags: [...record.tags],
	};
}

function toMediaAssetLinkRecord(
	record: typeof mediaAssetLink.$inferSelect,
): MediaAssetLink {
	return {
		...record,
		usageType: record.usageType as MediaAssetUsageType,
	};
}

export async function createPendingMediaAsset(
	actor: WorkspaceActor,
	input: {
		id: string;
		mediaType: MediaType;
		origin: "user_upload";
		storageProvider: MediaAssetStorageProvider;
		storageKey: string;
		uploadSessionId: string;
		prepareIdempotencyKey: string;
		uploadExpiresAt: Date;
		originalFilename: string;
		displayName: string;
		declaredMimeType: string | null;
		usageRights?: MediaUsageRights;
		tags?: readonly string[];
	},
) {
	const displayName = assertDisplayName(input.displayName);
	const tags = normalizeMediaTags(input.tags ?? []);
	assertMediaAssetOrigin(input.origin);
	assertMediaAssetStorageProvider(input.storageProvider);
	assertSafeMediaAssetStorageKey(input.storageKey);
	const keyParts = input.storageKey.split("/");
	if (keyParts[2] !== actor.workspaceId || keyParts[3] !== input.id) {
		throw new MediaAssetError(
			"MEDIA_ASSET_STORAGE_KEY_INVALID",
			"Media asset storage key must be scoped to its workspace and asset.",
		);
	}
	const originalFilename = sanitizeOriginalFilename(input.originalFilename);
	const [record] = await db
		.insert(mediaAsset)
		.values({
			id: input.id,
			workspaceId: actor.workspaceId,
			createdByUserId: actor.userId,
			origin: input.origin,
			mediaType: input.mediaType,
			status: "pending_upload",
			storageProvider: input.storageProvider,
			storageKey: input.storageKey,
			uploadSessionId: input.uploadSessionId,
			prepareIdempotencyKey: input.prepareIdempotencyKey,
			uploadExpiresAt: input.uploadExpiresAt,
			originalFilename,
			displayName,
			declaredMimeType: input.declaredMimeType,
			usageRights: input.usageRights ?? "unknown",
			tags,
		})
		.returning();

	return record ? toMediaAssetRecord(record) : undefined;
}

export async function findMediaAssetByIdForWorkspace(
	actor: WorkspaceActor,
	assetId: string,
) {
	const [record] = await db
		.select()
		.from(mediaAsset)
		.where(
			and(
				eq(mediaAsset.id, assetId),
				eq(mediaAsset.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return record ? toMediaAssetRecord(record) : undefined;
}

export async function findReadyMediaAssetByIdForWorkspace(
	actor: WorkspaceActor,
	assetId: string,
) {
	const record = await findMediaAssetByIdForWorkspace(actor, assetId);
	if (!record) return undefined;
	if (record.status !== "ready") {
		throw new MediaAssetError(
			"MEDIA_ASSET_NOT_READY",
			"Media asset is not ready for reuse.",
			{ status: record.status },
		);
	}
	return record;
}

export async function findMediaAssetByUploadSessionForWorkspace(
	actor: WorkspaceActor,
	uploadSessionId: string,
) {
	const [record] = await db
		.select()
		.from(mediaAsset)
		.where(
			and(
				eq(mediaAsset.uploadSessionId, uploadSessionId),
				eq(mediaAsset.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return record ? toMediaAssetRecord(record) : undefined;
}

export async function findMediaAssetByPrepareIdempotencyKey(
	actor: WorkspaceActor,
	prepareIdempotencyKey: string,
) {
	const [record] = await db
		.select()
		.from(mediaAsset)
		.where(
			and(
				eq(mediaAsset.prepareIdempotencyKey, prepareIdempotencyKey),
				eq(mediaAsset.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return record ? toMediaAssetRecord(record) : undefined;
}

export async function listMediaAssets(
	actor: WorkspaceActor,
	input: {
		cursor?: string;
		limit: number;
		projectId?: string;
		mediaType?: MediaType;
		status?: MediaAsset["status"];
		archiveScope: "activeOnly" | "archivedOnly" | "all";
		search?: string;
		tag?: string;
	},
) {
	const conditions = [eq(mediaAsset.workspaceId, actor.workspaceId)];
	if (input.projectId) {
		conditions.push(
			exists(
				db
					.select({ id: mediaAssetLink.id })
					.from(mediaAssetLink)
					.where(
						and(
							eq(mediaAssetLink.workspaceId, actor.workspaceId),
							eq(mediaAssetLink.projectId, input.projectId),
							eq(mediaAssetLink.mediaAssetId, mediaAsset.id),
						),
					),
			),
		);
	}
	if (input.archiveScope === "activeOnly")
		conditions.push(isNull(mediaAsset.archivedAt));
	if (input.archiveScope === "archivedOnly")
		conditions.push(isNotNull(mediaAsset.archivedAt));
	if (input.mediaType)
		conditions.push(eq(mediaAsset.mediaType, input.mediaType));
	if (input.status) conditions.push(eq(mediaAsset.status, input.status));
	if (input.search) {
		const pattern = `%${escapeLikePattern(input.search)}%`;
		const searchCondition = or(
			ilike(mediaAsset.displayName, pattern),
			ilike(mediaAsset.originalFilename, pattern),
		);
		if (searchCondition) conditions.push(searchCondition);
	}
	if (input.tag) {
		const pattern = `%${escapeLikePattern(input.tag)}%`;
		conditions.push(
			sql`EXISTS (SELECT 1 FROM unnest(${mediaAsset.tags}) AS media_tag WHERE media_tag ILIKE ${pattern} ESCAPE '\\')`,
		);
	}
	if (input.cursor) {
		const cursor = decodeMediaAssetCursor(input.cursor);
		if (!cursor) return { kind: "invalid_cursor" as const };
		const cursorCondition = or(
			lt(mediaAsset.updatedAt, new Date(cursor.updatedAt)),
			and(
				eq(mediaAsset.updatedAt, new Date(cursor.updatedAt)),
				lt(mediaAsset.id, cursor.id),
			),
		);
		if (cursorCondition) conditions.push(cursorCondition);
	}
	const records = await db
		.select()
		.from(mediaAsset)
		.where(and(...conditions))
		.orderBy(desc(mediaAsset.updatedAt), desc(mediaAsset.id))
		.limit(input.limit + 1);
	const hasNextPage = records.length > input.limit;
	const items = records.slice(0, input.limit).map(toMediaAssetRecord);
	const last = items.at(-1);
	return {
		kind: "success" as const,
		items,
		nextCursor:
			hasNextPage && last
				? encodeMediaAssetCursor({
						updatedAt: last.updatedAt.toISOString(),
						id: last.id,
					})
				: null,
	};
}

export async function listMediaAssetLinks(
	actor: WorkspaceActor,
	assetId: string,
) {
	const rows = await db
		.select({
			id: mediaAssetLink.id,
			workspaceId: mediaAssetLink.workspaceId,
			projectId: mediaAssetLink.projectId,
			mediaAssetId: mediaAssetLink.mediaAssetId,
			usageType: mediaAssetLink.usageType,
			createdByUserId: mediaAssetLink.createdByUserId,
			createdAt: mediaAssetLink.createdAt,
			projectName: project.name,
		})
		.from(mediaAssetLink)
		.leftJoin(project, eq(project.id, mediaAssetLink.projectId))
		.where(
			and(
				eq(mediaAssetLink.workspaceId, actor.workspaceId),
				eq(mediaAssetLink.mediaAssetId, assetId),
			),
		)
		.orderBy(desc(mediaAssetLink.createdAt), desc(mediaAssetLink.id));
	return rows.map((row) => ({
		id: row.id,
		projectId: row.projectId,
		projectName: row.projectName ?? null,
		usageType: row.usageType as MediaAssetUsageType,
		createdAt: row.createdAt,
	}));
}

export async function markMediaAssetValidating(
	actor: WorkspaceActor,
	input: { assetId: string; expectedStatus?: "pending_upload" },
) {
	const expectedStatus = input.expectedStatus ?? "pending_upload";
	assertMediaAssetStatusTransition(expectedStatus, "validating");
	const [record] = await db
		.update(mediaAsset)
		.set({ status: "validating", updatedAt: new Date() })
		.where(
			and(
				eq(mediaAsset.id, input.assetId),
				eq(mediaAsset.workspaceId, actor.workspaceId),
				eq(mediaAsset.status, expectedStatus),
			),
		)
		.returning();
	return record ? toMediaAssetRecord(record) : undefined;
}

export async function markMediaAssetReady(
	actor: WorkspaceActor,
	input: {
		assetId: string;
		expectedStatus?: "validating";
		metadata: MediaAssetReadyMetadata;
	},
) {
	const expectedStatus = input.expectedStatus ?? "validating";
	assertMediaAssetStatusTransition(expectedStatus, "ready");
	const existing = await findMediaAssetByIdForWorkspace(actor, input.assetId);
	if (!existing) return undefined;
	assertReadyMetadata({ mediaType: existing.mediaType, ...input.metadata });
	const [record] = await db
		.update(mediaAsset)
		.set({
			status: "ready",
			mimeType: input.metadata.mimeType,
			byteSize: input.metadata.byteSize,
			checksumSha256: input.metadata.checksumSha256,
			width: input.metadata.width,
			height: input.metadata.height,
			durationMs: input.metadata.durationMs,
			failureCode: null,
			finalizedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(mediaAsset.id, input.assetId),
				eq(mediaAsset.workspaceId, actor.workspaceId),
				eq(mediaAsset.status, expectedStatus),
			),
		)
		.returning();
	return record ? toMediaAssetRecord(record) : undefined;
}

export async function markMediaAssetFailed(
	actor: WorkspaceActor,
	input: {
		assetId: string;
		expectedStatus?: "pending_upload" | "validating";
		failureCode: string;
	},
) {
	const expectedStatuses = input.expectedStatus
		? [input.expectedStatus]
		: (["pending_upload", "validating"] as const);
	if (input.expectedStatus) {
		assertMediaAssetStatusTransition(input.expectedStatus, "failed");
	}
	const [record] = await db
		.update(mediaAsset)
		.set({
			status: "failed",
			failureCode: input.failureCode.slice(0, 120),
			finalizedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(mediaAsset.id, input.assetId),
				eq(mediaAsset.workspaceId, actor.workspaceId),
				inArray(mediaAsset.status, expectedStatuses),
			),
		)
		.returning();
	return record ? toMediaAssetRecord(record) : undefined;
}

export async function updateMediaAssetMetadata(
	actor: WorkspaceActor,
	input: {
		assetId: string;
		displayName: string;
		tags: readonly string[];
		usageRights: MediaUsageRights;
	},
) {
	const [record] = await db
		.update(mediaAsset)
		.set({
			displayName: assertDisplayName(input.displayName),
			tags: normalizeMediaTags(input.tags),
			usageRights: input.usageRights,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(mediaAsset.id, input.assetId),
				eq(mediaAsset.workspaceId, actor.workspaceId),
			),
		)
		.returning();
	return record ? toMediaAssetRecord(record) : undefined;
}

export async function archiveMediaAsset(
	actor: WorkspaceActor,
	assetId: string,
) {
	const existing = await findMediaAssetByIdForWorkspace(actor, assetId);
	if (!existing) return undefined;
	if (existing.status === "archived") return existing;
	assertMediaAssetStatusTransition(existing.status, "archived");
	const [record] = await db
		.update(mediaAsset)
		.set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(mediaAsset.id, assetId),
				eq(mediaAsset.workspaceId, actor.workspaceId),
				inArray(mediaAsset.status, ["ready", "failed"]),
			),
		)
		.returning();
	return record ? toMediaAssetRecord(record) : undefined;
}

export async function countActiveMediaAssetLinks(
	actor: WorkspaceActor,
	assetId: string,
) {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(mediaAssetLink)
		.where(
			and(
				eq(mediaAssetLink.mediaAssetId, assetId),
				eq(mediaAssetLink.workspaceId, actor.workspaceId),
			),
		);
	return row?.count ?? 0;
}

export async function createMediaAssetLink(
	actor: WorkspaceActor,
	input: {
		id: string;
		projectId: string;
		mediaAssetId: string;
		usageType?: MediaAssetUsageType;
	},
) {
	const usageType = input.usageType ?? "project_resource";
	return db.transaction(async (transaction) => {
		const [asset] = await transaction
			.select({
				id: mediaAsset.id,
				workspaceId: mediaAsset.workspaceId,
				status: mediaAsset.status,
				usageRights: mediaAsset.usageRights,
			})
			.from(mediaAsset)
			.where(
				and(
					eq(mediaAsset.id, input.mediaAssetId),
					eq(mediaAsset.workspaceId, actor.workspaceId),
				),
			)
			.limit(1);
		if (!asset) {
			throw new MediaAssetError(
				"MEDIA_ASSET_NOT_FOUND",
				"Media asset was not found.",
			);
		}
		if (asset.status !== "ready") {
			throw new MediaAssetError(
				"MEDIA_ASSET_NOT_READY",
				"Only READY media assets can be linked.",
				{ status: asset.status },
			);
		}

		const [projectRecord] = await transaction
			.select({
				id: project.id,
				workspaceId: project.workspaceId,
				contentType: project.contentType,
			})
			.from(project)
			.where(
				and(
					eq(project.id, input.projectId),
					eq(project.workspaceId, actor.workspaceId),
					isNull(project.archivedAt),
				),
			)
			.limit(1);
		if (!projectRecord) {
			throw new MediaAssetError(
				"MEDIA_ASSET_WORKSPACE_MISMATCH",
				"Project is missing, archived, or outside the actor workspace.",
			);
		}
		if (
			projectRecord.contentType === "AFFILIATE" &&
			!["owned", "licensed"].includes(asset.usageRights)
		) {
			throw new MediaAssetError(
				"MEDIA_ASSET_RIGHTS_NOT_ELIGIBLE",
				"Media asset rights are not eligible for Affiliate projects.",
			);
		}

		const [existing] = await transaction
			.select()
			.from(mediaAssetLink)
			.where(
				and(
					eq(mediaAssetLink.workspaceId, actor.workspaceId),
					eq(mediaAssetLink.projectId, input.projectId),
					eq(mediaAssetLink.mediaAssetId, input.mediaAssetId),
					eq(mediaAssetLink.usageType, usageType),
				),
			)
			.limit(1);
		if (existing) return toMediaAssetLinkRecord(existing);

		const [created] = await transaction
			.insert(mediaAssetLink)
			.values({
				id: input.id,
				workspaceId: actor.workspaceId,
				projectId: input.projectId,
				mediaAssetId: input.mediaAssetId,
				usageType,
				createdByUserId: actor.userId,
			})
			.onConflictDoNothing()
			.returning();
		if (created) return toMediaAssetLinkRecord(created);
		const [raced] = await transaction
			.select()
			.from(mediaAssetLink)
			.where(
				and(
					eq(mediaAssetLink.workspaceId, actor.workspaceId),
					eq(mediaAssetLink.projectId, input.projectId),
					eq(mediaAssetLink.mediaAssetId, input.mediaAssetId),
					eq(mediaAssetLink.usageType, usageType),
				),
			)
			.limit(1);
		return raced ? toMediaAssetLinkRecord(raced) : undefined;
	});
}

export async function removeMediaAssetLink(
	actor: WorkspaceActor,
	input: {
		projectId: string;
		mediaAssetId: string;
		usageType?: MediaAssetUsageType;
	},
) {
	const [record] = await db
		.delete(mediaAssetLink)
		.where(
			and(
				eq(mediaAssetLink.workspaceId, actor.workspaceId),
				eq(mediaAssetLink.projectId, input.projectId),
				eq(mediaAssetLink.mediaAssetId, input.mediaAssetId),
				eq(mediaAssetLink.usageType, input.usageType ?? "project_resource"),
			),
		)
		.returning();
	return record ? toMediaAssetLinkRecord(record) : undefined;
}
