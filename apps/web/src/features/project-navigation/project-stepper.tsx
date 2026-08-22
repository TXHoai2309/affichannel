"use client";

import type { FactLockGateResult } from "@affichannel/core";
import { Badge } from "@affichannel/ui/components/badge";
import { cn } from "@affichannel/ui/lib/utils";
import {
	Check,
	Circle,
	CircleAlert,
	CircleDot,
	CircleSlash2,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
	DEMO_PROJECT_STEP_STATUSES,
	getActiveProjectStepKey,
	getProjectStepDisplayStatus,
	getProjectStepReadinessLabel,
	getProjectStepStatus,
	getProjectStepStatusVariant,
	type PersistedProjectStepStatus,
	PROJECT_STEP_STATUS_LABELS,
	PROJECT_STEPS,
	type ProjectStepKey,
} from "./project-steps";

const STATUS_ICONS = {
	completed: Check,
	current: CircleDot,
	needs_review: CircleAlert,
	blocked: CircleSlash2,
	not_started: Circle,
} as const;

export default function ProjectStepper({
	projectId,
	currentStepKey = "fact-lock",
	persistedStatuses = DEMO_PROJECT_STEP_STATUSES,
	factLockGate = null,
	voiceReady,
}: {
	projectId: string;
	currentStepKey?: ProjectStepKey;
	persistedStatuses?: Record<ProjectStepKey, PersistedProjectStepStatus>;
	factLockGate?: FactLockGateResult | null;
	voiceReady?: boolean;
}) {
	const pathname = usePathname();
	const activeStepKey = getActiveProjectStepKey(pathname, projectId);

	return (
		<nav
			aria-label="Các bước project"
			className="rounded-xl border bg-card p-4"
		>
			<div className="mb-4 flex items-center justify-between gap-4">
				<div>
					<p className="font-medium">Project steps</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Trạng thái workflow được lưu theo từng dự án; route chỉ xác định
						bước bạn đang xem.
					</p>
				</div>
				<Badge variant="outline">7 bước</Badge>
			</div>
			<fieldset className="mb-4 flex flex-wrap gap-2 border-t pt-3">
				<legend className="sr-only">Chú giải trạng thái step</legend>
				{(
					[
						"completed",
						"current",
						"needs_review",
						"blocked",
						"not_started",
					] as const
				).map((status) => {
					const Icon = STATUS_ICONS[status];

					return (
						<Badge key={status} variant={getProjectStepStatusVariant(status)}>
							<Icon aria-hidden="true" className="size-3" />
							{PROJECT_STEP_STATUS_LABELS[status]}
						</Badge>
					);
				})}
			</fieldset>

			<ol className="grid gap-2 md:grid-cols-7">
				{PROJECT_STEPS.map((step) => {
					const workflowStatus = getProjectStepStatus(
						step.key,
						currentStepKey,
						persistedStatuses[step.key],
					);
					const status = getProjectStepDisplayStatus(
						step.key,
						workflowStatus,
						factLockGate,
						voiceReady,
					);
					const readinessLabel = getProjectStepReadinessLabel(
						step.key,
						factLockGate,
						voiceReady,
					);
					const Icon = STATUS_ICONS[status];
					const active = step.key === activeStepKey;

					return (
						<li key={step.key}>
							<Link
								aria-current={active ? "step" : undefined}
								className={cn(
									"flex min-h-20 flex-col justify-between rounded-lg border p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									active && "border-primary bg-primary/5",
								)}
								href={`/projects/${projectId}/${step.key}` as Route}
							>
								<span className="flex items-center justify-between gap-2">
									<span className="font-semibold text-muted-foreground text-xs">
										0{step.order}
									</span>
									<Icon
										aria-hidden="true"
										className={cn(
											"size-4",
											status === "completed" && "text-green-600",
											status === "blocked" && "text-destructive",
											status === "needs_review" && "text-amber-600",
										)}
									/>
								</span>
								<span className="mt-3 font-medium text-sm">{step.label}</span>
								<span className="mt-1 text-muted-foreground text-xs">
									{readinessLabel ?? PROJECT_STEP_STATUS_LABELS[status]}
								</span>
							</Link>
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
