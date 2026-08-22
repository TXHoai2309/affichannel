import { z } from "zod";

import { productNameSchema } from "../product/validation";
import { CONTENT_BRIEF_PLATFORMS } from "./project-types";

export const projectNameSchema = z
	.string()
	.trim()
	.min(1, "Tên dự án là bắt buộc.")
	.max(160, "Tên dự án tối đa 160 ký tự.");

const projectIdSchema = z.string().uuid("Project không hợp lệ.");
const productIdSchema = z.string().uuid("Sản phẩm không hợp lệ.");

export const projectContentBriefFieldsSchema = z.object({
	name: projectNameSchema,
	productId: productIdSchema,
	platform: z.enum(CONTENT_BRIEF_PLATFORMS),
	goal: z
		.string()
		.trim()
		.min(1, "Mục tiêu là bắt buộc.")
		.max(240, "Mục tiêu tối đa 240 ký tự."),
	durationSeconds: z
		.number()
		.int("Thời lượng phải là số nguyên.")
		.min(15, "Thời lượng tối thiểu là 15 giây.")
		.max(180, "Thời lượng tối đa là 180 giây."),
	angle: z
		.string()
		.trim()
		.min(1, "Góc tiếp cận là bắt buộc.")
		.max(240, "Góc tiếp cận tối đa 240 ký tự."),
	description: z
		.string()
		.trim()
		.max(2_000, "Mô tả tối đa 2000 ký tự.")
		.optional(),
});

export const createProjectInputSchema = projectContentBriefFieldsSchema;

export const updateProjectInputSchema = projectContentBriefFieldsSchema.extend({
	id: projectIdSchema,
});

export const projectIdInputSchema = z.object({
	id: projectIdSchema,
});

export function normalizeProjectName(name: string) {
	return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
}

export { productNameSchema };

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
