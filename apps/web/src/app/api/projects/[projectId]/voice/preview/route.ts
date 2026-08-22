import { createContext } from "@affichannel/api/context";
import { previewVoice } from "@affichannel/api/services/voice-preview-service";
import type { WorkspaceActor } from "@affichannel/api/services/workspace";
import { requireWorkspaceActor } from "@affichannel/api/services/workspace";
import { FactLockError, VoiceConfigError } from "@affichannel/core";
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

function mapPreviewError(error: unknown) {
	if (error instanceof FactLockError) {
		return error.code === "FACT_LOCK_NOT_FOUND"
			? jsonError(error.code, 404)
			: jsonError(error.code, 409);
	}
	if (error instanceof VoiceConfigError) {
		switch (error.code) {
			case "VOICE_CONFIG_NOT_FOUND":
				return jsonError(error.code, 404);
			case "VOICE_CONFIG_CONFLICT":
				return jsonError(error.code, 409);
			case "TTS_PREVIEW_TIMEOUT":
				return jsonError(error.code, 504);
			case "TTS_PROVIDER_UNAVAILABLE":
				return jsonError(error.code, 503);
			case "TTS_PREVIEW_FAILED":
				return jsonError(error.code, 502);
			case "VOICE_CONFIG_INPUT_INVALID":
				return jsonError(error.code, 400);
			default:
				return jsonError(error.code, 422);
		}
	}
	return jsonError("INTERNAL_SERVER_ERROR", 500);
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ projectId: string }> },
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

	const body = await request.text();
	if (body.trim()) return jsonError("BAD_REQUEST", 400);

	try {
		const { projectId } = await params;
		const result = await previewVoice(actor, projectId);
		const audio = new Uint8Array(result.audio.byteLength);
		audio.set(result.audio);
		return new Response(audio.buffer as ArrayBuffer, {
			status: 200,
			headers: {
				"Content-Type": "audio/mpeg",
				"Cache-Control": "no-store",
			},
		});
	} catch (error) {
		return mapPreviewError(error);
	}
}
