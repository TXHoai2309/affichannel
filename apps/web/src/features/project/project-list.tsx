"use client";

import { getProjectStepRoute } from "@affichannel/core/project/project-types";
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
import {
	getProjectStep,
	PROJECT_STEP_STATUS_LABELS,
} from "../project-navigation/project-steps";

export function ProjectList() {
	const projects = useQuery(orpc.project.list.queryOptions());

	if (projects.isLoading) {
		return <div className="h-32 animate-pulse border bg-muted/30" />;
	}

	if (projects.isError) {
		return (
			<div className="border border-destructive/40 p-5 text-destructive text-sm">
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
		<div className="divide-y border bg-card">
			{projects.data.map((project) => {
				const currentStep = getProjectStep(project.currentStepKey);

				return (
					<div
						className="flex flex-wrap items-center justify-between gap-4 p-5"
						key={project.id}
					>
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<p className="font-medium">{project.name}</p>
								<Badge variant="outline">
									{PROJECT_STEP_STATUS_LABELS.current}: {currentStep?.label}
								</Badge>
							</div>
							<p className="mt-1 text-muted-foreground text-sm">
								{project.product.name} · TikTok
							</p>
						</div>
						<Button
							nativeButton={false}
							render={
								<Link
									href={
										getProjectStepRoute(
											project.id,
											project.currentStepKey,
										) as Route
									}
								/>
							}
							variant="outline"
						>
							Mở dự án
						</Button>
					</div>
				);
			})}
		</div>
	);
}
