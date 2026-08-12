export type ProductServiceErrorCode =
	| "PRODUCT_NOT_FOUND"
	| "PRODUCT_IN_USE"
	| "PRODUCT_ALREADY_ARCHIVED"
	| "PRODUCT_NOT_ARCHIVED"
	| "INVALID_CURSOR";

export class ProductServiceError extends Error {
	constructor(
		public readonly code: ProductServiceErrorCode,
		public readonly metadata?: { projectCount?: number },
	) {
		super(code);
	}
}
