import { createQuickImageCompositionPreviewDescriptor } from "@affichannel/api/services/composition-preview-descriptor";
import type { CompositionVersionReadModel } from "@affichannel/api/services/composition-version-repository";
import type { WorkspaceActor } from "@affichannel/api/services/workspace";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { LockKeyhole } from "lucide-react";

import QuickImagePreviewPlayer from "@/features/composition/quick-image-preview-player";

type Props = Readonly<{
	projectId: string;
	creationPath: string | null;
	compositionVersion: CompositionVersionReadModel | undefined;
	actor: WorkspaceActor | undefined;
}>;

function EmptyCompose({ description }: { description: string }) {
	return (
		<div className="rounded-xl border border-dashed p-6">
			<div className="flex items-center gap-2 font-medium text-sm">
				<LockKeyhole aria-hidden="true" className="size-4" />
				Compose chưa khả dụng
			</div>
			<p className="mt-2 max-w-2xl text-muted-foreground text-sm">
				{description}
			</p>
		</div>
	);
}

export default async function VideoStudioCompose({
	projectId,
	creationPath,
	compositionVersion,
	actor,
}: Props) {
	if (creationPath === "MEDIA_FIRST") {
		return (
			<EmptyCompose description="MEDIA_FIRST chưa có vertical slice trong US23. Compose không tự route sang Quick Image hoặc Scripted và không tạo render." />
		);
	}
	if (creationPath !== "QUICK_IMAGE" && creationPath !== "SCRIPTED") {
		return (
			<EmptyCompose description="CreationPath chưa được xác định an toàn; Compose bị khóa." />
		);
	}
	if (!compositionVersion) {
		return (
			<EmptyCompose description="Chưa có CompositionVersion persisted cho project. Video Studio không tự dựng composition ở client." />
		);
	}

	if (
		compositionVersion.schemaVersion === "composition-input.v1" &&
		creationPath !== "SCRIPTED"
	) {
		return (
			<EmptyCompose description="Composition schema không khớp CreationPath; Compose fail-closed." />
		);
	}

	if (compositionVersion.schemaVersion === "composition-input.v1") {
		return (
			<Card className="border-dashed">
				<CardHeader>
					<CardTitle>Scripted CompositionVersion</CardTitle>
					<CardDescription>
						Compose giữ nguyên CompositionVersion v1 và EN-001 semantics hiện
						hữu.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					<p className="text-muted-foreground">
						Preview Scripted tiếp tục đi qua entrypoint hiện hữu; shell không
						tạo renderer mới.
					</p>
					<p className="font-mono text-xs">
						CompositionVersion: {compositionVersion.id}
					</p>
				</CardContent>
			</Card>
		);
	}

	if (
		creationPath !== "QUICK_IMAGE" ||
		!actor ||
		compositionVersion.projectId !== projectId
	) {
		return (
			<EmptyCompose description="CompositionVersion không thuộc project hoặc không thể xác thực quyền truy cập." />
		);
	}

	try {
		const descriptor = await createQuickImageCompositionPreviewDescriptor(
			actor,
			projectId,
			compositionVersion.id,
		);
		return (
			<div className="space-y-3">
				<p className="text-muted-foreground text-sm">
					Preview dùng đúng CompositionVersion v2 persisted; không có per-frame
					network hay client-side reconstruction.
				</p>
				<QuickImagePreviewPlayer descriptor={descriptor} />
			</div>
		);
	} catch {
		return (
			<EmptyCompose description="CompositionVersion v2 không thể mở preview an toàn. Không tạo render hoặc fallback sang Scripted." />
		);
	}
}
