import type { AdaptiveWorkflowReadModel } from "@affichannel/core";
import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { ArrowRight, CircleAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { ProjectMediaPanel } from "@/features/media/project-media-panel";

import { getAdaptiveWorkflowOverviewPresentation } from "./adaptive-workflow-presentation";

type ProjectOverviewProps = {
	projectId: string;
	project: {
		name: string;
		productName: string;
		contentType?: "ORGANIC" | "AFFILIATE";
		brief: {
			platform: "tiktok";
			goal: string;
			durationSeconds: number;
			angle: string;
			description: string | null;
		};
	};
	workflow: AdaptiveWorkflowReadModel;
};

export default function ProjectOverview({
	projectId,
	project,
	workflow,
}: ProjectOverviewProps) {
	const next = getAdaptiveWorkflowOverviewPresentation(workflow, projectId);

	return (
		<section
			aria-labelledby="project-overview-title"
			className="flex flex-col gap-6"
		>
			<div className="flex flex-col gap-2">
				<Badge className="w-fit" variant="outline">
					Tổng quan project
				</Badge>
				<h1
					className="font-semibold text-2xl tracking-tight"
					id="project-overview-title"
				>
					{project.name}
				</h1>
				<p className="text-muted-foreground">
					Thông tin đầu vào và bước phù hợp tiếp theo của project.
				</p>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<Card className="rounded-2xl border border-affi-blue-border/80 shadow-sm">
					<CardHeader className="border-affi-blue-border/70 border-b">
						<CardTitle>Thông tin project</CardTitle>
					</CardHeader>
					<CardContent>
						<dl className="grid gap-4 sm:grid-cols-2">
							<OverviewField label="Sản phẩm" value={project.productName} />
							<OverviewField label="Nền tảng" value="TikTok" />
							<OverviewField
								label="Bước tiếp theo"
								value={next.nextStepLabel}
							/>
							<OverviewField
								label="Thời lượng"
								value={`${project.brief.durationSeconds} giây`}
							/>
						</dl>
					</CardContent>
					<CardFooter className="flex flex-wrap justify-between gap-3">
						<div className="flex min-w-0 items-center gap-2">
							{next.needsAttention ? (
								<CircleAlert aria-hidden="true" className="size-4 shrink-0" />
							) : null}
							<div className="min-w-0">
								<p className="font-medium text-xs">{next.statusLabel}</p>
								<p className="text-muted-foreground text-xs">
									{next.helperText}
								</p>
							</div>
						</div>
						{next.action ? (
							<Button
								nativeButton={false}
								render={<Link href={next.action.href as Route} />}
							>
								{next.action.label}
								<ArrowRight aria-hidden="true" data-icon="inline-end" />
							</Button>
						) : (
							<Badge
								variant={next.needsAttention ? "destructive" : "secondary"}
							>
								{next.statusLabel}
							</Badge>
						)}
					</CardFooter>
				</Card>

				<Card className="rounded-2xl border border-affi-blue-border/80 shadow-sm">
					<CardHeader className="border-affi-blue-border/70 border-b">
						<CardTitle>Content Brief</CardTitle>
						<CardDescription>
							Thông tin định hướng nội dung đã lưu cho Project.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<dl className="flex flex-col gap-4">
							<OverviewField label="Mục tiêu" value={project.brief.goal} />
							<OverviewField label="Góc tiếp cận" value={project.brief.angle} />
							{project.brief.description ? (
								<OverviewField
									label="Mô tả thêm"
									value={project.brief.description}
								/>
							) : null}
						</dl>
					</CardContent>
				</Card>
			</div>

			<ProjectMediaPanel
				contentType={project.contentType ?? "ORGANIC"}
				projectId={projectId}
			/>
		</section>
	);
}

function OverviewField({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className="font-medium text-muted-foreground text-xs">{label}</dt>
			<dd className="mt-1 font-medium text-sm">{value}</dd>
		</div>
	);
}
