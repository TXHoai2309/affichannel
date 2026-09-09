import { createContext } from "@affichannel/api/context";
import {
	CompositionPreviewAccessError,
	readCompositionPreviewDependency,
} from "@affichannel/api/services/composition-preview-grants";
import type { WorkspaceActor } from "@affichannel/api/services/workspace";
import { requireWorkspaceActor } from "@affichannel/api/services/workspace";
import { ORPCError } from "@orpc/server";

function errorResponse(code: string, status: number) {
	return Response.json(
		{ code, message: code },
		{ status, headers: { "Cache-Control": "no-store" } },
	);
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
		const result = await readCompositionPreviewDependency(
			actor,
			(await params).token,
		);
		return new Response(Buffer.from(result.bytes), {
			status: 200,
			headers: {
				"Cache-Control": "private, no-store",
				"Content-Type": result.contentType,
				"Content-Length": String(result.byteSize),
				ETag: `"${result.checksum}"`,
			},
		});
	} catch (error) {
		if (error instanceof CompositionPreviewAccessError) {
			const status =
				error.code === "PREVIEW_GRANT_INVALID" ||
				error.code === "PREVIEW_GRANT_EXPIRED"
					? 400
					: error.code === "PREVIEW_DEPENDENCY_MISSING"
						? 404
						: error.code === "PREVIEW_DEPENDENCY_UNAVAILABLE"
							? 503
							: 403;
			return errorResponse(error.code, status);
		}
		return errorResponse("INTERNAL_SERVER_ERROR", 500);
	}
}
