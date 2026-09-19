import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../index";
import {
	toQuickImageRenderJobDto,
	toQuickImageRenderStatusDto,
} from "../services/quick-image-render-dto";
import {
	retryFailedQuickImageRender,
	startQuickImageRender,
} from "../services/quick-image-render-service";
import {
	getQuickImageRenderStatus,
	getQuickImageRenderStatusForComposition,
} from "../services/quick-image-render-status-service";
import { RenderJobError } from "../services/render-job-repository";
import { requireWorkspaceActor } from "../services/workspace";

const idSchema = z.string().trim().min(1).max(200);
const idempotencyKeySchema = z.string().trim().min(8).max(200);

const notFoundCodes = new Set([
	"PROJECT_NOT_FOUND",
	"RENDER_JOB_NOT_FOUND",
	"RENDER_COMPOSITION_MISSING",
	"RENDER_PROJECT_MISMATCH",
	"COMPOSITION_VERSION_IDENTITY_MISMATCH",
]);

function toQuickImageRenderOrpcError(error: unknown): never {
	if (!(error instanceof RenderJobError)) throw error;
	throw new ORPCError(
		notFoundCodes.has(error.code) ? "NOT_FOUND" : "CONFLICT",
		{ message: error.code, data: { code: error.code } },
	);
}

export const quickImageRenderRouter = {
	start: protectedProcedure
		.input(
			z
				.object({
					projectId: idSchema,
					compositionVersionId: idSchema,
					idempotencyKey: idempotencyKeySchema,
				})
				.strict(),
		)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				const job = await startQuickImageRender(actor, input);
				return toQuickImageRenderJobDto(job);
			} catch (error) {
				return toQuickImageRenderOrpcError(error);
			}
		}),
	status: protectedProcedure
		.input(z.object({ projectId: idSchema, renderJobId: idSchema }).strict())
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				const status = await getQuickImageRenderStatus(actor, input);
				if (!status)
					throw new ORPCError("NOT_FOUND", {
						message: "RENDER_JOB_NOT_FOUND",
					});
				return await toQuickImageRenderStatusDto(actor, status);
			} catch (error) {
				if (error instanceof ORPCError) throw error;
				return toQuickImageRenderOrpcError(error);
			}
		}),
	forComposition: protectedProcedure
		.input(
			z
				.object({ projectId: idSchema, compositionVersionId: idSchema })
				.strict(),
		)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			const status = await getQuickImageRenderStatusForComposition(
				actor,
				input,
			);
			return status ? toQuickImageRenderStatusDto(actor, status) : null;
		}),
	retry: protectedProcedure
		.input(
			z
				.object({
					projectId: idSchema,
					failedRenderJobId: idSchema,
					idempotencyKey: idempotencyKeySchema,
				})
				.strict(),
		)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				const job = await retryFailedQuickImageRender(actor, input);
				return toQuickImageRenderJobDto(job);
			} catch (error) {
				return toQuickImageRenderOrpcError(error);
			}
		}),
};
