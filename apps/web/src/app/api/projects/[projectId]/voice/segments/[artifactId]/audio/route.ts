import { createContext } from "@affichannel/api/context";
import { findVoiceSegmentArtifactById } from "@affichannel/api/services/voice-segment-repository";
import type { WorkspaceActor } from "@affichannel/api/services/workspace";
import { requireWorkspaceActor } from "@affichannel/api/services/workspace";
import { createVoiceAudioStorage } from "@affichannel/api/storage/voice-audio-storage-factory";
import { VoiceSegmentError } from "@affichannel/core";
import { ORPCError } from "@orpc/server";

function jsonError(code: string, status: number) {
	return Response.json(
		{ code, message: code },
		{
			status,
			headers: { "Cache-Control": "no-store" },
		},
	);
}

function cacheHeaders(checksum: string) {
	return {
		"Cache-Control": "private, max-age=31536000, immutable",
		ETag: `"${checksum}"`,
	};
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ projectId: string; artifactId: string }> },
) {
	const context = await createContext(request);
	if (!context.session?.user) return jsonError("UNAUTHORIZED", 401);

	let actor: WorkspaceActor;
	try {
		actor = await requireWorkspaceActor(context.session.user.id);
	} catch (error) {
		if (error instanceof ORPCError && error.code === "FORBIDDEN") {
			return jsonError("FORBIDDEN", 403);
		}
		return jsonError("INTERNAL_SERVER_ERROR", 500);
	}

	try {
		const { projectId, artifactId } = await params;
		const artifact = await findVoiceSegmentArtifactById(actor, artifactId);
		if (
			!artifact ||
			artifact.projectId !== projectId ||
			artifact.status !== "completed" ||
			!artifact.storageKey ||
			!artifact.checksum ||
			artifact.mimeType !== "audio/mpeg"
		) {
			return jsonError("VOICE_SEGMENT_NOT_FOUND", 404);
		}

		const headers = cacheHeaders(artifact.checksum);
		if (request.headers.get("if-none-match") === headers.ETag) {
			return new Response(null, { status: 304, headers });
		}

		const storage = createVoiceAudioStorage();
		const stream = await storage.open(artifact.storageKey);
		return new Response(stream, {
			status: 200,
			headers: {
				...headers,
				"Content-Type": "audio/mpeg",
				...(artifact.byteSize !== null
					? { "Content-Length": String(artifact.byteSize) }
					: {}),
			},
		});
	} catch (error) {
		if (error instanceof VoiceSegmentError) {
			if (error.code === "TTS_STORAGE_FAILED") {
				return jsonError(error.code, 503);
			}
			if (error.code === "TTS_STORAGE_CONFIGURATION_INVALID") {
				return jsonError(error.code, 503);
			}
		}
		return jsonError("INTERNAL_SERVER_ERROR", 500);
	}
}
