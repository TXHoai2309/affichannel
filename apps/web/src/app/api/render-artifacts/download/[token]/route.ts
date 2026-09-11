import { createContext } from "@affichannel/api/context";
import { verifyRenderArtifactDownloadGrant } from "@affichannel/api/media/render-artifact-grants";
import { findRenderArtifactById } from "@affichannel/api/services/render-artifact-repository";
import type { WorkspaceActor } from "@affichannel/api/services/workspace";
import { requireWorkspaceActor } from "@affichannel/api/services/workspace";
import { RenderOutputStorageError } from "@affichannel/api/storage/render-output-storage";
import { createRenderOutputStorage } from "@affichannel/api/storage/render-output-storage-factory";
import { MediaAssetError } from "@affichannel/core";
import { ORPCError } from "@orpc/server";

function errorResponse(code: string, status: number) {
	return Response.json(
		{ code, message: code },
		{ status, headers: { "Cache-Control": "no-store" } },
	);
}

function parseRange(value: string | null, total: number) {
	if (value === null) return null;
	if (!value.startsWith("bytes=") || value.slice(6).includes(","))
		return "INVALID" as const;
	const range = value.slice(6).trim();
	const separator = range.indexOf("-");
	if (separator < 0) return "INVALID" as const;
	const startText = range.slice(0, separator).trim();
	const endText = range.slice(separator + 1).trim();
	if (!startText && !endText) return "INVALID" as const;
	if (!startText) {
		const suffix = Number(endText);
		if (!Number.isSafeInteger(suffix) || suffix <= 0) return "INVALID" as const;
		const start = Math.max(0, total - suffix);
		return { start, end: total - 1 };
	}
	const start = Number(startText);
	if (!Number.isSafeInteger(start) || start < 0 || start >= total)
		return "INVALID" as const;
	const requestedEnd = endText ? Number(endText) : total - 1;
	if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start)
		return "INVALID" as const;
	return { start, end: Math.min(requestedEnd, total - 1) };
}

async function actorForRequest(request: Request) {
	const context = await createContext(request);
	if (!context.session?.user) return null;
	try {
		return await requireWorkspaceActor(context.session.user.id);
	} catch (error) {
		if (error instanceof ORPCError && error.code === "FORBIDDEN")
			throw new MediaAssetError("MEDIA_ASSET_DOWNLOAD_NOT_ALLOWED");
		throw error;
	}
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ token: string }> },
) {
	let actor: WorkspaceActor | null;
	try {
		actor = await actorForRequest(request);
	} catch (error) {
		if (error instanceof MediaAssetError) return errorResponse(error.code, 403);
		return errorResponse("INTERNAL_SERVER_ERROR", 500);
	}
	if (!actor) return errorResponse("UNAUTHORIZED", 401);

	try {
		const token = verifyRenderArtifactDownloadGrant((await params).token);
		if (token.workspaceId !== actor.workspaceId)
			throw new MediaAssetError("MEDIA_ASSET_DOWNLOAD_NOT_ALLOWED");
		const artifact = await findRenderArtifactById(
			actor,
			token.renderArtifactId,
		);
		if (
			!artifact ||
			artifact.id !== token.renderArtifactId ||
			artifact.projectId !== token.projectId ||
			artifact.mimeType !== "video/mp4" ||
			artifact.byteSize !== token.byteSize ||
			artifact.checksumSha256 !== token.checksumSha256
		)
			throw new MediaAssetError("MEDIA_ASSET_DOWNLOAD_NOT_ALLOWED");

		const storage = createRenderOutputStorage(artifact.storageProvider);
		const stored = await storage.head(artifact.storageKey);
		if (
			!stored ||
			stored.byteSize !== artifact.byteSize ||
			(artifact.storageProvider === "r2" &&
				stored.contentType !== artifact.mimeType) ||
			(stored.contentType !== null &&
				stored.contentType !== artifact.mimeType) ||
			(stored.checksumSha256 !== null &&
				stored.checksumSha256 !== artifact.checksumSha256)
		)
			throw new MediaAssetError("MEDIA_ASSET_STORAGE_NOT_FOUND");
		// R2 HEAD carries the immutable SHA-256 metadata written at publication;
		// local HEAD deliberately does not, so local downloads retain a full
		// digest scan at this read boundary. Completion-time proof is always full.
		if (stored.checksumSha256 === null) {
			try {
				await storage.verifyExact({
					storageKey: artifact.storageKey,
					byteSize: artifact.byteSize,
					checksumSha256: artifact.checksumSha256,
				});
			} catch (error) {
				if (
					!(error instanceof RenderOutputStorageError) ||
					(error.code !== "RENDER_OUTPUT_STORAGE_NOT_FOUND" &&
						error.code !== "RENDER_OUTPUT_STORAGE_CONFLICT")
				)
					throw error;
				throw new MediaAssetError("MEDIA_ASSET_STORAGE_NOT_FOUND");
			}
		}

		const range = parseRange(request.headers.get("range"), artifact.byteSize);
		const baseHeaders = {
			"Cache-Control": "private, no-store",
			"Content-Type": artifact.mimeType,
			"Accept-Ranges": "bytes",
			ETag: `"${artifact.checksumSha256}"`,
		};
		if (range === "INVALID") {
			return new Response(null, {
				status: 416,
				headers: {
					...baseHeaders,
					"Content-Length": "0",
					"Content-Range": `bytes */${artifact.byteSize}`,
				},
			});
		}
		if (!range) {
			const stream = await storage.open(artifact.storageKey);
			return new Response(stream, {
				status: 200,
				headers: {
					...baseHeaders,
					"Content-Length": String(artifact.byteSize),
				},
			});
		}
		const ranged = await storage.openRange({
			storageKey: artifact.storageKey,
			start: range.start,
			end: range.end,
		});
		if (
			ranged.start !== range.start ||
			ranged.end !== range.end ||
			ranged.byteSize !== range.end - range.start + 1 ||
			ranged.contentType !== artifact.mimeType
		)
			throw new MediaAssetError("MEDIA_ASSET_STORAGE_NOT_FOUND");
		return new Response(ranged.stream, {
			status: 206,
			headers: {
				...baseHeaders,
				"Content-Length": String(ranged.byteSize),
				"Content-Range": `bytes ${ranged.start}-${ranged.end}/${artifact.byteSize}`,
			},
		});
	} catch (error) {
		if (error instanceof MediaAssetError) {
			const status =
				error.code === "MEDIA_ASSET_GRANT_EXPIRED" ||
				error.code === "MEDIA_ASSET_GRANT_INVALID"
					? 400
					: error.code === "MEDIA_ASSET_STORAGE_NOT_FOUND"
						? 404
						: 403;
			return errorResponse(error.code, status);
		}
		if (error instanceof RenderOutputStorageError) {
			if (
				error.code === "RENDER_OUTPUT_STORAGE_NOT_FOUND" ||
				error.code === "RENDER_OUTPUT_STORAGE_CONFLICT"
			)
				return errorResponse("MEDIA_ASSET_STORAGE_NOT_FOUND", 404);
			return errorResponse("INTERNAL_SERVER_ERROR", 500);
		}
		return errorResponse("INTERNAL_SERVER_ERROR", 500);
	}
}
