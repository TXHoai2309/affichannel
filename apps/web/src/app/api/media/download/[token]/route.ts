import { createContext } from "@affichannel/api/context";
import { verifyLocalMediaAssetGrant } from "@affichannel/api/media/media-asset-grants";
import { createMediaAssetStorage } from "@affichannel/api/media/media-asset-storage-factory";
import { findMediaAssetByIdForWorkspace } from "@affichannel/api/services/media-asset-repository";
import type { WorkspaceActor } from "@affichannel/api/services/workspace";
import { requireWorkspaceActor } from "@affichannel/api/services/workspace";
import { MediaAssetError } from "@affichannel/core";
import { ORPCError } from "@orpc/server";

function errorResponse(code: string, status: number) {
	return Response.json(
		{ code, message: code },
		{ status, headers: { "Cache-Control": "no-store" } },
	);
}

function contentDisposition(filename: string) {
	const safe =
		filename.replace(/[\r\n"\\]/g, "_").slice(0, 200) || "media-asset";
	return `attachment; filename="${safe}"`;
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ token: string }> },
) {
	const context = await createContext(request);
	if (!context.session?.user) return errorResponse("UNAUTHORIZED", 401);
	let actor: WorkspaceActor;
	try {
		actor = await requireWorkspaceActor(context.session.user.id);
	} catch (error) {
		return errorResponse(
			error instanceof ORPCError && error.code === "FORBIDDEN"
				? "FORBIDDEN"
				: "INTERNAL_SERVER_ERROR",
			error instanceof ORPCError && error.code === "FORBIDDEN" ? 403 : 500,
		);
	}
	try {
		const token = verifyLocalMediaAssetGrant((await params).token, "download");
		if (token.workspaceId !== actor.workspaceId)
			throw new MediaAssetError(
				"MEDIA_ASSET_GRANT_INVALID",
				"Media grant is invalid.",
			);
		const asset = await findMediaAssetByIdForWorkspace(actor, token.assetId);
		if (!asset)
			throw new MediaAssetError(
				"MEDIA_ASSET_DOWNLOAD_NOT_ALLOWED",
				"Download grant is no longer valid.",
			);
		if (
			asset.storageProvider !== "local" ||
			asset.storageKey !== token.storageKey ||
			(asset.status !== "ready" && asset.status !== "archived") ||
			asset.mimeType !== token.contentType
		)
			throw new MediaAssetError(
				"MEDIA_ASSET_DOWNLOAD_NOT_ALLOWED",
				"Download grant is no longer valid.",
			);
		const stream = await createMediaAssetStorage("local").open(
			asset.storageKey,
		);
		return new Response(stream, {
			status: 200,
			headers: {
				"Cache-Control": "private, no-store",
				"Content-Type": asset.mimeType ?? "application/octet-stream",
				...(asset.byteSize !== null
					? { "Content-Length": String(asset.byteSize) }
					: {}),
				"Content-Disposition": contentDisposition(asset.originalFilename),
				...(asset.checksumSha256 ? { ETag: `"${asset.checksumSha256}"` } : {}),
			},
		});
	} catch (error) {
		if (error instanceof MediaAssetError) {
			const status = [
				"MEDIA_ASSET_GRANT_INVALID",
				"MEDIA_ASSET_GRANT_EXPIRED",
			].includes(error.code)
				? 400
				: [
							"MEDIA_ASSET_DOWNLOAD_NOT_ALLOWED",
							"MEDIA_ASSET_STORAGE_NOT_FOUND",
						].includes(error.code)
					? 404
					: 503;
			return errorResponse(error.code, status);
		}
		return errorResponse("INTERNAL_SERVER_ERROR", 500);
	}
}
