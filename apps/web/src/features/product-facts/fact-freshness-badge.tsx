import type {
	FactAssessment,
	FactFreshnessStatus,
} from "@affichannel/core/product-fact/freshness";
import { Badge } from "@affichannel/ui/components/badge";

const FRESHNESS_LABELS: Record<FactFreshnessStatus, string> = {
	fresh: "Còn hiệu lực",
	needs_update: "Cần cập nhật",
	expired: "Hết hạn",
	unknown: "Chưa xác định",
	not_applicable: "Không áp dụng",
};

const FRESHNESS_VARIANTS: Record<
	FactFreshnessStatus,
	"success" | "warning" | "destructive" | "secondary" | "outline"
> = {
	fresh: "success",
	needs_update: "warning",
	expired: "destructive",
	unknown: "secondary",
	not_applicable: "outline",
};

export function FactFreshnessBadge({
	assessment,
}: {
	assessment: FactAssessment;
}) {
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<Badge variant={FRESHNESS_VARIANTS[assessment.freshness]}>
				{FRESHNESS_LABELS[assessment.freshness]}
			</Badge>
			{assessment.evidence === "missing" ? (
				<Badge variant="destructive">Thiếu nguồn xác thực</Badge>
			) : null}
		</div>
	);
}
