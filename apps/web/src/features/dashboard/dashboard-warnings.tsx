import type { DashboardWarning } from "@affichannel/core/dashboard/dashboard-types";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { cn } from "@affichannel/ui/lib/utils";
import { AlertTriangle, ArrowUpRight, CheckCircle2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

const SEVERITY_STYLES = {
	warning: {
		Icon: AlertTriangle,
		container: "border-amber-200 bg-amber-50/70 hover:bg-amber-50",
		iconClass: "text-amber-600",
	},
	danger: {
		Icon: AlertTriangle,
		container: "border-red-200 bg-red-50/70 hover:bg-red-50",
		iconClass: "text-red-600",
	},
} as const;

function WarningLink({ warning }: { warning: DashboardWarning }) {
	const severityStyle = SEVERITY_STYLES[warning.severity];
	const Icon = severityStyle.Icon;

	return (
		<Link
			aria-label={`Xử lý cảnh báo: ${warning.title}`}
			className={cn(
				"group flex items-start gap-3 rounded-xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				severityStyle.container,
			)}
			href={warning.targetUrl as Route}
		>
			<span
				className={cn(
					"mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-background/70",
					severityStyle.iconClass,
				)}
			>
				<Icon aria-hidden="true" className="size-4" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="flex items-start justify-between gap-3">
					<span className="font-medium text-sm group-hover:underline">
						{warning.title}
					</span>
					<ArrowUpRight
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
					/>
				</span>
				{warning.description ? (
					<span className="mt-1 block text-muted-foreground text-xs">
						{warning.description}
					</span>
				) : null}
			</span>
		</Link>
	);
}

export default function DashboardWarnings({
	warnings,
}: {
	warnings: DashboardWarning[];
}) {
	return (
		<Card className="rounded-2xl border border-affi-blue-border/80 shadow-sm">
			<CardHeader className="border-affi-blue-border/70 border-b px-5 py-4">
				<CardTitle className="text-base">Cảnh báo</CardTitle>
			</CardHeader>
			<CardContent className="p-5">
				{warnings.length === 0 ? (
					<div className="flex items-start gap-3 rounded-xl bg-green-50/80 p-4 text-green-800">
						<CheckCircle2
							aria-hidden="true"
							className="mt-0.5 size-5 shrink-0"
						/>
						<div>
							<p className="font-medium text-sm">Không có cảnh báo cần xử lý</p>
							<p className="mt-1 text-green-700 text-xs">
								Cảnh báo về nội dung, tác vụ và chi phí sẽ xuất hiện khi có dữ
								liệu cần xử lý.
							</p>
						</div>
					</div>
				) : (
					<ul className="flex flex-col gap-3">
						{warnings.map((warning) => (
							<li key={warning.id}>
								<WarningLink warning={warning} />
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
