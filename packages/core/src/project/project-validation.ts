import { z } from "zod";

import { productNameSchema } from "../product/validation";
import { CONTENT_BRIEF_PLATFORMS } from "./project-types";
import { projectWriteIdentityInputSchema } from "./project-write-contract";

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

const CHANNEL_FIRST_IDENTITY_FIELD_NAMES = [
	"contentType",
	"creationPath",
	"contentFormat",
] as const;

function rejectInactiveChannelFirstIdentity(
	value: unknown,
	ctx: z.RefinementCtx,
): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return value;
	}

	for (const fieldName of CHANNEL_FIRST_IDENTITY_FIELD_NAMES) {
		if (Object.hasOwn(value, fieldName)) {
			ctx.addIssue({
				code: "custom",
				path: [fieldName],
				message: "CHANNEL_FIRST_IDENTITY_NOT_ACTIVE",
			});
		}
	}
	return value;
}

/** Active M3 production contract; M3B owns identity activation. */
export const createProjectInputSchema = z.preprocess(
	rejectInactiveChannelFirstIdentity,
	projectContentBriefFieldsSchema,
);

export const updateProjectInputSchema = z.preprocess(
	rejectInactiveChannelFirstIdentity,
	projectContentBriefFieldsSchema.extend({ id: projectIdSchema }),
);

/** M3A-only contract; not used by the active production router before M3B. */
export const channelFirstCompatibleCreateProjectInputSchema =
	projectContentBriefFieldsSchema.extend(projectWriteIdentityInputSchema.shape);

export const channelFirstCompatibleUpdateProjectInputSchema =
	channelFirstCompatibleCreateProjectInputSchema.extend({
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
