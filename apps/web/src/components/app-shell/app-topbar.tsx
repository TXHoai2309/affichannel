"use client";

import { Button } from "@affichannel/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

import { getAppRouteFromPathname } from "@/config/routes";
import { getProjectFixture } from "@/features/project-navigation/project-fixtures";
import { orpc } from "@/utils/orpc";

import UserMenu from "../user-menu";

function ProjectTitle({ projectId }: { projectId: string }) {
	const fixture = getProjectFixture(projectId);
	const projectQuery = useQuery(
		orpc.project.get.queryOptions({
			input: { id: projectId },
			enabled: !fixture,
		}),
	);

	return (
		<h1 className="truncate font-semibold text-base text-foreground tracking-tight">
			{fixture?.name ?? projectQuery.data?.name ?? "Dự án"}
		</h1>
	);
}

export default function AppTopbar() {
	const pathname = usePathname();
	const pageTitle = getAppRouteFromPathname(pathname)?.title ?? "Tổng quan";
	const [section, projectId] = pathname.split("/").filter(Boolean);
	const isProjectRoute =
		section === "projects" && projectId && projectId !== "new";

	return (
		<header className="mx-3 mt-3 flex min-h-14 items-center justify-between gap-4 rounded-[20px] border border-affi-blue-border bg-card px-5 py-2 shadow-sm lg:mx-5 lg:px-6">
			{isProjectRoute ? (
				<ProjectTitle projectId={projectId} />
			) : (
				<h1 className="truncate font-semibold text-base text-foreground tracking-tight">
					{pageTitle}
				</h1>
			)}
			<div className="flex items-center gap-2">
				<Button
					className="rounded-full text-muted-foreground hover:bg-affi-blue-soft hover:text-foreground"
					variant="ghost"
					size="icon"
					aria-label="Thông báo"
					onClick={() =>
						toast.info("Notification Center sẽ được nối ở slice sau.")
					}
				>
					<Bell aria-hidden="true" />
				</Button>

				<UserMenu />
			</div>
		</header>
	);
}
