import { randomUUID } from "node:crypto";
import {
	classifyPersistedProjectIdentity,
	evaluateQuickImageEligibility,
	type QuickImageCurrentSourceResolution,
	type QuickImageEligibilityReason,
	type QuickImageSourceAuthority,
	resolveQuickImageCurrentSourceRows,
} from "@affichannel/core";
import { db, mediaAsset, mediaAssetLink, project } from "@affichannel/db";
import { and, eq, isNull } from "drizzle-orm";
import type { DbTransaction } from "./fact-dependency-repository";
import type { WorkspaceActor } from "./workspace";

const QUICK_IMAGE_USAGE_TYPE = "quick_image_current_source" as const;

export const quickImageSourceServiceErrorCodes = [
	"QUICK_IMAGE_PROJECT_NOT_FOUND",
	"QUICK_IMAGE_PROJECT_IDENTITY_INVALID",
	"QUICK_IMAGE_MEDIA_ASSET_NOT_FOUND",
	"QUICK_IMAGE_MEDIA_ASSET_INELIGIBLE",
	"QUICK_IMAGE_SOURCE_CORRUPT_MULTIPLE",
	"QUICK_IMAGE_SOURCE_REPLACEMENT_FAILED",
] as const;

export type QuickImageSourceServiceErrorCode =
	(typeof quickImageSourceServiceErrorCodes)[number];

export class QuickImageSourceServiceError extends Error {
	constructor(
		public readonly code: QuickImageSourceServiceErrorCode,
		public readonly metadata: {
			reasonCode?: QuickImageEligibilityReason;
		} = {},
	) {
		super(code);
		this.name = "QuickImageSourceServiceError";
	}
}

export type QuickImageSourceResolution = QuickImageCurrentSourceResolution;

export type SetQuickImageCurrentSourceInput = Readonly<{
	actor: WorkspaceActor;
	projectId: string;
	mediaAssetId: string;
}>;

export type SetQuickImageCurrentSourceResult = Readonly<{
	kind: "SET" | "NOOP";
	linkId: string;
	source: QuickImageSourceAuthority;
}>;

const projectIdentitySelection = {
	id: project.id,
	productId: project.productId,
	contentType: project.contentType,
	creationPath: project.creationPath,
	contentFormatKey: project.contentFormatKey,
	contentFormatVersion: project.contentFormatVersion,
};

const mediaAssetSelection = {
	id: mediaAsset.id,
	workspaceId: mediaAsset.workspaceId,
	status: mediaAsset.status,
	archivedAt: mediaAsset.archivedAt,
	mediaType: mediaAsset.mediaType,
	storageProvider: mediaAsset.storageProvider,
	storageKey: mediaAsset.storageKey,
	mimeType: mediaAsset.mimeType,
	byteSize: mediaAsset.byteSize,
	checksumSha256: mediaAsset.checksumSha256,
	width: mediaAsset.width,
	height: mediaAsset.height,
	imageAnalysisVersion: mediaAsset.imageAnalysisVersion,
	imageFrameCount: mediaAsset.imageFrameCount,
	imageExifOrientation: mediaAsset.imageExifOrientation,
	imageHasTransparency: mediaAsset.imageHasTransparency,
};

type DbQuery = typeof db | DbTransaction;

async function findProject(
	query: DbQuery,
	workspaceId: string,
	projectId: string,
	lock: boolean,
) {
	const builder = query
		.select(projectIdentitySelection)
		.from(project)
		.where(
			and(
				eq(project.id, projectId),
				eq(project.workspaceId, workspaceId),
				isNull(project.archivedAt),
			),
		)
		.limit(1);
	const [record] = await (lock
		? builder.for("update", { of: project })
		: builder);
	return record;
}

function isQuickImageProjectIdentity(
	record: NonNullable<Awaited<ReturnType<typeof findProject>>>,
) {
	const classification = classifyPersistedProjectIdentity({
		productId: record.productId,
		contentType: record.contentType,
		creationPath: record.creationPath,
		contentFormatKey: record.contentFormatKey,
		contentFormatVersion: record.contentFormatVersion,
	});
	return (
		classification.kind === "canonical" &&
		classification.identity.creationPath === "QUICK_IMAGE" &&
		classification.identity.contentFormat.key === "QUICK_IMAGE_STANDARD" &&
		classification.identity.contentFormat.version === 1
	);
}

async function requireQuickImageProject(
	query: DbQuery,
	workspaceId: string,
	projectId: string,
	lock: boolean,
) {
	const record = await findProject(query, workspaceId, projectId, lock);
	if (!record) {
		throw new QuickImageSourceServiceError("QUICK_IMAGE_PROJECT_NOT_FOUND");
	}
	if (!isQuickImageProjectIdentity(record)) {
		throw new QuickImageSourceServiceError(
			"QUICK_IMAGE_PROJECT_IDENTITY_INVALID",
		);
	}
	return record;
}

async function findCurrentSourceRows(
	query: DbQuery,
	workspaceId: string,
	projectId: string,
) {
	const links = await query
		.select({
			linkId: mediaAssetLink.id,
			mediaAssetId: mediaAssetLink.mediaAssetId,
		})
		.from(mediaAssetLink)
		.where(
			and(
				eq(mediaAssetLink.workspaceId, workspaceId),
				eq(mediaAssetLink.projectId, projectId),
				eq(mediaAssetLink.usageType, QUICK_IMAGE_USAGE_TYPE),
			),
		)
		.orderBy(mediaAssetLink.id);

	const rows = [];
	for (const link of links) {
		const [asset] = await query
			.select(mediaAssetSelection)
			.from(mediaAsset)
			.where(
				and(
					eq(mediaAsset.id, link.mediaAssetId),
					eq(mediaAsset.workspaceId, workspaceId),
				),
			)
			.limit(1);
		if (!asset) {
			throw new QuickImageSourceServiceError(
				"QUICK_IMAGE_MEDIA_ASSET_NOT_FOUND",
			);
		}
		rows.push({ linkId: link.linkId, asset });
	}
	return rows;
}

export async function resolveQuickImageCurrentSource(input: {
	workspaceId: string;
	projectId: string;
}): Promise<QuickImageSourceResolution> {
	await requireQuickImageProject(db, input.workspaceId, input.projectId, false);
	return resolveQuickImageCurrentSourceRows(
		await findCurrentSourceRows(db, input.workspaceId, input.projectId),
	);
}

export async function setQuickImageCurrentSource(
	input: SetQuickImageCurrentSourceInput,
): Promise<SetQuickImageCurrentSourceResult> {
	return db.transaction(async (transaction) => {
		await requireQuickImageProject(
			transaction,
			input.actor.workspaceId,
			input.projectId,
			true,
		);

		const [asset] = await transaction
			.select(mediaAssetSelection)
			.from(mediaAsset)
			.where(
				and(
					eq(mediaAsset.id, input.mediaAssetId),
					eq(mediaAsset.workspaceId, input.actor.workspaceId),
				),
			)
			.limit(1);
		if (!asset) {
			throw new QuickImageSourceServiceError(
				"QUICK_IMAGE_MEDIA_ASSET_NOT_FOUND",
			);
		}

		const eligibility = evaluateQuickImageEligibility(asset);
		if (eligibility.kind === "INELIGIBLE") {
			throw new QuickImageSourceServiceError(
				"QUICK_IMAGE_MEDIA_ASSET_INELIGIBLE",
				{ reasonCode: eligibility.reasonCode },
			);
		}

		const existingRows = await findCurrentSourceRows(
			transaction,
			input.actor.workspaceId,
			input.projectId,
		);
		if (existingRows.length > 1) {
			throw new QuickImageSourceServiceError(
				"QUICK_IMAGE_SOURCE_CORRUPT_MULTIPLE",
			);
		}

		const existing = existingRows[0];
		if (existing?.asset.id === input.mediaAssetId) {
			return {
				kind: "NOOP",
				linkId: existing.linkId,
				source: eligibility.source,
			};
		}

		if (existing) {
			const [updated] = await transaction
				.update(mediaAssetLink)
				.set({ mediaAssetId: input.mediaAssetId })
				.where(
					and(
						eq(mediaAssetLink.id, existing.linkId),
						eq(mediaAssetLink.workspaceId, input.actor.workspaceId),
						eq(mediaAssetLink.projectId, input.projectId),
						eq(mediaAssetLink.usageType, QUICK_IMAGE_USAGE_TYPE),
					),
				)
				.returning({ id: mediaAssetLink.id });
			if (!updated) {
				throw new QuickImageSourceServiceError(
					"QUICK_IMAGE_SOURCE_REPLACEMENT_FAILED",
				);
			}
			return {
				kind: "SET",
				linkId: updated.id,
				source: eligibility.source,
			};
		}

		const [created] = await transaction
			.insert(mediaAssetLink)
			.values({
				id: randomUUID(),
				workspaceId: input.actor.workspaceId,
				projectId: input.projectId,
				mediaAssetId: input.mediaAssetId,
				usageType: QUICK_IMAGE_USAGE_TYPE,
				createdByUserId: input.actor.userId,
			})
			.returning({ id: mediaAssetLink.id });
		if (!created) {
			throw new QuickImageSourceServiceError(
				"QUICK_IMAGE_SOURCE_REPLACEMENT_FAILED",
			);
		}
		return {
			kind: "SET",
			linkId: created.id,
			source: eligibility.source,
		};
	});
}
