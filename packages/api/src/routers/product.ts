import { ProductServiceError } from "@affichannel/core/product/product-errors";
import {
	createMinimalProductInputSchema,
	createProductInputSchema,
	listMinimalProductInputSchema,
	listProductInputSchema,
	productIdInputSchema,
	updateProductInputSchema,
} from "@affichannel/core/product/validation";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../index";
import {
	archiveProduct,
	createMinimalProduct,
	createProduct,
	deleteProduct,
	getProduct,
	listMinimalProducts,
	listProducts,
	restoreProduct,
	updateProduct,
} from "../services/product-service";
import { requireWorkspaceActor } from "../services/workspace";

function toProductOrpcError(error: unknown): never {
	if (!(error instanceof ProductServiceError)) {
		throw error;
	}

	if (error.code === "PRODUCT_IN_USE") {
		throw new ORPCError("CONFLICT", {
			message: "PRODUCT_IN_USE",
			data: {
				code: error.code,
				projectCount: error.metadata?.projectCount ?? 0,
			},
		});
	}

	if (error.code === "INVALID_CURSOR") {
		throw new ORPCError("BAD_REQUEST", {
			message: "INVALID_CURSOR",
			data: { code: error.code },
		});
	}

	throw new ORPCError("NOT_FOUND", {
		message: error.code,
		data: { code: error.code },
	});
}

export const productRouter = {
	listMinimal: protectedProcedure
		.input(listMinimalProductInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			return listMinimalProducts(actor, input);
		}),
	createMinimal: protectedProcedure
		.input(createMinimalProductInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			return createMinimalProduct(actor, input);
		}),
	list: protectedProcedure
		.input(listProductInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await listProducts(actor, input);
			} catch (error) {
				return toProductOrpcError(error);
			}
		}),
	get: protectedProcedure
		.input(productIdInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await getProduct(actor, input.id);
			} catch (error) {
				return toProductOrpcError(error);
			}
		}),
	create: protectedProcedure
		.input(createProductInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await createProduct(actor, input);
			} catch (error) {
				return toProductOrpcError(error);
			}
		}),
	update: protectedProcedure
		.input(productIdInputSchema.extend({ data: updateProductInputSchema }))
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await updateProduct(actor, input.id, input.data);
			} catch (error) {
				return toProductOrpcError(error);
			}
		}),
	archive: protectedProcedure
		.input(productIdInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await archiveProduct(actor, input.id);
			} catch (error) {
				return toProductOrpcError(error);
			}
		}),
	restore: protectedProcedure
		.input(productIdInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await restoreProduct(actor, input.id);
			} catch (error) {
				return toProductOrpcError(error);
			}
		}),
	delete: protectedProcedure
		.input(productIdInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await deleteProduct(actor, input.id);
			} catch (error) {
				return toProductOrpcError(error);
			}
		}),
};
