import { Card, CardContent } from "@affichannel/ui/components/card";
import type { LucideIcon } from "lucide-react";

const TONE_STYLES = {
	blue: "bg-affi-blue-soft text-affi-blue",
	green: "bg-green-50 text-affi-green",
	orange: "bg-orange-50 text-affi-orange",
	purple: "bg-purple-50 text-affi-purple",
} as const;

export default function SummaryCard({
	label,
	value,
	detail,
	icon: Icon,
	tone,
}: {
	label: string;
	value: string | number;
	detail: string;
	icon: LucideIcon;
	tone: keyof typeof TONE_STYLES;
}) {
	return (
		<Card className="rounded-2xl border border-affi-blue-border/80 shadow-sm">
			<CardContent className="flex min-h-32 flex-col justify-between gap-4 px-5 py-4">
				<div className="flex items-center justify-between gap-3">
					<p className="font-medium text-muted-foreground text-sm">{label}</p>
					<span
						className={`flex size-9 items-center justify-center rounded-xl ${TONE_STYLES[tone]}`}
					>
						<Icon aria-hidden="true" className="size-4" />
					</span>
				</div>
				<div>
					<p className="font-semibold text-3xl tracking-tight">{value}</p>
					<p className="mt-1 text-muted-foreground text-xs">{detail}</p>
				</div>
			</CardContent>
		</Card>
	);
}
