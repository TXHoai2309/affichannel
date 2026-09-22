import type { AdaptiveWorkflowReadModel } from "@affichannel/core";
import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { ArrowRight, CircleAlert, LockKeyhole } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ProjectMediaPanel } from "@/features/media/project-media-panel";
import ScriptStudio from "@/features/script-generation/script-studio";
import VoiceStudio from "@/features/voice/voice-studio";
import { AiVisualGenerator } from "./ai-visual-generator";
import {
	deriveVideoStudioTabPresentation,
	type VideoStudioPresentationState,
} from "./video-studio-presentation";
import type { VideoStudioTabKey } from "./video-studio-tabs";

export type VideoStudioProject = Readonly<{
	id: string;
	name: string;
	contentType: "ORGANIC" | "AFFILIATE" | null;
	creationPath: string | null;
	productName: string;
}>;

type Props = Readonly<{
	project: VideoStudioProject;
	workflow: AdaptiveWorkflowReadModel;
	activeTab: VideoStudioTabKey;
	compositionVersionId?: string;
	composeContent: ReactNode;
	exportContent: ReactNode;
}>;

function tabHref(
	projectId: string,
	tab: VideoStudioTabKey,
	compositionVersionId?: string,
) {
	const params = new URLSearchParams({ studioTab: tab });
	if (compositionVersionId) {
		params.set("compositionVersionId", compositionVersionId);
	}
	return `/projects/${projectId}/studio?${params.toString()}` as Route;
}

function stateLabel(state: VideoStudioPresentationState) {
	if (state === "AVAILABLE") return "Sẵn sàng";
	if (state === "REQUIRED") return "Cần hoàn tất";
	if (state === "OPTIONAL") return "Tùy chọn";
	if (state === "PLACEHOLDER") return "Chưa khả dụng";
	return "Không áp dụng";
}

function stateVariant(state: VideoStudioPresentationState) {
	if (state === "AVAILABLE") return "success" as const;
	if (state === "REQUIRED") return "warning" as const;
	if (state === "PLACEHOLDER") return "secondary" as const;
	return "outline" as const;
}

function TabStateSummary({
	state,
	helpText,
}: {
	state: VideoStudioPresentationState;
	helpText: string;
}) {
	return (
		<div className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3">
			{state === "PLACEHOLDER" ? (
				<CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
			) : null}
			<div className="min-w-0">
				<p className="font-medium text-sm">{stateLabel(state)}</p>
				<p className="text-muted-foreground text-xs">{helpText}</p>
			</div>
		</div>
	);
}

function ActionLink({ href, children }: { href: string; children: string }) {
	return (
		<Button
			nativeButton={false}
			render={<Link href={href as Route} />}
			size="sm"
			variant="outline"
		>
			{children}
			<ArrowRight aria-hidden="true" data-icon="inline-end" />
		</Button>
	);
}

function ContentPanel({
	project,
	workflow,
}: Pick<Props, "project" | "workflow">) {
	const content = deriveVideoStudioTabPresentation(workflow).find(
		(tab) => tab.key === "content",
	);
	const scripted = project.creationPath === "SCRIPTED";
	const quickImage = project.creationPath === "QUICK_IMAGE";
	const mediaFirst = project.creationPath === "MEDIA_FIRST";
	const factLockApplicable = workflow.steps.some(
		(step) =>
			step.capability === "FACT_LOCK" &&
			step.applicabilityState !== "NOT_REQUIRED",
	);
	return (
		<div className="space-y-4">
			<TabStateSummary
				helpText={content?.helpText ?? "Trạng thái chưa xác định."}
				state={content?.state ?? "PLACEHOLDER"}
			/>
			{mediaFirst ? (
				<UnavailableCard
					title="Content chưa khả dụng"
					description="MEDIA_FIRST đang chờ vertical slice riêng. Video Studio không tự chuyển project sang Quick Image hoặc Scripted."
				/>
			) : scripted ? (
				<Card>
					<CardHeader>
						<CardTitle>Scripted content</CardTitle>
						<CardDescription>
							Giữ nguyên ScriptStudio và các yêu cầu Product/Claim/Fact Lock
							hiện hữu.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ScriptStudio projectId={project.id} />
					</CardContent>
				</Card>
			) : quickImage ? (
				<Card>
					<CardHeader>
						<CardTitle>Quick Image content</CardTitle>
						<CardDescription>
							Quick Image không tạo ScriptVersion hoặc VoiceVersion giả. Nguồn
							ảnh và CompositionVersion được giữ ở domain hiện hữu.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-wrap gap-2">
						<ActionLink href={`/projects/${project.id}/preview`}>
							Mở nguồn và preview
						</ActionLink>
						{project.contentType === "AFFILIATE" ? (
							<ActionLink href={`/projects/${project.id}/product`}>
								Mở Product / Claim
							</ActionLink>
						) : null}
					</CardContent>
				</Card>
			) : (
				<UnavailableCard
					title="Content identity chưa được hỗ trợ"
					description="Video Studio không tự suy đoán CreationPath tương lai và không route identity không xác định sang Quick Image hoặc Scripted."
				/>
			)}
			{!mediaFirst && (scripted || quickImage) ? (
				<div className="flex flex-wrap gap-2">
					{project.contentType === "AFFILIATE" ? (
						<ActionLink href={`/projects/${project.id}/product`}>
							Product / Claim
						</ActionLink>
					) : null}
					{factLockApplicable ? (
						<ActionLink href={`/projects/${project.id}/fact-lock`}>
							Fact Lock
						</ActionLink>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function ResourcesPanel({
	project,
	workflow,
}: Pick<Props, "project" | "workflow">) {
	const resources = deriveVideoStudioTabPresentation(workflow).find(
		(tab) => tab.key === "resources",
	);
	const voiceStep = workflow.steps.find((step) => step.capability === "VOICE");
	const voiceApplicable = voiceStep?.applicabilityState !== "NOT_REQUIRED";
	const mediaContentType = project.contentType;
	return (
		<div className="space-y-4">
			<TabStateSummary
				helpText={resources?.helpText ?? "Trạng thái chưa xác định."}
				state={resources?.state ?? "PLACEHOLDER"}
			/>
			{mediaContentType ? (
				<>
					<Card>
						<CardHeader>
							<CardTitle>Media Library</CardTitle>
							<CardDescription>
								Media được liên kết qua MediaAsset/Media Library hiện hữu; không
								có repository riêng cho Video Studio.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ProjectMediaPanel
								contentType={mediaContentType}
								projectId={project.id}
							/>
						</CardContent>
					</Card>
					<AiVisualGenerator projectId={project.id} />
				</>
			) : (
				<UnavailableCard
					title="Media Library chưa xác định được content policy"
					description="Project identity chưa có Organic/Affiliate content type; không mở picker theo mặc định."
				/>
			)}
			{voiceApplicable ? (
				<Card>
					<CardHeader>
						<CardTitle>Voice artifacts</CardTitle>
						<CardDescription>
							Voice artifacts và segment state tiếp tục dùng Voice authority
							hiện hữu.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<VoiceStudio projectId={project.id} />
					</CardContent>
				</Card>
			) : (
				<UnavailableCard
					title="Voice không áp dụng"
					description="Applicability Resolver xác định project hiện tại không cần Voice artifacts."
				/>
			)}
		</div>
	);
}

function UnavailableCard({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<Card className="border-dashed">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					<LockKeyhole aria-hidden="true" className="size-4" />
					{title}
				</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
		</Card>
	);
}

export default function VideoStudioShell({
	project,
	workflow,
	activeTab,
	compositionVersionId,
	composeContent,
	exportContent,
}: Props) {
	const tabs = deriveVideoStudioTabPresentation(workflow);
	const active = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];
	return (
		<section
			className="space-y-6"
			data-project-id={project.id}
			data-video-studio
		>
			<header className="space-y-3">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<Badge className="w-fit" variant="outline">
							Video Studio
						</Badge>
						<h1 className="mt-2 font-semibold text-2xl tracking-tight">
							{project.name}
						</h1>
						<p className="mt-1 max-w-2xl text-muted-foreground text-sm">
							Organic và Affiliate dùng chung một shell; khác biệt đến từ
							persisted identity và Applicability Resolver.
						</p>
					</div>
					<div className="flex gap-2">
						<Badge variant="secondary">
							{project.contentType ?? "UNKNOWN"}
						</Badge>
						<Badge variant="secondary">
							{project.creationPath ?? "UNKNOWN"}
						</Badge>
					</div>
				</div>
				<nav aria-label="Video Studio tabs">
					<div
						className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
						role="tablist"
					>
						{tabs.map((tab) => (
							<div key={tab.key}>
								<Link
									aria-selected={tab.key === activeTab}
									className={`block rounded-xl border p-3 transition-colors hover:bg-muted ${tab.key === activeTab ? "border-primary bg-primary/5" : ""}`}
									href={tabHref(project.id, tab.key, compositionVersionId)}
									role="tab"
								>
									<div className="flex items-center justify-between gap-2">
										<span className="font-medium">{tab.label}</span>
										<Badge variant={stateVariant(tab.state)}>
											{stateLabel(tab.state)}
										</Badge>
									</div>
									<p className="mt-1 text-muted-foreground text-xs">
										{tab.description}
									</p>
								</Link>
							</div>
						))}
					</div>
				</nav>
			</header>

			<Card>
				<CardHeader>
					<CardTitle>{active.label}</CardTitle>
					<CardDescription>{active.helpText}</CardDescription>
				</CardHeader>
				<CardContent>
					{activeTab === "content" ? (
						<ContentPanel project={project} workflow={workflow} />
					) : activeTab === "resources" ? (
						<ResourcesPanel project={project} workflow={workflow} />
					) : activeTab === "compose" ? (
						composeContent
					) : (
						exportContent
					)}
				</CardContent>
			</Card>
		</section>
	);
}
