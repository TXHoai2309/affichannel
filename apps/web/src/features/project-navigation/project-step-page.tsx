import type { FactLockGateResult } from "@affichannel/core";
import { Button } from "@affichannel/ui/components/button";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import FactLockGatePanel from "@/features/fact-lock/fact-lock-gate-panel";
import { getProjectStep, type ProjectStepKey } from "./project-steps";
import VoiceStepGatePanel from "./voice-step-gate-panel";

export default function ProjectStepPage({
	projectId,
	stepKey,
	gate = null,
	content,
	voiceReady,
	voiceSummary,
}: {
	projectId: string;
	stepKey: ProjectStepKey;
	gate?: FactLockGateResult | null;
	content?: ReactNode;
	voiceReady?: boolean;
	voiceSummary?: {
		completedSegments: number;
		totalSegments: number;
	};
}) {
	const step = getProjectStep(stepKey);
	const voiceGateBlocked =
		stepKey === "video" && gate?.allowed === true && voiceReady === false;

	if (!step) {
		return null;
	}

	return (
		<section className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="space-y-2">
					<span className="text-muted-foreground text-sm">
						Bước {step.order}/7
					</span>
					<h2 className="font-semibold text-2xl tracking-tight">
						{step.label}
					</h2>
					<p className="max-w-2xl text-muted-foreground">{step.description}</p>
				</div>
				<Button
					variant="outline"
					nativeButton={false}
					render={<Link href={`/projects/${projectId}` as Route} />}
				>
					Tổng quan project
				</Button>
			</div>

			{gate && (
				<FactLockGatePanel
					gate={gate}
					projectId={projectId}
					stepLabel={step.label}
				/>
			)}

			{voiceGateBlocked ? (
				<VoiceStepGatePanel
					completedSegments={voiceSummary?.completedSegments ?? 0}
					projectId={projectId}
					totalSegments={voiceSummary?.totalSegments ?? 0}
				/>
			) : null}

			{(gate && !gate.allowed) || voiceGateBlocked
				? null
				: (content ?? (
						<div className="rounded-xl border border-dashed bg-card p-8">
							<p className="font-medium">Feature đang được phát triển</p>
							<p className="mt-2 max-w-xl text-muted-foreground text-sm">
								US004 đã lưu dự án, content brief và workflow. Logic nghiệp vụ
								của từng bước sẽ được nối ở các slice Product, Content và Media
								tương ứng.
							</p>
						</div>
					))}
		</section>
	);
}
