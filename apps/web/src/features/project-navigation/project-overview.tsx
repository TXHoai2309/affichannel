import { Badge } from "@affichannel/ui/components/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";

import { getProjectStep, type ProjectStepKey } from "./project-steps";

type ProjectOverviewProps = {
	project: {
		name: string;
		productName: string;
		currentStepKey: ProjectStepKey;
		brief: {
			platform: "tiktok";
			goal: string;
			durationSeconds: number;
			angle: string;
			description: string | null;
		};
	};
};

export default function ProjectOverview({ project }: ProjectOverviewProps) {
	const currentStep = getProjectStep(project.currentStepKey);

	return (
		<section aria-labelledby="project-overview-title" className="space-y-6">
			<div className="space-y-2">
				<Badge variant="outline">Tổng quan project</Badge>
				<h1
					className="font-semibold text-2xl tracking-tight"
					id="project-overview-title"
				>
					{project.name}
				</h1>
				<p className="text-muted-foreground">
					Thông tin đầu vào và tiến độ hiện tại của project.
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
								label="Bước hiện tại"
								value={currentStep?.label ?? project.currentStepKey}
							/>
							<OverviewField
								label="Thời lượng"
								value={`${project.brief.durationSeconds} giây`}
							/>
						</dl>
					</CardContent>
				</Card>

				<Card className="rounded-2xl border border-affi-blue-border/80 shadow-sm">
					<CardHeader className="border-affi-blue-border/70 border-b">
						<CardTitle>Content Brief</CardTitle>
					</CardHeader>
					<CardContent>
						<dl className="space-y-4">
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
