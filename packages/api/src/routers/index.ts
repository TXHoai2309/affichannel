import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { dashboardRouter } from "./dashboard";
import { productRouter } from "./product";
import { productFactRouter } from "./product-fact";
import { projectRouter } from "./project";
import { scriptGenerationRouter } from "./script-generation";
import { settingsRouter } from "./settings";

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
	product: productRouter,
	productFact: productFactRouter,
	project: projectRouter,
	scriptGeneration: scriptGenerationRouter,
	settings: settingsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
