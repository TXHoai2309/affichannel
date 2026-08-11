import type { DashboardWarning } from "@affichannel/core/dashboard/dashboard-types";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { CheckCircle2 } from "lucide-react";

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
								Fact Lock, job và dữ liệu chi phí sẽ xuất hiện khi các module
								tương ứng được kết nối.
							</p>
						</div>
					</div>
				) : (
					<ul className="space-y-3">
						{warnings.map((warning) => (
							<li className="rounded-xl border p-4" key={warning.id}>
								<p className="font-medium text-sm">{warning.title}</p>
								{warning.description ? (
									<p className="mt-1 text-muted-foreground text-xs">
										{warning.description}
									</p>
								) : null}
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
