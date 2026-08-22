import {
	aiSettingsSchema,
	channelSettingsSchema,
	outputRulesSchema,
} from "@affichannel/core";

import { protectedProcedure } from "../index";
import {
	getAiSettings,
	upsertAiSettings,
} from "../services/ai-settings-service";
import {
	getChannelSettings,
	upsertChannelSettings,
} from "../services/channel-settings-service";
import {
	getOutputRules,
	upsertOutputRules,
} from "../services/output-rules-service";
import { requireWorkspaceActor } from "../services/workspace";

export const settingsRouter = {
	channel: {
		get: protectedProcedure.handler(async ({ context }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			return getChannelSettings(actor);
		}),
		update: protectedProcedure
			.input(channelSettingsSchema)
			.handler(async ({ context, input }) => {
				const actor = await requireWorkspaceActor(context.session.user.id);
				return upsertChannelSettings(actor, input);
			}),
	},
	ai: {
		get: protectedProcedure.handler(async ({ context }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			return getAiSettings(actor);
		}),
		update: protectedProcedure
			.input(aiSettingsSchema)
			.handler(async ({ context, input }) => {
				const actor = await requireWorkspaceActor(context.session.user.id);
				return upsertAiSettings(actor, input);
			}),
	},
	output: {
		get: protectedProcedure.handler(async ({ context }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			return getOutputRules(actor);
		}),
		update: protectedProcedure
			.input(outputRulesSchema)
			.handler(async ({ context, input }) => {
				const actor = await requireWorkspaceActor(context.session.user.id);
				return upsertOutputRules(actor, input);
			}),
	},
};
