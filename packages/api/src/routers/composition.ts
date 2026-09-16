import { CompositionError } from "@affichannel/core";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../index";
import { preflightCompositionVersion } from "../services/composition-preflight-service";
import {
	CompositionPreviewDescriptorAccessError,
	createQuickImageCompositionPreviewDescriptor,
	findCompositionVersionRecord,
	listCompositionVersionRecords,
} from "../services/composition-service";
import { requireWorkspaceActor } from "../services/workspace";

const idSchema = z.string().trim().min(1).max(200);
function toCompositionOrpcError(error: unknown): never {
	if (!(error instanceof CompositionError)) throw error;
	const badRequest =
		error.code === "COMPOSITION_INPUT_INCOMPLETE" ||
		error.code === "COMPOSITION_INPUT_INVALID";
	throw new ORPCError(
		badRequest
			? "BAD_REQUEST"
			: error.code === "COMPOSITION_VERSION_NOT_FOUND"
				? "NOT_FOUND"
				: "CONFLICT",
		{ message: error.code, data: { code: error.code } },
	);
}

export const compositionRouter = {
	get: protectedProcedure
		.input(z.object({ compositionVersionId: idSchema }).strict())
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			const result = await findCompositionVersionRecord(
				actor,
				input.compositionVersionId,
			);
			if (!result)
				throw new ORPCError("NOT_FOUND", {
					message: "COMPOSITION_VERSION_NOT_FOUND",
				});
			return result;
		}),
	list: protectedProcedure
		.input(z.object({ projectId: idSchema }).strict())
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			return listCompositionVersionRecords(actor, input.projectId);
		}),
	preflight: protectedProcedure
		.input(z.object({ compositionVersionId: idSchema }).strict())
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await preflightCompositionVersion(
					actor,
					input.compositionVersionId,
				);
			} catch (error) {
				return toCompositionOrpcError(error);
			}
		}),
	previewDescriptor: protectedProcedure
		.input(
			z
				.object({
					projectId: idSchema,
					compositionVersionId: idSchema,
				})
				.strict(),
		)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await createQuickImageCompositionPreviewDescriptor(
					actor,
					input.projectId,
					input.compositionVersionId,
				);
			} catch (error) {
				if (!(error instanceof CompositionPreviewDescriptorAccessError))
					throw error;
				const code = error.code;
				const status =
					code === "PREVIEW_COMPOSITION_MISSING"
						? "NOT_FOUND"
						: code === "PREVIEW_PROJECT_MISMATCH"
							? "FORBIDDEN"
							: "CONFLICT";
				throw new ORPCError(status, {
					message: code,
					data: { code },
				});
			}
		}),
};
