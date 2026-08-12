import { z } from "zod";

export const factDependentTypes = [
	"script",
	"fact_lock",
	"voice",
	"video",
	"render",
] as const;
export type FactDependentType = (typeof factDependentTypes)[number];

export const factInvalidationReasons = [
	"fact_changed",
	"fact_deactivated",
	"fact_deleted",
] as const;
export type FactInvalidationReason = (typeof factInvalidationReasons)[number];

export const factDependentTypeSchema = z.enum(factDependentTypes);

export const registerFactDependencyInputSchema = z.object({
	productFactId: z.string().uuid("Product Fact không hợp lệ."),
	dependentType: factDependentTypeSchema,
	dependentId: z.string().trim().min(1).max(200),
});

export const replaceFactDependenciesInputSchema = z.object({
	dependentType: factDependentTypeSchema,
	dependentId: z.string().trim().min(1).max(200),
	productFactIds: z.array(z.string().uuid()).max(200),
});

export type RegisterFactDependencyInput = z.infer<
	typeof registerFactDependencyInputSchema
>;
export type ReplaceFactDependenciesInput = z.infer<
	typeof replaceFactDependenciesInputSchema
>;

export type FactDependencyRecord = {
	id: string;
	workspaceId: string;
	productFactId: string;
	factRevision: number;
	dependentType: FactDependentType;
	dependentId: string;
	createdAt: Date | string;
	detachedAt: Date | string | null;
	invalidatedAt: Date | string | null;
	invalidationReason: FactInvalidationReason | null;
};

export type FactInvalidationEventRecord = {
	id: string;
	dependencyId: string;
	workspaceId: string;
	productFactId: string;
	fromRevision: number;
	toRevision: number | null;
	dependentType: FactDependentType;
	dependentId: string;
	reason: FactInvalidationReason;
	triggeredByUserId: string | null;
	createdAt: Date | string;
};
