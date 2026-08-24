import type { AdaptiveWorkflowReadModel } from "@affichannel/core";
import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { AlertTriangle, Clock3, Info, RefreshCw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { getAdaptiveRouteGatePresentation } from "./adaptive-workflow-presentation";
import { getProjectStep, type ProjectStepKey } from "./project-steps";

export default function ProjectStepPage({
	projectId,
	stepKey,
	workflow,
	content,
}: {
	projectId: string;
	stepKey: ProjectStepKey;
	workflow?: AdaptiveWorkflowReadModel;
	content?: ReactNode;
}) {
	if (!workflow || stepKey === "product" || stepKey === "completed") {
		const legacyStep = getProjectStep(stepKey);
		if (!legacyStep) return null;
		return (
			<section className="space-y-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="space-y-2">
						<h1 className="font-semibold text-2xl tracking-tight">
							{legacyStep.label}
						</h1>
						<p className="max-w-2xl text-muted-foreground">
							{legacyStep.description}
						</p>
					</div>
					<Button
						variant="outline"
						nativeButton={false}
						render={<Link href={`/projects/${projectId}` as Route} />}
					>
						Tổng quan project
					</Button>
				</div>
				{content ?? (
					<div className="rounded-xl border border-dashed bg-card p-8">
						<p className="font-medium">Feature đang được phát triển</p>
						<p className="mt-2 max-w-xl text-muted-foreground text-sm">
							Nội dung của bước này sẽ được hoàn thiện trong slice tương ứng.
						</p>
					</div>
				)}
			</section>
		);
	}
	const gate = getAdaptiveRouteGatePresentation(workflow, stepKey, projectId);
	if (gate.mode === "content") return content ?? null;
	const Icon =
		gate.semantic === "coming_soon"
			? Clock3
			: gate.semantic === "stale"
				? RefreshCw
				: gate.semantic === "waiting"
					? Info
					: AlertTriangle;

	return (
		<section className="space-y-6">
			<Card className="overflow-hidden">
				<CardHeader className="flex flex-row items-start gap-3 space-y-0">
					<div className="rounded-full bg-muted p-2 text-foreground">
						<Icon className="size-5" aria-hidden="true" />
					</div>
					<div className="min-w-0 flex-1">
						<CardTitle className="text-xl">
							<h1>{gate.title}</h1>
						</CardTitle>
						<p className="mt-2 max-w-2xl text-muted-foreground text-sm">
							{gate.helperText}
						</p>
					</div>
					<Badge className="shrink-0" variant={gate.badgeVariant}>
						{gate.statusLabel}
					</Badge>
				</CardHeader>
				{gate.action ? (
					<CardContent className="flex justify-end border-t pt-4">
						<Button
							nativeButton={false}
							render={<Link href={gate.action.href as Route} />}
						>
							{gate.action.label}
						</Button>
					</CardContent>
				) : null}
			</Card>
			{gate.mode === "remediation" ? content : null}
		</section>
	);
}
