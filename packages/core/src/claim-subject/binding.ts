import type { ProductClaimBindingState, ProductClaimState } from "./types";

export function resolveProductClaimBinding(input: {
	productClaimState: ProductClaimState;
	projectProductId: string | null;
}): ProductClaimBindingState {
	if (input.productClaimState === "NONE") return "NONE";
	if (input.productClaimState === "UNKNOWN") return "UNKNOWN";
	return input.projectProductId === null ? "UNBOUND" : "BOUND";
}
