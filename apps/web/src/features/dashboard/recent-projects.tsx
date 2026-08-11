import type {
	DashboardProjectStatus,
	DashboardRecentProject,
} from "@affichannel/core/dashboard/dashboard-types";
import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { ArrowRight, FolderPlus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getProjectStep } from "@/features/project-navigation/project-steps";
import { formatRelativeTime } from "./format-relative-time";

const STATUS_LABELS: Record<DashboardProjectStatus, string> = {
	in_progress: "Đang làm",
	completed: "Hoàn thành",
	needs_review: "Cần xem lại",
	blocked: "Bị chặn",
};

const STATUS_VARIANTS: Record<
	DashboardProjectStatus,
	"default" | "success" | "warning" | "destructive"
> = {
	in_progress: "default",
	completed: "success",
	needs_review: "warning",
	blocked: "destructive",
};

function ProjectRow({ project }: { project: DashboardRecentProject }) {
	const stepLabel =
		getProjectStep(project.currentStepKey)?.label ?? "Chưa xác định";

	return (
		<Link
			aria-label={`Mở dự án ${project.name}`}
			className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 border-affi-blue-border/60 border-t px-5 py-4 transition-colors hover:bg-affi-blue-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:grid-cols-[minmax(0,1.5fr)_minmax(8rem,1fr)_minmax(7rem,0.8fr)_minmax(8rem,1fr)_auto] md:gap-4"
			href={project.targetUrl as Route}
		>
			<div className="min-w-0">
				<p className="truncate font-medium text-sm group-hover:text-affi-blue">
					{project.name}
				</p>
				<p className="mt-1 truncate text-muted-foreground text-xs">
					{project.productName}
				</p>
			</div>
			<div className="justify-self-end md:justify-self-start">
				<Badge variant={STATUS_VARIANTS[project.status]}>
					{STATUS_LABELS[project.status]}
				</Badge>
			</div>
			<div className="col-span-2 flex items-center gap-2 text-muted-foreground text-xs md:col-span-1">
				<span className="truncate">{stepLabel}</span>
			</div>
			<div className="col-span-2 flex items-center gap-3 md:col-span-1">
				<div
					aria-label={`Tiến trình ${project.progressPercent}%`}
					aria-valuemax={100}
					aria-valuemin={0}
					aria-valuenow={project.progressPercent}
					className="h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-affi-blue-soft"
					role="progressbar"
				>
					<div
						className="h-full rounded-full bg-affi-blue transition-[width]"
						style={{ width: `${project.progressPercent}%` }}
					/>
				</div>
				<span className="w-9 text-right font-medium text-xs">
					{project.progressPercent}%
				</span>
			</div>
			<div className="col-start-2 row-start-3 justify-self-end text-muted-foreground text-xs md:col-start-auto md:row-start-auto md:justify-self-start">
				{formatRelativeTime(project.updatedAt)}
			</div>
		</Link>
	);
}

export default function RecentProjects({
	projects,
}: {
	projects: DashboardRecentProject[];
}) {
	return (
		<Card className="rounded-2xl border border-affi-blue-border/80 shadow-sm">
			<CardHeader className="border-affi-blue-border/70 border-b px-5 py-4">
				<div>
					<CardTitle className="text-base">Dự án gần đây</CardTitle>
					<p className="mt-1 text-muted-foreground text-xs">
						Mở dự án để tiếp tục tại bước đang làm.
					</p>
				</div>
				<CardAction>
					<Button
						nativeButton={false}
						render={<Link href="/projects/new" />}
						size="sm"
						variant="outline"
					>
						<FolderPlus aria-hidden="true" />
						<span className="hidden sm:inline">Tạo dự án</span>
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="p-0">
				{projects.length === 0 ? (
					<div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
						<span className="flex size-11 items-center justify-center rounded-xl bg-affi-blue-soft text-affi-blue">
							<FolderPlus aria-hidden="true" className="size-5" />
						</span>
						<div>
							<p className="font-medium text-sm">Chưa có dự án nào</p>
							<p className="mt-1 text-muted-foreground text-sm">
								Tạo dự án đầu tiên để bắt đầu xây nội dung affiliate.
							</p>
						</div>
						<Button nativeButton={false} render={<Link href="/projects/new" />}>
							Tạo dự án
							<ArrowRight aria-hidden="true" />
						</Button>
					</div>
				) : (
					<div>
						<div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(8rem,1fr)_minmax(7rem,0.8fr)_minmax(8rem,1fr)_auto] gap-4 px-5 py-3 text-muted-foreground text-xs md:grid">
							<span>Dự án / Sản phẩm</span>
							<span>Trạng thái</span>
							<span>Bước hiện tại</span>
							<span>Tiến trình</span>
							<span>Cập nhật</span>
						</div>
						{projects.map((project) => (
							<ProjectRow key={project.id} project={project} />
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
