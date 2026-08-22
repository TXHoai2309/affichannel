import { FactLockError, VoiceConfigError } from "@affichannel/core";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
	getVoiceConfig,
	listServerVoicePresets,
	saveVoiceConfig,
} from "../services/voice-config-service";
import { requireWorkspaceActor } from "../services/workspace";

const idSchema = z.string().trim().min(1).max(120);

const projectInputSchema = z.object({ projectId: idSchema }).strict();

const saveInputSchema = z
	.object({
		projectId: idSchema,
		baseRevision: z.number().int().positive().nullable(),
		voiceId: idSchema,
		language: z.string().trim().min(2).max(20),
		speed: z.number().finite(),
	})
	.strict();

function toVoiceOrpcError(error: unknown): never {
	if (error instanceof FactLockError) {
		if (error.code === "FACT_LOCK_NOT_FOUND") {
			throw new ORPCError("NOT_FOUND", {
				message: error.code,
				data: { code: error.code },
			});
		}
		throw new ORPCError("CONFLICT", {
			message: error.code,
			data: { code: error.code, ...error.metadata },
		});
	}
	if (!(error instanceof VoiceConfigError)) throw error;
	if (error.code === "VOICE_CONFIG_NOT_FOUND") {
		throw new ORPCError("NOT_FOUND", {
			message: error.code,
			data: { code: error.code },
		});
	}
	if (error.code === "VOICE_CONFIG_CONFLICT") {
		throw new ORPCError("CONFLICT", {
			message: error.code,
			data: { code: error.code, ...error.metadata },
		});
	}
	throw new ORPCError("BAD_REQUEST", {
		message: error.code,
		data: { code: error.code },
	});
}

export const voiceRouter = {
	listPresets: protectedProcedure.handler(async ({ context }) => {
		await requireWorkspaceActor(context.session.user.id);
		return listServerVoicePresets();
	}),
	getConfig: protectedProcedure
		.input(projectInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await getVoiceConfig(actor, input.projectId);
			} catch (error) {
				return toVoiceOrpcError(error);
			}
		}),
	saveConfig: protectedProcedure
		.input(saveInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await saveVoiceConfig(actor, input);
			} catch (error) {
				return toVoiceOrpcError(error);
			}
		}),
};
