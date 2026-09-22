"use client";

import type { AiVisualEstimate } from "@affichannel/core";
import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "@/utils/orpc";

type Props = Readonly<{ projectId: string }>;

function errorCode(error: unknown) {
	if (!error || typeof error !== "object") return "AI_VISUAL_REQUEST_FAILED";
	const candidate = error as { message?: unknown; data?: { code?: unknown } };
	return typeof candidate.data?.code === "string"
		? candidate.data.code
		: typeof candidate.message === "string"
			? candidate.message
			: "AI_VISUAL_REQUEST_FAILED";
}

function intentKey(input: {
	projectId: string;
	sourceMediaAssetId: string;
	prompt: string;
	motion: string;
	durationSeconds: number;
}) {
	let checksum = 0;
	for (const character of `${input.prompt}|${input.motion}`) {
		checksum = (checksum * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
	}
	return `ai-visual-${input.projectId}-${input.sourceMediaAssetId}-${input.durationSeconds}-${checksum}`;
}

export function AiVisualGenerator({ projectId }: Props) {
	const [sourceMediaAssetId, setSourceMediaAssetId] = useState("");
	const [prompt, setPrompt] = useState("");
	const [motion, setMotion] = useState("subtle natural motion");
	const [durationSeconds, setDurationSeconds] = useState<5 | 10 | 15>(5);
	const [estimate, setEstimate] = useState<AiVisualEstimate | null>(null);
	const [generationId, setGenerationId] = useState<string | null>(null);
	const [uiState, setUiState] = useState<
		| "IDLE"
		| "ESTIMATING"
		| "ESTIMATE_READY"
		| "CONFIRMING"
		| "PENDING"
		| "BLOCKED_BY_GOVERNANCE"
	>("IDLE");

	const media = useQuery(
		orpc.media.list.queryOptions({
			input: {
				projectId,
				mediaType: "image",
				archiveScope: "activeOnly",
				limit: 50,
			},
		}),
	);
	const estimateMutation = useMutation(
		orpc.aiVisual.estimate.mutationOptions({ retry: false }),
	);
	const confirmMutation = useMutation(
		orpc.aiVisual.confirm.mutationOptions({ retry: false }),
	);

	function input() {
		const request = {
			projectId,
			sourceMediaAssetId,
			prompt,
			motion,
			durationSeconds,
			aspectRatio: "9:16" as const,
			idempotencyKey: "placeholder",
		};
		return {
			...request,
			idempotencyKey: intentKey(request),
		};
	}

	function estimateNow() {
		setUiState("ESTIMATING");
		estimateMutation.mutate(input(), {
			onSuccess: (value) => {
				setEstimate(value);
				setUiState("ESTIMATE_READY");
			},
			onError: (error) => {
				setUiState(
					errorCode(error).includes("GOVERNANCE")
						? "BLOCKED_BY_GOVERNANCE"
						: "IDLE",
				);
			},
		});
	}

	function confirmNow() {
		if (!estimate) return;
		setUiState("CONFIRMING");
		confirmMutation.mutate(
			{ generation: input(), estimate, confirmed: true },
			{
				onSuccess: (value) => {
					setGenerationId(value.id);
					setUiState("PENDING");
				},
				onError: (error) => {
					setUiState(
						errorCode(error) === "AI_ESTIMATE_STALE"
							? "IDLE"
							: "BLOCKED_BY_GOVERNANCE",
					);
				},
			},
		);
	}

	return (
		<Card className="border-dashed">
			<CardHeader>
				<div className="flex items-center justify-between gap-3">
					<div>
						<CardTitle>AI Visual · image → video</CardTitle>
						<CardDescription>
							Estimate và explicit confirmation bắt buộc. Provider/model, output
							MIME, budget và release gate không do browser quyết định.
						</CardDescription>
					</div>
					<Badge
						variant={
							uiState === "BLOCKED_BY_GOVERNANCE" ? "warning" : "outline"
						}
					>
						{uiState}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid gap-4 md:grid-cols-2">
					<label className="space-y-1.5">
						<Label htmlFor={`ai-visual-source-${projectId}`}>
							Source image
						</Label>
						<select
							className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
							id={`ai-visual-source-${projectId}`}
							value={sourceMediaAssetId}
							onChange={(event) => {
								setSourceMediaAssetId(event.target.value);
								setEstimate(null);
								setUiState("IDLE");
							}}
						>
							<option value="">Chọn READY image trong project</option>
							{media.data?.items
								.filter((asset) => asset.status === "ready")
								.map((asset) => (
									<option key={asset.id} value={asset.id}>
										{asset.displayName} · {asset.mimeType}
									</option>
								))}
						</select>
					</label>
					<label className="space-y-1.5">
						<Label htmlFor={`ai-visual-duration-${projectId}`}>Duration</Label>
						<select
							className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
							id={`ai-visual-duration-${projectId}`}
							value={durationSeconds}
							onChange={(event) => {
								setDurationSeconds(Number(event.target.value) as 5 | 10 | 15);
								setEstimate(null);
							}}
						>
							<option value={5}>5 seconds</option>
							<option value={10}>10 seconds</option>
							<option value={15}>15 seconds</option>
						</select>
					</label>
				</div>
				<div className="block space-y-1.5">
					<Label htmlFor={`ai-visual-prompt-${projectId}`}>Motion prompt</Label>
					<Input
						id={`ai-visual-prompt-${projectId}`}
						maxLength={2_000}
						placeholder="Ví dụ: camera push-in nhẹ, ánh sáng tự nhiên"
						value={prompt}
						onChange={(event) => {
							setPrompt(event.target.value);
							setEstimate(null);
						}}
					/>
				</div>
				<div className="block space-y-1.5">
					<Label htmlFor={`ai-visual-motion-${projectId}`}>Motion plan</Label>
					<Input
						id={`ai-visual-motion-${projectId}`}
						maxLength={500}
						value={motion}
						onChange={(event) => {
							setMotion(event.target.value);
							setEstimate(null);
						}}
					/>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						disabled={
							!sourceMediaAssetId ||
							!prompt.trim() ||
							estimateMutation.isPending
						}
						onClick={estimateNow}
						variant="outline"
					>
						{estimateMutation.isPending ? "Đang estimate…" : "Estimate cost"}
					</Button>
					<Button
						disabled={
							!estimate || confirmMutation.isPending || uiState === "PENDING"
						}
						onClick={confirmNow}
					>
						{confirmMutation.isPending ? "Đang confirm…" : "Confirm & create"}
					</Button>
				</div>
				{estimate ? (
					<div className="rounded-lg border bg-muted/20 p-3 text-sm">
						<p className="font-medium">
							Estimate ready · {estimate.estimatedCostMicros}{" "}
							{estimate.currency} micros
						</p>
						<p className="mt-1 text-muted-foreground text-xs">
							Server provider/model: {estimate.providerId} / {estimate.modelId}{" "}
							· pricing {estimate.pricingVersion}
						</p>
						<p className="mt-1 text-muted-foreground text-xs">
							Hash: {estimate.requestHash}
						</p>
					</div>
				) : null}
				{generationId ? (
					<p className="text-muted-foreground text-xs">
						Generation {generationId} đã được tạo ở trạng thái PENDING.
						Worker/provider execution không tự kích hoạt từ mount hoặc source
						selection.
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
