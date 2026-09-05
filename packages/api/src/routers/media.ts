import {
	MediaAssetError,
	mediaAssetMediaTypes,
	mediaAssetMimeTypes,
	mediaAssetStatusSchema,
	mediaAssetUsageTypeSchema,
	mediaUsageRightsSchema,
} from "@affichannel/core";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
	archiveMediaAssetRecord,
	finalizeMediaAssetUpload,
	getMediaAsset,
	getMediaAssetDownload,
	linkMediaAssetToProject,
	listMediaAssets,
	prepareMediaAssetUpload,
	unlinkMediaAssetFromProject,
	updateMediaAsset,
} from "../services/media-asset-service";
import { requireWorkspaceActor } from "../services/workspace";

const idSchema = z.string().trim().min(1).max(200);
const prepareSchema = z
	.object({
		mediaType: z.enum(mediaAssetMediaTypes),
		originalFilename: z.string().min(1).max(255),
		displayName: z.string().trim().min(1).max(240),
		declaredMimeType: z.enum(mediaAssetMimeTypes),
		declaredByteSize: z.number().int().safe().positive(),
		usageRights: mediaUsageRightsSchema.optional(),
		tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
		idempotencyKey: idSchema,
	})
	.strict();
const finalizeSchema = z.object({
	assetId: idSchema,
	uploadSessionId: idSchema,
});
const listSchema = z.object({
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(100).default(30),
	mediaType: z.enum(mediaAssetMediaTypes).optional(),
	status: mediaAssetStatusSchema.optional(),
	archiveScope: z
		.enum(["activeOnly", "archivedOnly", "all"])
		.default("activeOnly"),
	includeArchived: z.boolean().optional(),
	search: z.string().trim().max(200).optional(),
	tag: z.string().trim().max(80).optional(),
});
const metadataSchema = z
	.object({
		assetId: idSchema,
		displayName: z.string().trim().min(1).max(240),
		tags: z.array(z.string().trim().min(1).max(80)).max(50),
		usageRights: mediaUsageRightsSchema,
	})
	.strict();
const linkSchema = z.object({
	assetId: idSchema,
	projectId: idSchema,
	usageType: mediaAssetUsageTypeSchema.optional(),
});

function toMediaOrpcError(error: unknown): never {
	if (!(error instanceof MediaAssetError)) throw error;
	const data = { code: error.code };
	if (
		[
			"MEDIA_ASSET_INVALID_METADATA",
			"MEDIA_ASSET_INVALID_CURSOR",
			"MEDIA_ASSET_FILENAME_INVALID",
			"MEDIA_ASSET_INVALID_MEDIA",
			"MEDIA_ASSET_SIZE_LIMIT_EXCEEDED",
			"MEDIA_ASSET_CHECKSUM_INVALID",
			"MEDIA_ASSET_INVALID_STATUS",
			"MEDIA_ASSET_UPLOAD_SESSION_INVALID",
			"MEDIA_ASSET_GRANT_INVALID",
			"MEDIA_ASSET_GRANT_EXPIRED",
			"MEDIA_ASSET_UPLOAD_EXPIRED",
		].includes(error.code)
	) {
		throw new ORPCError("BAD_REQUEST", { message: error.code, data });
	}
	if (
		[
			"MEDIA_ASSET_IDEMPOTENCY_CONFLICT",
			"MEDIA_ASSET_NOT_READY",
			"MEDIA_ASSET_RIGHTS_NOT_ELIGIBLE",
			"MEDIA_ASSET_DOWNLOAD_NOT_ALLOWED",
			"MEDIA_ASSET_UPLOAD_NOT_ALLOWED",
			"MEDIA_ASSET_VALIDATION_IN_PROGRESS",
		].includes(error.code)
	) {
		throw new ORPCError("CONFLICT", { message: error.code, data });
	}
	if (
		error.code === "MEDIA_ASSET_STORAGE_UNAVAILABLE" ||
		error.code === "MEDIA_ASSET_STORAGE_ERROR"
	) {
		throw new ORPCError("SERVICE_UNAVAILABLE", { message: error.code, data });
	}
	if (error.code === "MEDIA_ASSET_STORAGE_NOT_FOUND") {
		throw new ORPCError("NOT_FOUND", { message: error.code, data });
	}
	throw new ORPCError("NOT_FOUND", { message: error.code, data });
}

async function actorFor(userId: string) {
	return requireWorkspaceActor(userId);
}

export const mediaRouter = {
	list: protectedProcedure
		.input(listSchema)
		.handler(async ({ context, input }) => {
			try {
				return await listMediaAssets(
					await actorFor(context.session.user.id),
					input,
				);
			} catch (error) {
				return toMediaOrpcError(error);
			}
		}),
	get: protectedProcedure
		.input(z.object({ assetId: idSchema }))
		.handler(async ({ context, input }) => {
			try {
				return await getMediaAsset(
					await actorFor(context.session.user.id),
					input.assetId,
				);
			} catch (error) {
				return toMediaOrpcError(error);
			}
		}),
	prepareUpload: protectedProcedure
		.input(prepareSchema)
		.handler(async ({ context, input }) => {
			try {
				return await prepareMediaAssetUpload(
					await actorFor(context.session.user.id),
					input,
				);
			} catch (error) {
				return toMediaOrpcError(error);
			}
		}),
	finalizeUpload: protectedProcedure
		.input(finalizeSchema)
		.handler(async ({ context, input }) => {
			try {
				return await finalizeMediaAssetUpload(
					await actorFor(context.session.user.id),
					input,
				);
			} catch (error) {
				return toMediaOrpcError(error);
			}
		}),
	updateMetadata: protectedProcedure
		.input(metadataSchema)
		.handler(async ({ context, input }) => {
			try {
				return await updateMediaAsset(
					await actorFor(context.session.user.id),
					input.assetId,
					input,
				);
			} catch (error) {
				return toMediaOrpcError(error);
			}
		}),
	archive: protectedProcedure
		.input(z.object({ assetId: idSchema }))
		.handler(async ({ context, input }) => {
			try {
				return await archiveMediaAssetRecord(
					await actorFor(context.session.user.id),
					input.assetId,
				);
			} catch (error) {
				return toMediaOrpcError(error);
			}
		}),
	getDownload: protectedProcedure
		.input(z.object({ assetId: idSchema }))
		.handler(async ({ context, input }) => {
			try {
				return await getMediaAssetDownload(
					await actorFor(context.session.user.id),
					input.assetId,
				);
			} catch (error) {
				return toMediaOrpcError(error);
			}
		}),
	linkToProject: protectedProcedure
		.input(linkSchema)
		.handler(async ({ context, input }) => {
			try {
				return await linkMediaAssetToProject(
					await actorFor(context.session.user.id),
					input,
				);
			} catch (error) {
				return toMediaOrpcError(error);
			}
		}),
	unlinkFromProject: protectedProcedure
		.input(linkSchema)
		.handler(async ({ context, input }) => {
			try {
				return await unlinkMediaAssetFromProject(
					await actorFor(context.session.user.id),
					input,
				);
			} catch (error) {
				return toMediaOrpcError(error);
			}
		}),
};

export { toMediaOrpcError };
