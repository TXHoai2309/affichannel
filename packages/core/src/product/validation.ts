import { z } from "zod";

export const productNameSchema = z
	.string()
	.trim()
	.min(1, "Tên sản phẩm là bắt buộc.")
	.max(160, "Tên sản phẩm tối đa 160 ký tự.");

export const createMinimalProductInputSchema = z.object({
	name: productNameSchema,
	category: z
		.string()
		.trim()
		.max(80)
		.optional()
		.transform((value) => value || undefined),
});

export type CreateMinimalProductInput = z.infer<
	typeof createMinimalProductInputSchema
>;
