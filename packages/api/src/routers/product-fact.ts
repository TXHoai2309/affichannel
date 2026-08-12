import { ProductFactServiceError } from "@affichannel/core/product-fact/errors";
import {
	createProductFactInputSchema,
	listProductFactHistoryInputSchema,
	listProductFactInputSchema,
	productFactIdInputSchema,
	updateProductFactInputSchema,
} from "@affichannel/core/product-fact/validation";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../index";
import {
	createProductFact,
	deleteProductFact,
	getProductFact,
	listProductFactHistory,
	listProductFacts,
	updateProductFact,
} from "../services/product-fact-service";
import { requireWorkspaceActor } from "../services/workspace";

function toProductFactOrpcError(error: unknown): never {
	if (!(error instanceof ProductFactServiceError)) {
		throw error;
	}

	if (
		error.code === "INVALID_CURSOR" ||
		error.code === "FACT_EVIDENCE_REQUIRED" ||
		error.code === "FACT_INVALID_DATE_RANGE"
	) {
		throw new ORPCError("BAD_REQUEST", {
			message: error.code,
			data: { code: error.code },
		});
	}

	throw new ORPCError("NOT_FOUND", {
		message: error.code,
		data: { code: error.code },
	});
}

export const productFactRouter = {
	list: protectedProcedure
		.input(listProductFactInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await listProductFacts(actor, input);
			} catch (error) {
				return toProductFactOrpcError(error);
			}
		}),
	get: protectedProcedure
		.input(productFactIdInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await getProductFact(actor, input.id);
			} catch (error) {
				return toProductFactOrpcError(error);
			}
		}),
	create: protectedProcedure
		.input(createProductFactInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await createProductFact(actor, input);
			} catch (error) {
				return toProductFactOrpcError(error);
			}
		}),
	update: protectedProcedure
		.input(updateProductFactInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await updateProductFact(actor, input);
			} catch (error) {
				return toProductFactOrpcError(error);
			}
		}),
	delete: protectedProcedure
		.input(productFactIdInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await deleteProductFact(actor, input.id);
			} catch (error) {
				return toProductFactOrpcError(error);
			}
		}),
	listHistory: protectedProcedure
		.input(listProductFactHistoryInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await listProductFactHistory(actor, input);
			} catch (error) {
				return toProductFactOrpcError(error);
			}
		}),
};
