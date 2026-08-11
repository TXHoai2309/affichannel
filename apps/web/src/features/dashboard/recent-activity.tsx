import type { DashboardActivity } from "@affichannel/core/dashboard/dashboard-types";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { PencilLine, Plus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

function formatRelativeTime(value: string) {
	const elapsedSeconds = Math.round(
		(new Date(value).getTime() - Date.now()) / 1_000,
	);
	const formatter = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });

	if (Math.abs(elapsedSeconds) < 60) {
		return formatter.format(elapsedSeconds, "second");
	}

	const elapsedMinutes = Math.round(elapsedSeconds / 60);
	if (Math.abs(elapsedMinutes) < 60) {
		return formatter.format(elapsedMinutes, "minute");
	}

	const elapsedHours = Math.round(elapsedMinutes / 60);
	if (Math.abs(elapsedHours) < 24) {
		return formatter.format(elapsedHours, "hour");
	}

	return formatter.format(Math.round(elapsedHours / 24), "day");
}

export default function RecentActivity({
	activities,
}: {
	activities: DashboardActivity[];
}) {
	return (
		<Card className="rounded-2xl border border-affi-blue-border/80 shadow-sm">
			<CardHeader className="border-affi-blue-border/70 border-b px-5 py-4">
				<CardTitle className="text-base">Hoạt động gần đây</CardTitle>
			</CardHeader>
			<CardContent className="p-5">
				{activities.length === 0 ? (
					<p className="rounded-xl bg-muted/60 p-4 text-muted-foreground text-sm">
						Chưa có hoạt động nào.
					</p>
				) : (
					<ul className="space-y-1">
						{activities.map((activity) => {
							const Icon =
								activity.type === "project_created" ? Plus : PencilLine;

							return (
								<li key={activity.id}>
									<Link
										className="group flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-affi-blue-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										href={activity.targetUrl as Route}
									>
										<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-affi-blue-soft text-affi-blue">
											<Icon aria-hidden="true" className="size-4" />
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium text-sm group-hover:text-affi-blue">
												{activity.title}
											</span>
											<span className="mt-1 block text-muted-foreground text-xs">
												{formatRelativeTime(activity.occurredAt)}
											</span>
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
