"use client";

import type { AdaptiveWorkflowReadModel } from "@affichannel/core";
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
	type AdaptiveWorkflowSemantic,
	buildAdaptiveStepperItems,
} from "./adaptive-workflow-presentation";

const STATUS_ICONS = {
	waiting: Circle,
	progress: CircleDot,
	ready: CircleDot,
	complete: Check,
	blocked: CircleSlash2,
	stale: CircleAlert,
	coming_soon: Circle,
	attention: CircleAlert,
} as const satisfies Record<AdaptiveWorkflowSemantic, typeof Circle>;

export default function ProjectStepper({
	projectId,
	workflow,
}: {
	projectId: string;
	workflow: AdaptiveWorkflowReadModel;
}) {
	const pathname = usePathname();
	const items = buildAdaptiveStepperItems(workflow, pathname, projectId);

	return (
		<nav
			aria-label="Các bước project"
			className="rounded-xl border bg-card p-4"
		>
			<div className="mb-4 flex items-center justify-between gap-4">
				<div>
					<p className="font-medium">Các bước Project</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Workflow phản ánh trạng thái nội dung hiện tại; route chỉ xác định
						bước bạn đang xem.
					</p>
				</div>
				<Badge variant="outline">{items.length} bước</Badge>
			</div>

			{workflow.unsupportedState.isUnsupported ? (
				<div
					aria-live="polite"
					className="rounded-lg border border-destructive/20 bg-destructive/5 p-4"
					role="status"
				>
					<div className="flex items-center gap-2">
						<CircleAlert aria-hidden="true" className="size-4" />
						<p className="font-medium">Project cần được kiểm tra</p>
					</div>
					<p className="mt-1 text-muted-foreground text-xs">
						Workflow chưa thể xác định các bước một cách an toàn.
					</p>
				</div>
			) : (
				<ol className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
					{items.map(({ step, presentation, active, next, href }) => {
						const Icon = STATUS_ICONS[presentation.semantic];
						const content = (
							<>
								<span className="flex items-center justify-between gap-2">
									<span className="font-semibold text-muted-foreground text-xs">
										{String(step.visibleOrdinal).padStart(2, "0")}
									</span>
									<Badge variant={presentation.badgeVariant}>
										<Icon aria-hidden="true" className="size-3" />
										{presentation.statusLabel}
									</Badge>
								</span>
								<span className="mt-3 font-medium text-sm">
									{presentation.label}
								</span>
								<span className="mt-1 text-muted-foreground text-xs">
									{presentation.helperText}
								</span>
								{next ? (
									<span className="mt-2 font-medium text-primary text-xs">
										Bước tiếp theo
									</span>
								) : null}
							</>
						);

						return (
							<li key={step.capability}>
								{step.navigable && presentation.valid ? (
									<Link
										aria-current={active ? "step" : undefined}
										className={cn(
											"flex min-h-28 flex-col rounded-lg border p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
											next && !active && "border-primary/50",
											active && "border-primary bg-primary/5",
										)}
										data-next={next ? "true" : undefined}
										href={href as Route}
									>
										{content}
									</Link>
								) : (
									<div
										aria-disabled="true"
										className={cn(
											"flex min-h-28 flex-col rounded-lg border bg-muted/30 p-3",
											next && !active && "border-primary/50",
											active && "border-primary bg-primary/5",
										)}
										data-next={next ? "true" : undefined}
									>
										{content}
									</div>
								)}
							</li>
						);
					})}
				</ol>
			)}
		</nav>
	);
}
