import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { channelStrategyRouter } from "./channel-strategy";
import { compositionRouter } from "./composition";
import { contentCalendarRouter } from "./content-calendar";
import { dashboardRouter } from "./dashboard";
import { factLockRouter } from "./fact-lock";
import { mediaRouter } from "./media";
import { productRouter } from "./product";
import { productFactRouter } from "./product-fact";
import { projectRouter } from "./project";
import { quickImageRenderRouter } from "./quick-image-render";
import { scriptGenerationRouter } from "./script-generation";
import { scriptVersionRouter } from "./script-version";
import { settingsRouter } from "./settings";
import { voiceRouter } from "./voice";
import { voiceSegmentRouter } from "./voice-segment";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => {
		return "OK";
	}),
	privateData: protectedProcedure.handler(({ context }) => {
		return {
			message: "This is private",
			user: context.session?.user,
		};
	}),
	dashboard: dashboardRouter,
	composition: compositionRouter,
	contentCalendar: contentCalendarRouter,
	channelStrategy: channelStrategyRouter,
	factLock: factLockRouter,
	media: mediaRouter,
	product: productRouter,
	productFact: productFactRouter,
	project: projectRouter,
	quickImageRender: quickImageRenderRouter,
	scriptGeneration: scriptGenerationRouter,
	scriptVersion: scriptVersionRouter,
	settings: settingsRouter,
	voice: voiceRouter,
	voiceSegment: voiceSegmentRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
