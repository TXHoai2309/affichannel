import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { dashboardRouter } from "./dashboard";
import { factLockRouter } from "./fact-lock";
import { productRouter } from "./product";
import { productFactRouter } from "./product-fact";
import { projectRouter } from "./project";
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
	factLock: factLockRouter,
	product: productRouter,
	productFact: productFactRouter,
	project: projectRouter,
	scriptGeneration: scriptGenerationRouter,
	scriptVersion: scriptVersionRouter,
	settings: settingsRouter,
	voice: voiceRouter,
	voiceSegment: voiceSegmentRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
