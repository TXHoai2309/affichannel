"use client";

import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@affichannel/ui/components/empty";
import { useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { orpc } from "@/utils/orpc";
import { getProjectEntryPresentation } from "../project-navigation/project-entry-presentation";

export function ProjectList() {
	const projects = useQuery(orpc.project.list.queryOptions());

	if (projects.isLoading) {
		return <div className="h-32 animate-pulse rounded-xl border bg-muted/30" />;
	}

	if (projects.isError) {
		return (
			<div className="rounded-xl border border-destructive/40 p-5 text-destructive text-sm">
				Không thể tải dự án. Hãy tải lại trang để thử lại.
			</div>
		);
	}

	if (!projects.data?.length) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>Chưa có dự án nào</EmptyTitle>
					<EmptyDescription>
						Tạo dự án đầu tiên để bắt đầu quy trình sản xuất affiliate.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button nativeButton={false} render={<Link href="/projects/new" />}>
						Tạo dự án
					</Button>
				</EmptyContent>
			</Empty>
		);
	}

	return (
		<div className="divide-y overflow-hidden rounded-xl border bg-card">
			{projects.data.map((project) => {
				const entry = getProjectEntryPresentation(
					project.id,
					project.workflowEntry,
				);

				return (
					<div
						className="flex flex-wrap items-center justify-between gap-4 p-5"
						key={project.id}
					>
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<Link
									className="font-medium hover:underline"
									href={entry.overviewHref}
								>
									{project.name}
								</Link>
								<Badge
									variant={
										entry.comingSoon
											? "secondary"
											: entry.needsAttention
												? "destructive"
												: "outline"
									}
								>
									{entry.nextLabel}: {entry.statusLabel}
								</Badge>
							</div>
							<p className="mt-1 text-muted-foreground text-sm">
								{project.product.name} · TikTok
							</p>
						</div>
						<Button
							nativeButton={false}
							render={<Link href={entry.continueHref as Route} />}
							variant="outline"
						>
							{entry.actionLabel}
						</Button>
					</div>
				);
			})}
		</div>
	);
}
