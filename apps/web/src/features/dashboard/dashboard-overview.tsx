"use client";

import { useQuery } from "@tanstack/react-query";
import {
	CircleDollarSign,
	Clapperboard,
	FolderKanban,
	LoaderCircle,
} from "lucide-react";

import { orpc } from "@/utils/orpc";

import DashboardError from "./dashboard-error";
import DashboardLoading from "./dashboard-loading";
import DashboardWarnings from "./dashboard-warnings";
import RecentActivity from "./recent-activity";
import RecentProjects from "./recent-projects";
import SummaryCard from "./summary-card";

const VND_FORMATTER = new Intl.NumberFormat("vi-VN", {
	style: "currency",
	currency: "VND",
	maximumFractionDigits: 0,
});

export default function DashboardOverview() {
	const overviewQuery = useQuery(
		orpc.dashboard.getOverview.queryOptions({
			staleTime: 30_000,
		}),
	);

	if (overviewQuery.isPending) {
		return <DashboardLoading />;
	}

	if (overviewQuery.isError || !overviewQuery.data) {
		return <DashboardError onRetry={() => void overviewQuery.refetch()} />;
	}

	const { summary, cost } = overviewQuery.data;

	return (
		<div className="space-y-6">
			<section aria-labelledby="dashboard-summary-title" className="space-y-1">
				<h2 className="font-semibold text-lg" id="dashboard-summary-title">
					Tổng quan nhanh
				</h2>
				<p className="text-muted-foreground text-sm">
					Theo dõi project và bước sản xuất affiliate từ một nơi.
				</p>
			</section>

			<section
				aria-label="Chỉ số Dashboard"
				className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
			>
				<SummaryCard
					detail="Project chưa hoàn thành"
					icon={FolderKanban}
					label="Dự án đang làm"
					tone="blue"
					value={summary.activeProjects}
				/>
				<SummaryCard
					detail="Video module chưa kết nối"
					icon={Clapperboard}
					label="Video hoàn thành"
					tone="purple"
					value={summary.completedVideos}
				/>
				<SummaryCard
					detail="Usage chưa có dữ liệu"
					icon={CircleDollarSign}
					label="Chi phí tháng"
					tone="orange"
					value={VND_FORMATTER.format(cost.currentMonth)}
				/>
				<SummaryCard
					detail="Job backend chưa kết nối"
					icon={LoaderCircle}
					label="Job đang xử lý"
					tone="green"
					value={summary.processingJobs}
				/>
			</section>

			<RecentProjects projects={overviewQuery.data.recentProjects} />

			<section className="grid gap-5 xl:grid-cols-2">
				<RecentActivity activities={overviewQuery.data.recentActivities} />
				<DashboardWarnings warnings={overviewQuery.data.warnings} />
			</section>
		</div>
	);
}
