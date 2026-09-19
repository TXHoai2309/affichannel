import { channelStrategySaveInputSchema } from "@affichannel/core";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../index";
import {
	ChannelStrategyError,
	getCurrentChannelStrategy,
	saveCurrentChannelStrategy,
} from "../services/channel-strategy-repository";
import { requireWorkspaceActor } from "../services/workspace";

function toOrpcError(error: unknown): never {
	if (!(error instanceof ChannelStrategyError)) throw error;
	if (error.code === "CHANNEL_STRATEGY_NOT_FOUND") {
		throw new ORPCError("NOT_FOUND", {
			message: error.code,
			data: { code: error.code },
		});
	}
	throw new ORPCError("CONFLICT", {
		message: error.code,
		data: { code: error.code },
	});
}

export const channelStrategyRouter = {
	getCurrent: protectedProcedure.handler(async ({ context }) => {
		const actor = await requireWorkspaceActor(context.session.user.id);
		return getCurrentChannelStrategy(actor);
	}),
	save: protectedProcedure
		.input(channelStrategySaveInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await saveCurrentChannelStrategy(actor, input);
			} catch (error) {
				return toOrpcError(error);
			}
		}),
};
