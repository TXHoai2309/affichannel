import { ScriptVersionError } from "@affichannel/core";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
	autosaveScriptVersion,
	getCurrentScriptVersion,
	initializeScriptVersion,
} from "../services/script-version-service";
import { requireWorkspaceActor } from "../services/workspace";

const idSchema = z.string().trim().min(1).max(120);

const initializeInputSchema = z
	.object({
		projectId: idSchema,
		sourceGenerationId: idSchema,
	})
	.strict();

const getCurrentInputSchema = z.object({ projectId: idSchema }).strict();

const autosaveInputSchema = z
	.object({
		scriptVersionId: idSchema,
		baseRevision: z.number().int().positive(),
		editableSnapshot: z.unknown(),
	})
	.strict();

function toScriptVersionOrpcError(error: unknown): never {
	if (!(error instanceof ScriptVersionError)) throw error;

	if (
		error.code === "SCRIPT_VERSION_CONFLICT" ||
		error.code === "SCRIPT_VERSION_DRAFT_ALREADY_EXISTS"
	) {
		throw new ORPCError("CONFLICT", {
			message: error.code,
			data: { code: error.code, ...error.metadata },
		});
	}
	if (
		error.code === "SCRIPT_VERSION_NOT_FOUND" ||
		error.code === "SCRIPT_GENERATION_NOT_FOUND"
	) {
		throw new ORPCError("NOT_FOUND", {
			message: error.code,
			data: { code: error.code },
		});
	}
	throw new ORPCError("BAD_REQUEST", {
		message: error.code,
		data: { code: error.code },
	});
}

export const scriptVersionRouter = {
	initialize: protectedProcedure
		.input(initializeInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await initializeScriptVersion(actor, input);
			} catch (error) {
				return toScriptVersionOrpcError(error);
			}
		}),
	getCurrent: protectedProcedure
		.input(getCurrentInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await getCurrentScriptVersion(actor, input.projectId);
			} catch (error) {
				return toScriptVersionOrpcError(error);
			}
		}),
	autosave: protectedProcedure
		.input(autosaveInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await autosaveScriptVersion(actor, input);
			} catch (error) {
				return toScriptVersionOrpcError(error);
			}
		}),
};
