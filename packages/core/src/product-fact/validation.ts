import { z } from "zod";

import { optionalHttpUrl } from "../validation/url";
import {
	productFactSourceTypes,
	productFactStatuses,
	productFactTypes,
	productFactVerificationIntents,
} from "./types";

export const productFactTypeSchema = z.enum(productFactTypes);
export const productFactStatusSchema = z.enum(productFactStatuses);
export const productFactSourceTypeSchema = z.enum(productFactSourceTypes);
export const productFactVerificationIntentSchema = z.enum(
	productFactVerificationIntents,
);

export const isoDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải có định dạng YYYY-MM-DD.")
	.refine((value) => {
		const parts = value.split("-");
		const year = Number(parts[0]);
		const month = Number(parts[1]);
		const day = Number(parts[2]);
		const date = new Date(Date.UTC(year, month - 1, day));
		return (
			date.getUTCFullYear() === year &&
			date.getUTCMonth() === month - 1 &&
			date.getUTCDate() === day
		);
	}, "Ngày không hợp lệ.");

const nullableText = (maxLength: number) =>
	z
		.preprocess(
			(value) => (typeof value === "string" && !value.trim() ? null : value),
			z.string().trim().max(maxLength).nullable().optional(),
		)
		.transform((value) => value ?? null);

const nullableDate = z
	.preprocess(
		(value) => (typeof value === "string" && !value.trim() ? null : value),
		isoDateSchema.nullable().optional(),
	)
	.transform((value) => value ?? null);

const nullableSourceUrl = z
	.preprocess(
		(value) => (typeof value === "string" && !value.trim() ? undefined : value),
		optionalHttpUrl("URL nguồn"),
	)
	.transform((value) => value ?? null);

export const productFactFieldsSchema = z.object({
	content: z.string().trim().min(1, "Nội dung Fact là bắt buộc.").max(5_000),
	type: productFactTypeSchema.default("other"),
	status: productFactStatusSchema.default("draft"),
	sourceType: productFactSourceTypeSchema
		.nullable()
		.optional()
		.transform((value) => value ?? null),
	sourceLabel: nullableText(500),
	sourceUrl: nullableSourceUrl,
	confirmedAt: nullableDate,
	expiresAt: nullableDate,
	notes: nullableText(2_000),
});

export const createProductFactInputSchema = z.object({
	productId: z.string().uuid("Sản phẩm không hợp lệ."),
	data: productFactFieldsSchema,
});

export const updateProductFactInputSchema = z.object({
	id: z.string().uuid("Product Fact không hợp lệ."),
	expectedRevision: z.number().int().positive("Phiên bản Fact không hợp lệ."),
	data: productFactFieldsSchema,
	verificationIntent: productFactVerificationIntentSchema.default("preserve"),
});

export const deleteProductFactInputSchema = z.object({
	id: z.string().uuid("Product Fact không hợp lệ."),
	expectedRevision: z.number().int().positive("Phiên bản Fact không hợp lệ."),
});

export type DeleteProductFactInput = z.infer<
	typeof deleteProductFactInputSchema
>;

export const productFactIdInputSchema = z.object({
	id: z.string().uuid("Product Fact không hợp lệ."),
});

export const listProductFactInputSchema = z.object({
	productId: z.string().uuid("Sản phẩm không hợp lệ."),
	search: z.string().trim().max(160).optional(),
	type: productFactTypeSchema.optional(),
	status: productFactStatusSchema.optional(),
	limit: z.number().int().min(1).max(100).default(30),
	cursor: z.string().max(512).optional(),
});

export const listProductFactHistoryInputSchema = z.object({
	productId: z.string().uuid("Sản phẩm không hợp lệ."),
	factId: z.string().uuid("Product Fact không hợp lệ.").optional(),
	limit: z.number().int().min(1).max(100).default(50),
});

export type ProductFactFields = z.infer<typeof productFactFieldsSchema>;
export type CreateProductFactInput = z.infer<
	typeof createProductFactInputSchema
>;
export type UpdateProductFactInput = z.infer<
	typeof updateProductFactInputSchema
>;
export type ListProductFactInput = z.infer<typeof listProductFactInputSchema>;
