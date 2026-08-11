import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import type { Route } from "next";
import Link from "next/link";

import {
	getProjectStep,
	getProjectStepStatusVariant,
	PROJECT_STEP_STATUS_LABELS,
	type ProjectStepKey,
} from "./project-steps";

export default function ProjectStepPage({
	projectId,
	stepKey,
}: {
	projectId: string;
	stepKey: ProjectStepKey;
}) {
	const step = getProjectStep(stepKey);

	if (!step) {
		return null;
	}

	return (
		<section className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<Badge variant={getProjectStepStatusVariant("current")}>
							{PROJECT_STEP_STATUS_LABELS.current}
						</Badge>
						<span className="text-muted-foreground text-sm">
							Bước {step.order}/7
						</span>
					</div>
					<h2 className="font-semibold text-2xl tracking-tight">
						{step.label}
					</h2>
					<p className="max-w-2xl text-muted-foreground">{step.description}</p>
				</div>
				<Button
					variant="outline"
					render={<Link href={`/projects/${projectId}` as Route} />}
				>
					Tổng quan project
				</Button>
			</div>

			<div className="rounded-xl border border-dashed bg-card p-8">
				<p className="font-medium">Feature đang được phát triển</p>
				<p className="mt-2 max-w-xl text-muted-foreground text-sm">
					US002 đã chuẩn bị route, context và trạng thái điều hướng. Logic
					nghiệp vụ của bước này sẽ được nối ở các slice Product, Content và
					Media tương ứng.
				</p>
			</div>
		</section>
	);
}
