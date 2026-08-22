export const productFactTypes = [
	"price",
	"promotion",
	"specification",
	"feature",
	"claim",
	"policy",
	"other",
] as const;

export type ProductFactType = (typeof productFactTypes)[number];

export const productFactStatuses = ["draft", "verified", "inactive"] as const;
export type ProductFactStatus = (typeof productFactStatuses)[number];

export const productFactVerificationIntents = ["preserve", "verify"] as const;
export type ProductFactVerificationIntent =
	(typeof productFactVerificationIntents)[number];

export const productFactSourceTypes = [
	"official",
	"marketplace",
	"document",
] as const;
export type ProductFactSourceType = (typeof productFactSourceTypes)[number];

export const productFactHistoryActions = [
	"created",
	"updated",
	"status_changed",
	"deleted",
] as const;
export type ProductFactHistoryAction =
	(typeof productFactHistoryActions)[number];

export type ProductFactRecord = {
	id: string;
	workspaceId: string;
	productId: string;
	revision: number;
	content: string;
	type: ProductFactType;
	status: ProductFactStatus;
	sourceType: ProductFactSourceType | null;
	sourceLabel: string | null;
	sourceUrl: string | null;
	confirmedAt: string | null;
	expiresAt: string | null;
	notes: string | null;
	createdByUserId: string;
	updatedByUserId: string;
	createdAt: Date | string;
	updatedAt: Date | string;
};

export type ProductFactHistoryRecord = {
	id: string;
	productFactId: string;
	productId: string;
	workspaceId: string;
	revision: number;
	action: ProductFactHistoryAction;
	content: string;
	type: ProductFactType;
	status: ProductFactStatus;
	sourceType: ProductFactSourceType | null;
	sourceLabel: string | null;
	sourceUrl: string | null;
	confirmedAt: string | null;
	expiresAt: string | null;
	notes: string | null;
	changedByUserId: string;
	changedAt: Date | string;
};
