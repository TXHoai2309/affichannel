import type { ProductFactStatus } from "@affichannel/core/product-fact/types";
import { Badge } from "@affichannel/ui/components/badge";

import { FACT_STATUS_LABELS } from "./fact-types";

const STATUS_VARIANTS: Record<
	ProductFactStatus,
	"default" | "secondary" | "outline"
> = {
	draft: "secondary",
	verified: "default",
	inactive: "outline",
};

export function FactStatusBadge({ status }: { status: ProductFactStatus }) {
	return (
		<Badge variant={STATUS_VARIANTS[status]}>
			{FACT_STATUS_LABELS[status]}
		</Badge>
	);
}
