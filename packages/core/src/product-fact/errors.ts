export type ProductFactServiceErrorCode =
	| "FACT_NOT_FOUND"
	| "PRODUCT_NOT_FOUND"
	| "INVALID_CURSOR"
	| "FACT_EVIDENCE_REQUIRED"
	| "FACT_INVALID_DATE_RANGE"
	| "FACT_CONCURRENT_MODIFICATION"
	| "FACT_DEPENDENCY_NOT_FOUND";

export class ProductFactServiceError extends Error {
	constructor(public readonly code: ProductFactServiceErrorCode) {
		super(code);
		this.name = "ProductFactServiceError";
	}
}
