"use client";

import { Badge } from "@affichannel/ui/components/badge";
import { Card, CardContent, CardHeader } from "@affichannel/ui/components/card";
import {
	Archive,
	FileAudio,
	FileImage,
	FileVideo,
	HardDrive,
	ShieldCheck,
} from "lucide-react";

import {
	formatMediaBytes,
	formatMediaDimensions,
	formatMediaDuration,
	getMediaFailureMessage,
	getMediaRightsLabel,
	getMediaStatusLabel,
	getMediaTypeLabel,
} from "./media-library-helpers";
import type { MediaListItem } from "./media-types";

function MediaTypeIcon({
	mediaType,
}: {
	mediaType: MediaListItem["mediaType"];
}) {
	const Icon =
		mediaType === "image"
			? FileImage
			: mediaType === "video"
				? FileVideo
				: FileAudio;
	return <Icon aria-hidden="true" className="size-7" />;
}

function statusVariant(status: MediaListItem["status"]) {
	if (status === "ready") return "success" as const;
	if (status === "failed") return "destructive" as const;
	if (status === "archived") return "secondary" as const;
	return "warning" as const;
}

export function MediaAssetCard({
	asset,
	onSelect,
}: {
	asset: MediaListItem;
	onSelect: (assetId: string) => void;
}) {
	const dimensions = formatMediaDimensions(asset.width, asset.height);
	const duration = formatMediaDuration(asset.durationMs);
	const isActive = asset.status !== "archived";

	return (
		<button
			aria-label={`Mở chi tiết ${asset.displayName}`}
			className="group block w-full text-left outline-none"
			onClick={() => onSelect(asset.id)}
			type="button"
		>
			<Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring/60">
				<div
					className={[
						"relative flex h-36 items-center justify-center overflow-hidden",
						asset.mediaType === "image"
							? "bg-gradient-to-br from-sky-100 via-blue-50 to-indigo-100 text-blue-700 dark:from-sky-950 dark:via-blue-950 dark:to-indigo-950 dark:text-blue-200"
							: asset.mediaType === "video"
								? "bg-gradient-to-br from-violet-100 via-fuchsia-50 to-pink-100 text-violet-700 dark:from-violet-950 dark:via-fuchsia-950 dark:to-pink-950 dark:text-violet-200"
								: "bg-gradient-to-br from-amber-100 via-orange-50 to-rose-100 text-orange-700 dark:from-amber-950 dark:via-orange-950 dark:to-rose-950 dark:text-orange-200",
					].join(" ")}
				>
					<MediaTypeIcon mediaType={asset.mediaType} />
					<span className="absolute bottom-2 left-2 rounded-full bg-background/85 px-2 py-1 font-medium text-[11px] text-foreground shadow-sm backdrop-blur">
						{getMediaTypeLabel(asset.mediaType)}
					</span>
					{asset.status === "archived" ? (
						<span className="absolute top-2 right-2 rounded-full bg-background/85 p-1.5 text-muted-foreground shadow-sm backdrop-blur">
							<Archive aria-hidden="true" className="size-3.5" />
						</span>
					) : null}
				</div>
				<CardHeader className="gap-3">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<h2 className="truncate font-semibold text-sm tracking-tight">
								{asset.displayName}
							</h2>
							<p className="mt-1 truncate text-muted-foreground text-xs">
								{asset.originalFilename}
							</p>
						</div>
						<Badge variant={statusVariant(asset.status)}>
							{getMediaStatusLabel(asset.status)}
						</Badge>
					</div>
				</CardHeader>
				<CardContent className="mt-auto space-y-2 border-t pt-3 text-muted-foreground text-xs">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span className="inline-flex items-center gap-1">
							<HardDrive aria-hidden="true" className="size-3" />
							{formatMediaBytes(asset.byteSize)}
						</span>
						{dimensions ? <span>{dimensions}</span> : null}
						{duration ? <span>{duration}</span> : null}
					</div>
					<div className="flex items-center justify-between gap-2">
						<span className="inline-flex items-center gap-1">
							<ShieldCheck aria-hidden="true" className="size-3" />
							{getMediaRightsLabel(asset.usageRights)}
						</span>
						{!isActive ? (
							<span className="text-muted-foreground/80">Lịch sử</span>
						) : asset.status === "failed" ? (
							<span className="truncate text-destructive">
								{getMediaFailureMessage(asset)}
							</span>
						) : null}
					</div>
				</CardContent>
			</Card>
		</button>
	);
}
