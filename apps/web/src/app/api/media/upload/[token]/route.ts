import { createContext } from "@affichannel/api/context";
import { sha256Bytes } from "@affichannel/api/media/media-asset-checksum";
import { getMediaAssetSizeLimits } from "@affichannel/api/media/media-asset-config";
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

async function readBoundedBody(request: Request, maxBytes: number) {
	const declaredLength = Number(request.headers.get("content-length") ?? "0");
	if (declaredLength > maxBytes)
		throw new MediaAssetError(
			"MEDIA_ASSET_SIZE_LIMIT_EXCEEDED",
			"Upload exceeds the configured size limit.",
		);
	if (!request.body) return new Uint8Array();
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			if (next.value) {
				total += next.value.byteLength;
				if (total > maxBytes)
					throw new MediaAssetError(
						"MEDIA_ASSET_SIZE_LIMIT_EXCEEDED",
						"Upload exceeds the configured size limit.",
					);
				chunks.push(next.value);
			}
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export async function PUT(
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
		const token = verifyLocalMediaAssetGrant((await params).token, "upload");
		if (token.workspaceId !== actor.workspaceId)
			throw new MediaAssetError(
				"MEDIA_ASSET_GRANT_INVALID",
				"Media grant is invalid.",
			);
		const asset = await findMediaAssetByIdForWorkspace(actor, token.assetId);
		if (!asset)
			throw new MediaAssetError(
				"MEDIA_ASSET_UPLOAD_NOT_ALLOWED",
				"Upload grant is no longer valid.",
			);
		if (
			asset.storageProvider !== "local" ||
			asset.storageKey !== token.storageKey ||
			asset.uploadSessionId !== token.uploadSessionId ||
			asset.status !== "pending_upload"
		)
			throw new MediaAssetError(
				"MEDIA_ASSET_UPLOAD_NOT_ALLOWED",
				"Upload grant is no longer valid.",
			);
		if (asset.uploadExpiresAt.getTime() <= Date.now())
			throw new MediaAssetError(
				"MEDIA_ASSET_UPLOAD_EXPIRED",
				"Upload grant has expired.",
			);
		const contentType = request.headers.get("content-type")?.trim();
		if (
			!contentType ||
			contentType !== asset.declaredMimeType ||
			contentType !== token.contentType
		)
			throw new MediaAssetError(
				"MEDIA_ASSET_INVALID_MEDIA",
				"Upload Content-Type does not match the prepared media.",
			);
		const maxBytes = Math.min(
			getMediaAssetSizeLimits()[asset.mediaType],
			token.byteSize ?? Number.MAX_SAFE_INTEGER,
		);
		const bytes = await readBoundedBody(request, maxBytes);
		if (bytes.byteLength <= 0)
			throw new MediaAssetError(
				"MEDIA_ASSET_INVALID_MEDIA",
				"Upload body is empty.",
			);
		if (token.strictByteSize && bytes.byteLength !== token.byteSize)
			throw new MediaAssetError(
				"MEDIA_ASSET_INVALID_METADATA",
				"Upload byte size does not match the prepared intent.",
			);
		const storage = createMediaAssetStorage("local");
		if (await storage.head(asset.storageKey))
			throw new MediaAssetError(
				"MEDIA_ASSET_UPLOAD_NOT_ALLOWED",
				"Upload grant has already been redeemed.",
			);
		await storage.put({
			storageKey: asset.storageKey,
			body: bytes,
			contentType,
			checksumSha256: sha256Bytes(bytes),
		});
		return Response.json(
			{ uploaded: true },
			{ status: 201, headers: { "Cache-Control": "no-store" } },
		);
	} catch (error) {
		if (error instanceof MediaAssetError) {
			const status = [
				"MEDIA_ASSET_GRANT_INVALID",
				"MEDIA_ASSET_GRANT_EXPIRED",
				"MEDIA_ASSET_UPLOAD_EXPIRED",
				"MEDIA_ASSET_INVALID_MEDIA",
				"MEDIA_ASSET_INVALID_METADATA",
				"MEDIA_ASSET_SIZE_LIMIT_EXCEEDED",
			].includes(error.code)
				? 400
				: error.code === "MEDIA_ASSET_UPLOAD_NOT_ALLOWED"
					? 409
					: error.code === "MEDIA_ASSET_STORAGE_NOT_FOUND"
						? 404
						: 503;
			return errorResponse(error.code, status);
		}
		return errorResponse("INTERNAL_SERVER_ERROR", 500);
	}
}
