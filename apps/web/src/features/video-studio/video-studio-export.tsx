import type { preflightCompositionVersion } from "@affichannel/api/services/composition-preflight-service";
import type { CompositionVersionReadModel } from "@affichannel/api/services/composition-version-repository";
import type { WorkspaceActor } from "@affichannel/api/services/workspace";
import { Badge } from "@affichannel/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { LockKeyhole } from "lucide-react";

import QuickImageRenderController from "@/features/render/quick-image-render-controller";

type Preflight = Awaited<ReturnType<typeof preflightCompositionVersion>>;

type Props = Readonly<{
	projectId: string;
	creationPath: string | null;
	compositionVersion: CompositionVersionReadModel | undefined;
	actor: WorkspaceActor | undefined;
	preflight: Preflight | null;
}>;

function PreflightCard({ preflight }: { preflight: Preflight | null }) {
	if (!preflight) {
		return (
			<Card className="border-dashed">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-base">
						<LockKeyhole aria-hidden="true" className="size-4" />
						Preflight chưa sẵn sàng
					</CardTitle>
					<CardDescription>
						Chưa có CompositionVersion hợp lệ để kiểm tra.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-3">
					<CardTitle>Preflight</CardTitle>
					<Badge
						variant={
							preflight.authorization.allowed ? "success" : "destructive"
						}
					>
						{preflight.authorization.allowed ? "PASS" : "BLOCKED"}
					</Badge>
				</div>
				<CardDescription>
					Read-only result từ Composition/Applicability/Fact Lock authority.
				</CardDescription>
			</CardHeader>
			<CardContent className="text-sm">
				<p>Currentness: {preflight.currentness.state}</p>
				<p>Authorization: {preflight.authorization.reasonCode}</p>
			</CardContent>
		</Card>
	);
}

export default function VideoStudioExport({
	projectId,
	creationPath,
	compositionVersion,
	actor,
	preflight,
}: Props) {
	const isQuickImage =
		creationPath === "QUICK_IMAGE" &&
		compositionVersion?.schemaVersion === "composition-input.v2";
	const unavailable =
		creationPath === "MEDIA_FIRST" ||
		(creationPath !== "QUICK_IMAGE" && creationPath !== "SCRIPTED") ||
		(Boolean(compositionVersion) &&
			((creationPath === "QUICK_IMAGE" &&
				compositionVersion?.schemaVersion !== "composition-input.v2") ||
				(creationPath === "SCRIPTED" &&
					compositionVersion?.schemaVersion !== "composition-input.v1")));
	return (
		<div className="space-y-4">
			<PreflightCard preflight={preflight} />
			{unavailable ? (
				<Card className="border-dashed">
					<CardHeader>
						<CardTitle>Export chưa khả dụng</CardTitle>
						<CardDescription>
							{creationPath === "MEDIA_FIRST"
								? "MEDIA_FIRST đang chờ vertical slice; không có render action hoặc retry."
								: "CreationPath chưa được xác định an toàn; không có render action hoặc retry."}
						</CardDescription>
					</CardHeader>
				</Card>
			) : isQuickImage && actor && compositionVersion ? (
				<QuickImageRenderController
					compositionVersionId={compositionVersion.id}
					projectId={projectId}
				/>
			) : (
				<Card className="border-dashed">
					<CardHeader>
						<CardTitle>EN-001 Export status</CardTitle>
						<CardDescription>
							Scripted render tiếp tục dùng CompositionVersion v1 và lifecycle
							EN-001 hiện hữu. Studio không encode đồng bộ và không tự retry.
						</CardDescription>
					</CardHeader>
				</Card>
			)}
		</div>
	);
}
