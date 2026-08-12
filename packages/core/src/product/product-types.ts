import type { ProductStatus } from "./validation";

export type Product = {
	id: string;
	workspaceId: string;
	name: string;
	category: string | null;
	status: ProductStatus;
	thumbnailUrl: string | null;
	sourceUrl: string | null;
	affiliateUrl: string | null;
	priceAmount: number | null;
	currency: "VND";
	archivedAt: Date | null;
	createdByUserId: string;
	createdAt: Date;
	updatedAt: Date;
};

export type ProductProjectUsage = {
	referenceCount: number;
	activeProjectCount: number;
	projects: Array<{
		id: string;
		name: string;
		currentStepKey: string;
		archivedAt: Date | null;
	}>;
};
