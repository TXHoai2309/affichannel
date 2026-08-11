import { createMinimalProductInputSchema } from "@affichannel/core/product/validation";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../index";
import { createMinimalProduct, listMinimalProducts } from "../services/product";
import { getWorkspaceActor } from "../services/workspace";

async function requireWorkspaceActor(userId: string) {
	const actor = await getWorkspaceActor(userId);

	if (!actor) {
		throw new ORPCError("FORBIDDEN", {
			message: "Your account does not belong to an AffiChannel workspace.",
		});
	}

	return actor;
}

export const productRouter = {
	listMinimal: protectedProcedure.handler(async ({ context }) => {
		const actor = await requireWorkspaceActor(context.session.user.id);
		return listMinimalProducts(actor);
	}),
	createMinimal: protectedProcedure
		.input(createMinimalProductInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			return createMinimalProduct(actor, input);
		}),
};
