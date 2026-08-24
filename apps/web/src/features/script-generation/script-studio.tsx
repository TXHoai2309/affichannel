"use client";

import type {
	ScriptGenerationArtifact,
	ScriptGenerationReadModel,
	ScriptGenerationSection,
} from "@affichannel/core/script-generation/types";
import type {
	ScriptVersionHistoryItem,
	ScriptVersionReadModel,
} from "@affichannel/core/script-version/types";
import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@affichannel/ui/components/empty";
import { Skeleton } from "@affichannel/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	Bot,
	Check,
	Clipboard,
	Clock3,
	Copy,
	FileText,
	History,
	Image,
	Info,
	LockKeyhole,
	Pencil,
	RefreshCw,
	Sparkles,
	TriangleAlert,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import ScriptEditor from "./script-editor";
import {
	getScriptVersionErrorCode,
	getScriptVersionErrorMessage,
} from "./script-editor-autosave";
import {
	canRepairSection,
	createIdempotencyKey,
	formatDate,
	formatEstimatedCost,
	formatOccurrence,
	getEstimateViewState,
	getLatestUsableArtifact,
	getPersistedScriptGenerationErrorMessage,
	getScriptGenerationErrorMessage,
	getScriptStudioCtaState,
	getStudioStatus,
	hasNewerScriptGeneration,
	hasUsableFacts,
	hasWarningFacts,
	isGenerationContextReady,
	isLatestUsableArtifactInvalidated,
	isSectionValid,
	SCRIPT_SECTION_LABELS,
	SCRIPT_STATUS_LABELS,
} from "./script-studio-state";

const FACT_FRESHNESS_LABELS: Record<string, string> = {
	fresh: "Mới xác nhận",
	needs_update: "Nên cập nhật",
	expired: "Đã hết hạn",
	unknown: "Chưa đủ dữ liệu freshness",
	not_applicable: "Không áp dụng",
};

const FACT_USABILITY_LABELS = {
	allowed: "Đủ điều kiện",
	allowed_with_warning: "Được dùng · có cảnh báo",
	blocked: "Chưa đủ điều kiện",
} as const;

function ContextItem({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="min-w-0">
			<dt className="font-medium text-muted-foreground text-xs">{label}</dt>
			<dd className="mt-1 whitespace-pre-wrap font-medium text-sm">
				{children}
			</dd>
		</div>
	);
}

function CopyButton({ value, label }: { value: string; label: string }) {
	async function copyValue() {
		try {
			await navigator.clipboard.writeText(value);
			toast.success("Đã sao chép", { description: label });
		} catch {
			toast.error("Không thể sao chép", {
				description: "Hãy thử lại trên trình duyệt có quyền clipboard.",
			});
		}
	}

	return (
		<Button
			aria-label={`Sao chép ${label}`}
			onClick={() => void copyValue()}
			size="icon-sm"
			variant="ghost"
		>
			<Copy aria-hidden="true" />
		</Button>
	);
}

function StatusBadge({
	status,
}: {
	status: keyof typeof SCRIPT_STATUS_LABELS;
}) {
	const variant =
		status === "completed"
			? "success"
			: status === "partial"
				? "warning"
				: status === "failed"
					? "destructive"
					: status === "indeterminate"
						? "warning"
						: status === "pending"
							? "default"
							: "outline";
	return <Badge variant={variant}>{SCRIPT_STATUS_LABELS[status]}</Badge>;
}

function StudioSkeleton() {
	return (
		<div
			aria-label="Đang tải Script Studio"
			className="space-y-5"
			role="status"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Skeleton className="h-9 w-48 rounded-lg" />
				<Skeleton className="h-8 w-32 rounded-full" />
			</div>
			<div className="grid gap-5 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
				<div className="space-y-5">
					<Skeleton className="h-72 rounded-2xl" />
					<Skeleton className="h-72 rounded-2xl" />
				</div>
				<Skeleton className="min-h-[720px] rounded-2xl" />
			</div>
		</div>
	);
}

function ContextPanel({ model }: { model: ScriptGenerationReadModel }) {
	const { context } = model;
	const usableFacts = context.facts.filter(
		(fact) =>
			fact.generationUsability === "allowed" ||
			fact.generationUsability === "allowed_with_warning",
	);
	const warningFacts = context.facts.filter(
		(fact) => fact.generationUsability === "allowed_with_warning",
	);

	return (
		<div className="space-y-5">
			<Card className="rounded-2xl border-affi-blue-border/80 shadow-sm">
				<CardHeader>
					<CardTitle>Ngữ cảnh đầu vào</CardTitle>
					<CardDescription>
						Dữ liệu hiện tại mà server sẽ dùng để chuẩn bị kịch bản.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="rounded-xl border bg-muted/30 p-4">
						<div className="flex items-start gap-3">
							<FileText
								aria-hidden="true"
								className="mt-0.5 size-4 text-primary"
							/>
							<div className="min-w-0">
								<p className="font-semibold text-sm">{context.project.name}</p>
								<p className="mt-1 text-muted-foreground text-xs">
									{context.product.name} · TikTok ·{" "}
									{context.contentBrief.durationSeconds} giây
								</p>
							</div>
							<Badge className="ml-auto" variant="outline">
								Read-only
							</Badge>
						</div>
					</div>

					<ContextGroup icon={Clipboard} title="Content Brief">
						<dl className="grid gap-4 sm:grid-cols-2">
							<ContextItem label="Mục tiêu">
								{context.contentBrief.goal}
							</ContextItem>
							<ContextItem label="Nền tảng">TikTok</ContextItem>
							<ContextItem label="Định dạng">Video ngắn · 9:16</ContextItem>
							<ContextItem label="Góc nội dung">
								{context.contentBrief.angle}
							</ContextItem>
							<ContextItem label="Thời lượng">
								{context.contentBrief.durationSeconds} giây
							</ContextItem>
							{context.contentBrief.description ? (
								<ContextItem label="Mô tả thêm">
									{context.contentBrief.description}
								</ContextItem>
							) : null}
						</dl>
					</ContextGroup>

					<ContextGroup icon={Sparkles} title="Product">
						<dl className="grid gap-4 sm:grid-cols-2">
							<ContextItem label="Tên sản phẩm">
								{context.product.name}
							</ContextItem>
							<ContextItem label="Danh mục">
								{context.product.category || "Chưa khai báo"}
							</ContextItem>
						</dl>
					</ContextGroup>

					<ContextGroup icon={LockKeyhole} title="Product Facts">
						{context.facts.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								Chưa có Product Fact.
							</p>
						) : (
							<div className="space-y-3">
								<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
									<span>{usableFacts.length} Fact có thể dùng</span>
									<span aria-hidden="true">·</span>
									<span>{context.facts.length} Fact tổng cộng</span>
								</div>
								<div className="space-y-3">
									{context.facts.map((fact) => (
										<div
											className="rounded-xl border bg-background p-3"
											key={fact.id}
										>
											<div className="flex flex-wrap items-center gap-2">
												<Badge
													variant={
														fact.generationUsability === "blocked"
															? "destructive"
															: fact.generationUsability ===
																	"allowed_with_warning"
																? "warning"
																: "success"
													}
												>
													{FACT_USABILITY_LABELS[fact.generationUsability]}
												</Badge>
												<Badge variant="outline">
													{FACT_FRESHNESS_LABELS[fact.assessment.freshness]}
												</Badge>
											</div>
											<p className="mt-2 text-sm">{fact.content}</p>
											<p className="mt-1 text-muted-foreground text-xs">
												{fact.source.label ||
													fact.source.url ||
													"Chưa có nguồn/evidence"}
												{fact.source.confirmedAt
													? ` · Xác nhận ${fact.source.confirmedAt}`
													: ""}
											</p>
										</div>
									))}
								</div>
								{warningFacts.length > 0 ? (
									<div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-xs">
										<AlertTriangle
											aria-hidden="true"
											className="mt-0.5 size-4 shrink-0"
										/>
										<span>
											Một số Product Facts sắp cần cập nhật. Kịch bản vẫn có thể
											được tạo từ dữ liệu hiện tại.
										</span>
									</div>
								) : null}
							</div>
						)}
						{!hasUsableFacts(model) ? (
							<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
								<p className="font-medium">
									Chưa có Product Facts đủ điều kiện để tạo kịch bản.
								</p>
								<Link
									className="mt-2 inline-flex font-medium underline underline-offset-4"
									href={`/products/${context.product.id}?tab=facts` as Route}
								>
									Cập nhật Product Facts
								</Link>
							</div>
						) : null}
					</ContextGroup>

					<ContextGroup icon={Image} title="Media usable">
						{context.mediaMetadata.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								Chưa có media sẵn sàng và có quyền sử dụng. Đây là trạng thái
								hợp lệ; bạn vẫn có thể tạo bản nháp.
							</p>
						) : (
							<div className="space-y-2">
								{context.mediaMetadata.map((media) => (
									<div
										className="rounded-xl border bg-background p-3"
										key={media.id}
									>
										<p className="font-medium text-sm">
											{media.reference.displayName}
										</p>
										<p className="mt-1 text-muted-foreground text-xs">
											{media.mediaType} · {media.aspectRatio} ·{" "}
											{media.sceneSuitability} · {media.usageRights}
										</p>
									</div>
								))}
							</div>
						)}
					</ContextGroup>

					<ContextGroup icon={Info} title="Output Rules & AI">
						<dl className="grid gap-4 sm:grid-cols-2">
							<ContextItem label="Ngôn ngữ">
								{context.outputRules.language}
							</ContextItem>
							<ContextItem label="Khung hình">
								{context.outputRules.aspectRatio}
							</ContextItem>
							<ContextItem label="Giới hạn claim">
								{context.outputRules.claimLimit ?? "Không giới hạn"}
							</ContextItem>
							<ContextItem label="Text provider">
								{context.generationConfig.textProvider}
							</ContextItem>
							<ContextItem label="Model">
								{context.generationConfig.textModel}
							</ContextItem>
						</dl>
						{context.channelSettings ? (
							<dl className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2">
								<ContextItem label="Ngách">
									{context.channelSettings.niche}
								</ContextItem>
								<ContextItem label="Đối tượng">
									{context.channelSettings.targetAudience}
								</ContextItem>
								<ContextItem label="Giọng điệu">
									{context.channelSettings.tone}
								</ContextItem>
								<ContextItem label="Trụ cột">
									{context.channelSettings.contentPillar}
								</ContextItem>
								<ContextItem label="CTA mặc định">
									{context.channelSettings.defaultCta}
								</ContextItem>
								<ContextItem label="Disclosure">
									{context.channelSettings.affiliateDisclosure}
								</ContextItem>
								<ContextItem label="Từ cần tránh">
									{context.channelSettings.avoidWords.length > 0
										? context.channelSettings.avoidWords.join(", ")
										: "Không có"}
								</ContextItem>
							</dl>
						) : (
							<div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
								<AlertTriangle
									aria-hidden="true"
									className="mt-0.5 size-4 shrink-0"
								/>
								<span>
									Channel Settings chưa đầy đủ. Hãy hoàn thiện tại{" "}
									<Link
										className="font-medium underline underline-offset-4"
										href="/settings"
									>
										Cài đặt
									</Link>{" "}
									trước khi tạo.
								</span>
							</div>
						)}
					</ContextGroup>
				</CardContent>
			</Card>
		</div>
	);
}

function ContextGroup({
	icon: Icon,
	title,
	children,
}: {
	icon: typeof Clipboard;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
			<div className="flex items-center gap-2">
				<Icon aria-hidden="true" className="size-4 text-primary" />
				<h3 className="font-semibold text-sm">{title}</h3>
			</div>
			{children}
		</section>
	);
}

function EstimatePanel({
	model,
	estimateEnabled,
	estimate,
	estimateLoading,
	estimateError,
	onRetry,
}: {
	model: ScriptGenerationReadModel;
	estimateEnabled: boolean;
	estimate: {
		estimatedCostMicros: bigint | number | string | null;
		currency: string | null;
		inputTokens: number | null;
		pricingBasis: string | null;
		provider: string;
		model: string;
	} | null;
	estimateLoading: boolean;
	estimateError: unknown;
	onRetry: () => void;
}) {
	const cost = formatEstimatedCost(
		estimate?.estimatedCostMicros,
		estimate?.currency,
	);
	const estimateState = getEstimateViewState({
		enabled: estimateEnabled,
		isFetching: estimateLoading,
		isError: Boolean(estimateError),
		hasData: Boolean(estimate),
	});
	return (
		<Card className="rounded-2xl border-affi-blue-border/80 shadow-sm">
			<CardHeader>
				<CardTitle>Ước tính trước khi tạo</CardTitle>
				<CardDescription>
					Server trả về provider, model và currency thật.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{estimateState === "blocked" ? (
					<p className="text-muted-foreground text-sm">
						{hasUsableFacts(model)
							? "Hoàn thiện Channel Settings để có thể ước tính và tạo kịch bản."
							: "Thêm Product Fact đủ điều kiện để có thể ước tính và tạo kịch bản."}
					</p>
				) : estimateState === "loading" ? (
					<div
						aria-label="Đang tính chi phí"
						className="space-y-2"
						role="status"
					>
						<Skeleton className="h-5 w-40 rounded-md" />
						<Skeleton className="h-4 w-56 rounded-md" />
					</div>
				) : estimateError ? (
					<div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
						<p className="font-medium">
							{getScriptGenerationErrorMessage(estimateError)}
						</p>
						<Button
							className="mt-3"
							onClick={onRetry}
							size="sm"
							variant="outline"
						>
							Thử ước tính lại
						</Button>
					</div>
				) : estimate ? (
					<dl className="grid gap-3 sm:grid-cols-2">
						<ContextItem label="Chi phí ước tính">
							{cost ?? "Chưa có ước tính"}
						</ContextItem>
						<ContextItem label="Provider / model">
							{estimate.provider} · {estimate.model}
						</ContextItem>
						{estimate.inputTokens !== null ? (
							<ContextItem label="Input tokens">
								{estimate.inputTokens.toLocaleString("vi-VN")}
							</ContextItem>
						) : null}
						{estimate.pricingBasis ? (
							<ContextItem label="Cơ sở tính">
								{estimate.pricingBasis}
							</ContextItem>
						) : null}
					</dl>
				) : (
					<p className="text-muted-foreground text-sm">
						Chưa thể ước tính cho đến khi context sẵn sàng.
					</p>
				)}
				{hasWarningFacts(model) ? (
					<p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-xs">
						<AlertTriangle
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0"
						/>
						Một số Fact có cảnh báo freshness nhưng vẫn được server cho phép sử
						dụng.
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}

function GenerationProgress() {
	return (
		<div
			aria-live="polite"
			className="rounded-xl border border-primary/20 bg-primary/5 p-4"
			role="status"
		>
			<div className="flex items-center gap-2 font-medium text-primary text-sm">
				<RefreshCw aria-hidden="true" className="size-4 animate-spin" />
				Đang tạo kịch bản...
			</div>
			<ul className="mt-3 space-y-2 text-muted-foreground text-xs">
				<li className="flex items-center gap-2">
					<Check aria-hidden="true" className="size-3 text-primary" /> Đang
					chuẩn bị dữ liệu
				</li>
				<li className="flex items-center gap-2">
					<Clock3 aria-hidden="true" className="size-3" /> Đang tạo nội dung với
					AI
				</li>
				<li className="flex items-center gap-2">
					<Clock3 aria-hidden="true" className="size-3" /> Đang kiểm tra cấu
					trúc kịch bản
				</li>
			</ul>
		</div>
	);
}

function RequestNotice({
	model,
	actionError,
}: {
	model: ScriptGenerationReadModel;
	actionError: string | null;
}) {
	const request = model.latestRequest;
	const persistedErrorMessage =
		getPersistedScriptGenerationErrorMessage(request);
	if (actionError) {
		return (
			<div
				className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm"
				role="alert"
			>
				<p className="font-medium">{actionError}</p>
				<p className="mt-1 text-xs">
					Không tự động gửi lại yêu cầu để tránh phát sinh chi phí trùng.
				</p>
			</div>
		);
	}
	if (
		!request ||
		request.status === "completed" ||
		request.status === "partial"
	)
		return null;
	if (request.status === "pending") return <GenerationProgress />;
	if (request.status === "indeterminate") {
		return (
			<div
				className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 text-sm"
				aria-live="polite"
				role="status"
			>
				<p className="flex items-center gap-2 font-semibold">
					<TriangleAlert aria-hidden="true" className="size-4" /> Trạng thái yêu
					cầu chưa xác định
				</p>
				<p className="mt-2">
					Nhà cung cấp AI có thể đã nhận yêu cầu, nhưng hệ thống chưa xác nhận
					được kết quả. AffiChannel không tự động gửi lại.
				</p>
			</div>
		);
	}
	return (
		<div
			className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm"
			role="alert"
		>
			<p className="font-semibold">Không thể tạo kịch bản.</p>
			<p className="mt-1">
				{persistedErrorMessage ??
					"Yêu cầu mới nhất chưa được hoàn tất. Bạn có thể kiểm tra context và tạo một yêu cầu mới."}
			</p>
		</div>
	);
}

function SectionHeader({
	artifact,
	section,
	onRepair,
	repairPending,
}: {
	artifact: ScriptGenerationArtifact;
	section: ScriptGenerationSection;
	onRepair?: () => void;
	repairPending?: boolean;
}) {
	const invalid = !isSectionValid(artifact, section);
	return (
		<CardHeader className="border-b">
			<CardTitle>{SCRIPT_SECTION_LABELS[section]}</CardTitle>
			<CardAction className="flex items-center gap-2">
				<Badge variant={invalid ? "warning" : "success"}>
					{invalid ? "Cần tạo lại" : "Đã kiểm tra cấu trúc"}
				</Badge>
				{invalid && onRepair ? (
					<Button
						disabled={repairPending}
						onClick={onRepair}
						size="sm"
						variant="outline"
					>
						{repairPending ? "Đang tạo lại..." : "Tạo lại phần này"}
					</Button>
				) : null}
			</CardAction>
		</CardHeader>
	);
}

function OutputCard({
	artifact,
	section,
	onRepair,
	repairPending,
	children,
}: {
	artifact: ScriptGenerationArtifact;
	section: ScriptGenerationSection;
	onRepair?: () => void;
	repairPending?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Card className="rounded-2xl border-affi-blue-border/80 shadow-sm">
			<SectionHeader
				artifact={artifact}
				section={section}
				onRepair={onRepair}
				repairPending={repairPending}
			/>
			<CardContent className="pt-4">{children}</CardContent>
		</Card>
	);
}

function ScriptOutput({
	artifact,
	canRepair,
	onRepair,
	repairPending,
}: {
	artifact: ScriptGenerationArtifact;
	canRepair: (section: ScriptGenerationSection) => boolean;
	onRepair: (section: ScriptGenerationSection) => void;
	repairPending: boolean;
}) {
	const output = artifact.output;
	const repair = (section: ScriptGenerationSection) =>
		canRepair(section) && artifact.invalidSections.includes(section)
			? () => onRepair(section)
			: undefined;
	return (
		<div className="space-y-4">
			<OutputCard
				artifact={artifact}
				section="hook"
				onRepair={repair("hook")}
				repairPending={repairPending}
			>
				{output?.hookVariants?.length ? (
					<div className="space-y-3">
						{output.hookVariants.map((hook, index) => (
							<div
								className="flex items-start gap-3 rounded-xl border bg-background p-3"
								key={hook.key}
							>
								<Badge variant="outline">Hook {index + 1}</Badge>
								<p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">
									{hook.text}
								</p>
								<CopyButton label={`Hook ${index + 1}`} value={hook.text} />
							</div>
						))}
					</div>
				) : (
					<InvalidSectionMessage />
				)}
			</OutputCard>

			<OutputCard
				artifact={artifact}
				section="voiceover"
				onRepair={repair("voiceover")}
				repairPending={repairPending}
			>
				{output?.voiceoverSegments?.length ? (
					<div className="space-y-3">
						{output.voiceoverSegments.map((segment, index) => (
							<div
								className="flex items-start gap-3 rounded-xl border bg-background p-3"
								key={segment.key}
							>
								<Badge variant="outline">Đoạn {index + 1}</Badge>
								<p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">
									{segment.text}
								</p>
								<CopyButton
									label={`Voiceover đoạn ${index + 1}`}
									value={segment.text}
								/>
							</div>
						))}
					</div>
				) : (
					<InvalidSectionMessage />
				)}
			</OutputCard>

			<OutputCard
				artifact={artifact}
				section="scenes"
				onRepair={repair("scenes")}
				repairPending={repairPending}
			>
				{output?.scenes?.length ? (
					<div className="space-y-3">
						{output.scenes.map((scene) => (
							<div
								className="rounded-xl border bg-background p-4"
								key={scene.order}
							>
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant="outline">Cảnh {scene.order}</Badge>
									<span className="text-muted-foreground text-xs">
										{scene.durationSeconds} giây
									</span>
								</div>
								<dl className="mt-3 grid gap-3 sm:grid-cols-2">
									<ContextItem label="Hình ảnh">
										{scene.visualDirection}
									</ContextItem>
									<ContextItem label="Text trên màn hình">
										{scene.onScreenText || "Không có"}
									</ContextItem>
									<ContextItem label="Voiceover tham chiếu">
										{scene.voiceoverSegmentKeys.length > 0
											? scene.voiceoverSegmentKeys.join(", ")
											: "Không có"}
									</ContextItem>
								</dl>
							</div>
						))}
					</div>
				) : (
					<InvalidSectionMessage />
				)}
			</OutputCard>

			<OutputCard
				artifact={artifact}
				section="cta"
				onRepair={repair("cta")}
				repairPending={repairPending}
			>
				{output?.cta ? (
					<CopyableText label="CTA" value={output.cta.text} />
				) : (
					<InvalidSectionMessage />
				)}
			</OutputCard>

			<OutputCard
				artifact={artifact}
				section="caption"
				onRepair={repair("caption")}
				repairPending={repairPending}
			>
				{output?.caption ? (
					<CopyableText label="Caption" value={output.caption} />
				) : (
					<InvalidSectionMessage />
				)}
			</OutputCard>

			<OutputCard
				artifact={artifact}
				section="hashtags"
				onRepair={repair("hashtags")}
				repairPending={repairPending}
			>
				{output?.hashtags ? (
					<div className="flex flex-wrap items-center gap-2">
						{output.hashtags.map((hashtag) => (
							<Badge key={hashtag} variant="outline">
								{hashtag}
							</Badge>
						))}
						<CopyButton
							label="tất cả hashtag"
							value={output.hashtags.join(" ")}
						/>
					</div>
				) : (
					<InvalidSectionMessage />
				)}
			</OutputCard>

			<OutputCard
				artifact={artifact}
				section="disclosure"
				onRepair={repair("disclosure")}
				repairPending={repairPending}
			>
				{output?.disclosure ? (
					<CopyableText
						label="Disclosure affiliate"
						value={output.disclosure}
					/>
				) : (
					<InvalidSectionMessage />
				)}
			</OutputCard>

			<OutputCard
				artifact={artifact}
				section="claims"
				onRepair={repair("claims")}
				repairPending={repairPending}
			>
				{output?.claims ? (
					<div className="space-y-3">
						<div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950 text-xs">
							<LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
							<span>Candidate claims · Chưa qua Fact Lock</span>
						</div>
						{output.claims.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								Không có claim cần kiểm tra.
							</p>
						) : (
							output.claims.map((claim, index) => (
								<div
									className="flex items-start gap-3 rounded-xl border bg-background p-3"
									key={`${claim.text}-${index}`}
								>
									<p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">
										{claim.text}
									</p>
									<div className="flex shrink-0 items-center gap-2">
										<Badge variant="outline">
											{formatOccurrence(claim.occurrence)}
										</Badge>
										<CopyButton
											label={`claim ${index + 1}`}
											value={claim.text}
										/>
									</div>
								</div>
							))
						)}
					</div>
				) : (
					<InvalidSectionMessage />
				)}
			</OutputCard>
		</div>
	);
}

function InvalidSectionMessage() {
	return (
		<div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 text-sm">
			<AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
			Phần này chưa có output hợp lệ. Hãy dùng nút tạo lại phần lỗi.
		</div>
	);
}

function CopyableText({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-start gap-3 rounded-xl border bg-background p-3">
			<p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{value}</p>
			<CopyButton label={label} value={value} />
		</div>
	);
}

function EmptyOutput({
	onGenerate,
	disabled,
}: {
	onGenerate: () => void;
	disabled: boolean;
}) {
	return (
		<Empty className="min-h-[360px] rounded-2xl border bg-card py-14 shadow-sm">
			<EmptyMedia variant="icon">
				<Bot aria-hidden="true" />
			</EmptyMedia>
			<EmptyHeader>
				<EmptyTitle>Chưa có kịch bản</EmptyTitle>
				<EmptyDescription>
					Kiểm tra Product Facts và cấu hình nội dung, sau đó tạo kịch bản đầu
					tiên.
				</EmptyDescription>
			</EmptyHeader>
			<Button disabled={disabled} onClick={onGenerate}>
				<Sparkles aria-hidden="true" />
				Tạo kịch bản
			</Button>
		</Empty>
	);
}

function InvalidatedArtifactNotice({
	canGenerate,
	isPartial,
	onGenerate,
}: {
	canGenerate: boolean;
	isPartial: boolean;
	onGenerate: () => void;
}) {
	return (
		<div
			aria-live="polite"
			className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950"
			role="status"
		>
			<div className="flex items-start gap-3">
				<TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
				<div className="min-w-0 flex-1">
					<p className="font-semibold text-sm">Product Facts đã thay đổi</p>
					<p className="mt-1 text-sm">
						Kịch bản này được tạo từ phiên bản Product Facts cũ nên không còn
						phản ánh dữ liệu hiện tại.
					</p>
					{isPartial ? (
						<p className="mt-1 text-sm">
							Không thể tạo lại riêng phần lỗi của kịch bản cũ. Hãy tạo một kịch
							bản mới để sử dụng dữ liệu hiện tại.
						</p>
					) : null}
					<Button
						className="mt-3"
						disabled={!canGenerate}
						onClick={onGenerate}
						size="sm"
						variant="outline"
					>
						<Sparkles aria-hidden="true" />
						Tạo kịch bản mới
					</Button>
				</div>
			</div>
		</div>
	);
}

function ErrorPanel({ onRetry }: { onRetry: () => void }) {
	return (
		<div
			className="mx-auto max-w-2xl rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-destructive"
			role="alert"
		>
			<h2 className="font-semibold text-lg">Không thể tải Script Studio</h2>
			<p className="mt-2 text-sm">
				Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.
			</p>
			<Button className="mt-5" onClick={onRetry} variant="outline">
				Thử lại
			</Button>
		</div>
	);
}

export default function ScriptStudio({ projectId }: { projectId: string }) {
	const [actionError, setActionError] = useState<string | null>(null);
	const [editorOpen, setEditorOpen] = useState(false);
	const [historyOpenedFromReadOnly, setHistoryOpenedFromReadOnly] =
		useState(false);
	const stateQuery = useQuery(
		orpc.scriptGeneration.getState.queryOptions({
			input: { projectId },
			meta: { suppressGlobalErrorToast: true },
			retry: false,
			staleTime: 0,
			refetchInterval: (query) => {
				const data = query.state.data as ScriptGenerationReadModel | undefined;
				return data?.latestRequest?.status === "pending" ? 2_000 : false;
			},
		}),
	);
	const model = stateQuery.data as ScriptGenerationReadModel | undefined;
	const scriptVersionQuery = useQuery(
		orpc.scriptVersion.getCurrent.queryOptions({
			input: { projectId },
			meta: { suppressGlobalErrorToast: true },
			retry: false,
			refetchOnReconnect: true,
			refetchOnWindowFocus: true,
			staleTime: 0,
		}),
	);
	const currentDraft = scriptVersionQuery.data as
		| ScriptVersionReadModel
		| null
		| undefined;
	const historySummaryQuery = useQuery(
		orpc.scriptVersion.listHistory.queryOptions({
			input: { projectId },
			enabled: Boolean(model?.latestUsableArtifact),
			meta: { suppressGlobalErrorToast: true },
			retry: false,
			staleTime: 0,
		}),
	);
	const estimateQuery = useQuery(
		orpc.scriptGeneration.estimate.queryOptions({
			input: { projectId },
			enabled: Boolean(model && !editorOpen && isGenerationContextReady(model)),
			meta: { suppressGlobalErrorToast: true },
			retry: false,
			staleTime: 30_000,
		}),
	);
	const generateMutation = useMutation(
		orpc.scriptGeneration.generate.mutationOptions(),
	);
	const repairMutation = useMutation(
		orpc.scriptGeneration.repair.mutationOptions(),
	);
	const initializeMutation = useMutation(
		orpc.scriptVersion.initialize.mutationOptions(),
	);
	const autosaveMutation = useMutation(
		orpc.scriptVersion.autosave.mutationOptions(),
	);

	if (stateQuery.isPending || scriptVersionQuery.isPending)
		return <StudioSkeleton />;
	if (stateQuery.isError || scriptVersionQuery.isError || !model)
		return (
			<ErrorPanel
				onRetry={() =>
					void Promise.all([stateQuery.refetch(), scriptVersionQuery.refetch()])
				}
			/>
		);

	const latestUsableArtifact = getLatestUsableArtifact(model);
	const status = getStudioStatus(model);
	const hasPendingRequest = model.latestRequest?.status === "pending";
	const canGenerate =
		isGenerationContextReady(model) &&
		estimateQuery.isSuccess &&
		!hasPendingRequest &&
		!generateMutation.isPending &&
		!repairMutation.isPending;
	const canInitialize = Boolean(
		latestUsableArtifact?.status === "completed" &&
			model.dependencyState?.state !== "invalidated" &&
			!initializeMutation.isPending,
	);
	const canOpenEditor = Boolean(currentDraft) || canInitialize;
	const ctaState = getScriptStudioCtaState({
		hasUsableArtifact: Boolean(latestUsableArtifact),
		canEdit: canOpenEditor,
		generationPending: generateMutation.isPending || hasPendingRequest,
	});
	const latestSavedVersion = (
		historySummaryQuery.data as ScriptVersionHistoryItem[] | undefined
	)?.[0];

	async function refreshState() {
		await stateQuery.refetch();
	}

	async function generateScript() {
		if (!canGenerate) return;
		setActionError(null);
		try {
			await generateMutation.mutateAsync({
				projectId,
				idempotencyKey: createIdempotencyKey("generate"),
			});
			await refreshState();
		} catch (error) {
			setActionError(getScriptGenerationErrorMessage(error));
		}
	}

	async function repairSection(section: ScriptGenerationSection) {
		if (!model || !canRepairSection(model, section)) return;
		if (!latestUsableArtifact) return;
		setActionError(null);
		try {
			await repairMutation.mutateAsync({
				projectId,
				baseGenerationRequestId: latestUsableArtifact.id,
				sections: [section],
				idempotencyKey: createIdempotencyKey("repair"),
			});
			await refreshState();
		} catch (error) {
			setActionError(getScriptGenerationErrorMessage(error));
		}
	}

	async function initializeEditor() {
		if (currentDraft) {
			setHistoryOpenedFromReadOnly(false);
			setEditorOpen(true);
			return;
		}
		if (!latestUsableArtifact || !canInitialize) return;
		setActionError(null);
		try {
			await initializeMutation.mutateAsync({
				projectId,
				sourceGenerationId: latestUsableArtifact.id,
			});
			await scriptVersionQuery.refetch();
			setHistoryOpenedFromReadOnly(false);
			setEditorOpen(true);
		} catch (error) {
			if (
				getScriptVersionErrorCode(error) ===
				"SCRIPT_VERSION_DRAFT_ALREADY_EXISTS"
			) {
				await scriptVersionQuery.refetch();
				setHistoryOpenedFromReadOnly(false);
				setEditorOpen(true);
				return;
			}
			setActionError(getScriptVersionErrorMessage(error));
		}
	}

	async function reloadCurrentDraft() {
		const result = await scriptVersionQuery.refetch();
		return (result.data as ScriptVersionReadModel | null | undefined) ?? null;
	}

	async function finishVersionSave() {
		await Promise.allSettled([
			stateQuery.refetch(),
			scriptVersionQuery.refetch(),
			historySummaryQuery.refetch(),
		]);
		setHistoryOpenedFromReadOnly(false);
		setEditorOpen(false);
	}

	function openHistoryFromReadOnly() {
		if (!currentDraft) return;
		setHistoryOpenedFromReadOnly(true);
		setEditorOpen(true);
	}

	if (currentDraft && editorOpen) {
		return (
			<ScriptEditor
				draft={currentDraft}
				sourceArtifact={latestUsableArtifact}
				hasNewerGeneration={hasNewerScriptGeneration(
					currentDraft,
					latestUsableArtifact,
				)}
				onReloadLatest={reloadCurrentDraft}
				onVersionSaved={finishVersionSave}
				initialHistoryOpen={historyOpenedFromReadOnly}
				onHistoryClosed={
					historyOpenedFromReadOnly
						? () => {
								setHistoryOpenedFromReadOnly(false);
								setEditorOpen(false);
							}
						: undefined
				}
				save={(request) => autosaveMutation.mutateAsync(request)}
			/>
		);
	}

	return (
		<div className="mx-auto w-full max-w-7xl space-y-5">
			<header className="flex flex-col gap-4 rounded-2xl border border-affi-blue-border bg-card p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<Sparkles aria-hidden="true" className="size-5 text-primary" />
						<h2 className="font-semibold text-2xl tracking-tight">
							Script Studio
						</h2>
						<StatusBadge status={status} />
					</div>
					<p className="max-w-2xl text-muted-foreground text-sm">
						Tạo kịch bản affiliate từ Product Facts đã xác nhận.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{latestUsableArtifact ? (
						<div className="mr-1 text-muted-foreground text-xs sm:text-right">
							<p>Bản dùng được: {formatDate(latestUsableArtifact.createdAt)}</p>
							{latestSavedVersion?.versionNumber ? (
								<p className="mt-0.5">
									Phiên bản hiện tại: #{latestSavedVersion.versionNumber} · Đã lưu{" "}
									{formatDate(latestSavedVersion.savedAt)}
								</p>
							) : null}
						</div>
					) : null}
					{ctaState.editLabel ? (
						<Button
							disabled={!canOpenEditor}
							onClick={() => void initializeEditor()}
							type="button"
						>
							{initializeMutation.isPending ? (
								<RefreshCw aria-hidden="true" className="animate-spin" />
							) : (
								<Pencil aria-hidden="true" />
							)}
							{ctaState.editLabel}
						</Button>
					) : null}
					<Button
						disabled={!canGenerate}
						onClick={() => void generateScript()}
						type="button"
						variant={latestUsableArtifact ? "outline" : "default"}
					>
						{generateMutation.isPending || hasPendingRequest ? (
							<RefreshCw aria-hidden="true" className="animate-spin" />
						) : (
							<Sparkles aria-hidden="true" />
						)}
						{ctaState.generationLabel}
					</Button>
					{currentDraft ? (
						<Button
							onClick={openHistoryFromReadOnly}
							type="button"
							variant="outline"
						>
							<History aria-hidden="true" />
							Lịch sử
						</Button>
					) : null}
				</div>
			</header>

			<RequestNotice actionError={actionError} model={model} />
			<div className="grid items-start gap-5 xl:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.5fr)]">
				<div className="space-y-5 xl:sticky xl:top-5">
					<ContextPanel model={model} />
					<EstimatePanel
						estimateEnabled={isGenerationContextReady(model)}
						estimate={
							estimateQuery.data
								? {
										...estimateQuery.data,
										provider: model.context.generationConfig.textProvider,
										model: model.context.generationConfig.textModel,
									}
								: null
						}
						estimateError={estimateQuery.error}
						estimateLoading={estimateQuery.isFetching}
						model={model}
						onRetry={() => void estimateQuery.refetch()}
					/>
				</div>

				<section aria-labelledby="script-output-title" className="space-y-4">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h3 className="font-semibold text-lg" id="script-output-title">
								Generated Script
							</h3>
							<p className="text-muted-foreground text-sm">
								Output bất biến của ScriptGeneration.
							</p>
						</div>
						{model.dependencyState?.state === "invalidated" ? (
							<Badge variant="warning">
								<TriangleAlert aria-hidden="true" className="size-3" /> Product
								Facts đã thay đổi
							</Badge>
						) : null}
					</div>
					{latestUsableArtifact ? (
						<>
							{isLatestUsableArtifactInvalidated(model) ? (
								<InvalidatedArtifactNotice
									canGenerate={canGenerate}
									isPartial={latestUsableArtifact.status === "partial"}
									onGenerate={() => void generateScript()}
								/>
							) : null}
							{latestUsableArtifact.status === "partial" ? (
								<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950 text-sm">
									<p className="font-medium">Kịch bản hoàn thành một phần.</p>
									<p className="mt-1 text-xs">
										Các phần hợp lệ vẫn được giữ nguyên. Chỉ phần có cảnh báo
										mới cần tạo lại.
									</p>
								</div>
							) : null}
							<ScriptOutput
								artifact={latestUsableArtifact}
								canRepair={(section) => canRepairSection(model, section)}
								onRepair={(section) => void repairSection(section)}
								repairPending={repairMutation.isPending}
							/>
						</>
					) : (
						<EmptyOutput
							disabled={!canGenerate}
							onGenerate={() => void generateScript()}
						/>
					)}
				</section>
			</div>
		</div>
	);
}
