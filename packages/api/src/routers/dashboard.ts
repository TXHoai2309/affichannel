import { getDashboardOverview } from "@affichannel/core/dashboard/dashboard-service";

import { protectedProcedure } from "../index";
import { createDashboardRepository } from "../services/dashboard-repository";
import { requireWorkspaceActor } from "../services/workspace";

const repository = createDashboardRepository();

export const dashboardRouter = {
	getOverview: protectedProcedure.handler(async ({ context }) => {
		const actor = await requireWorkspaceActor(context.session.user.id);
		return getDashboardOverview(repository, actor);
	}),
};
