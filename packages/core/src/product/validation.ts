import { z } from "zod";

export const productNameSchema = z
	.string()
	.trim()
	.min(1, "Tên sản phẩm là bắt buộc.")
	.max(160, "Tên sản phẩm tối đa 160 ký tự.");

export const productStatusSchema = z.enum(["active", "inactive"]);

const optionalText = (maxLength: number) =>
	z
		.string()
		.trim()
		.max(maxLength)
		.optional()
		.transform((value) => value || undefined);

const optionalUrl = (label: string, protocols: RegExp) =>
	z
		.string()
		.trim()
		.max(2_048, `${label} tối đa 2048 ký tự.`)
		.optional()
		.transform((value) => value || undefined)
		.refine(
			(value) => !value || protocols.test(value),
			`${label} có protocol không hợp lệ.`,
		);

const optionalHttpUrl = (label: string) => optionalUrl(label, /^https?:\/\//i);

const optionalHttpsUrl = (label: string) => optionalUrl(label, /^https:\/\//i);

export const productFieldsSchema = z.object({
	name: productNameSchema,
	category: optionalText(80),
	status: productStatusSchema.default("active"),
	thumbnailUrl: optionalHttpsUrl("Ảnh đại diện"),
	sourceUrl: optionalHttpUrl("Nguồn sản phẩm"),
	affiliateUrl: optionalHttpUrl("Link affiliate"),
	priceAmount: z
		.number()
		.int("Giá phải là số nguyên.")
		.min(0, "Giá không được âm.")
		.nullable()
		.optional()
		.transform((value) => value ?? null),
	currency: z.literal("VND").default("VND"),
});

export const createProductInputSchema = productFieldsSchema;
export const updateProductInputSchema = productFieldsSchema;

export const productIdInputSchema = z.object({
	id: z.string().uuid("Sản phẩm không hợp lệ."),
});

export const listMinimalProductInputSchema = z.object({
	selectableOnly: z.boolean().default(true),
});

export const listProductInputSchema = z.object({
	search: z.string().trim().max(160).optional(),
	category: z.string().trim().max(80).optional(),
	status: productStatusSchema.optional(),
	archiveScope: z
		.enum(["activeOnly", "archivedOnly", "all"])
		.default("activeOnly"),
	limit: z.number().int().min(1).max(100).default(50),
	cursor: z.string().max(512).optional(),
});

export const createMinimalProductInputSchema = z.object({
	name: productNameSchema,
	category: optionalText(80),
});

export type ProductStatus = z.infer<typeof productStatusSchema>;
export type CreateProductInput = z.infer<typeof createProductInputSchema>;
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;
export type ListProductInput = z.infer<typeof listProductInputSchema>;

export type CreateMinimalProductInput = z.infer<
	typeof createMinimalProductInputSchema
>;
