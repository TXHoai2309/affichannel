import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { CheckCircle2, LockKeyhole, Volume2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

export default function VoiceStepGatePanel({
	projectId,
	completedSegments,
	totalSegments,
}: {
	projectId: string;
	completedSegments: number;
	totalSegments: number;
}) {
	const ready = totalSegments > 0 && completedSegments === totalSegments;
	return (
		<Card className="border-amber-200/80 bg-amber-50/45">
			<CardHeader className="flex flex-row items-start gap-3 space-y-0">
				<div className="rounded-full bg-amber-100 p-2 text-amber-700">
					{ready ? (
						<CheckCircle2 className="size-5" aria-hidden="true" />
					) : (
						<LockKeyhole className="size-5" aria-hidden="true" />
					)}
				</div>
				<div className="min-w-0">
					<CardTitle className="text-lg">
						{ready ? "Voiceover đã sẵn sàng" : "Cần hoàn tất Voiceover"}
					</CardTitle>
					<p className="mt-1 text-muted-foreground text-sm">
						Video chỉ mở sau khi mọi đoạn voiceover hiện tại có audio hoàn tất
						và đúng fingerprint.
					</p>
				</div>
				<Badge className="ml-auto shrink-0" variant="warning">
					Đang khóa
				</Badge>
			</CardHeader>
			<CardContent className="flex flex-wrap items-center gap-3 border-amber-200/70 border-t pt-4">
				<p className="flex items-center gap-2 text-muted-foreground text-sm">
					<Volume2 className="size-4" aria-hidden="true" />
					{completedSegments} / {totalSegments} đoạn đã tạo
				</p>
				<Button
					className="ml-auto"
					nativeButton={false}
					render={<Link href={`/projects/${projectId}/voice` as Route} />}
				>
					Mở Voice Studio
				</Button>
			</CardContent>
		</Card>
	);
}
