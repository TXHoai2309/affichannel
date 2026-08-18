import type { FactLockGateResult } from "@affichannel/core";
import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import {
	CheckCircle2,
	LockKeyhole,
	RefreshCw,
	ShieldAlert,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

const REASON_COPY: Record<
	Exclude<FactLockGateResult["reason"], "FACT_LOCK_PASSED">,
	{ title: string; description: string }
> = {
	NO_SCRIPT_VERSION: {
		title: "Chưa có bản script",
		description:
			"Hãy tạo hoặc khởi tạo ScriptVersion trước khi chuyển sang bước này.",
	},
	SCRIPT_NOT_READY: {
		title: "Script chưa sẵn sàng",
		description: "Script còn thiếu trường bắt buộc hoặc chưa chọn hook hợp lệ.",
	},
	FACT_LOCK_NOT_RUN: {
		title: "Chưa chạy Fact Lock",
		description:
			"Cần đối chiếu nội dung với Product Facts trước khi tạo giọng đọc hoặc dựng video.",
	},
	FACT_LOCK_PENDING: {
		title: "Fact Lock đang xử lý",
		description:
			"Kết quả đối chiếu chưa hoàn tất. Bạn có thể quay lại sau ít phút.",
	},
	FACT_LOCK_REVIEW_REQUIRED: {
		title: "Fact Lock cần review",
		description:
			"Một hoặc nhiều claim chưa được xử lý. Hãy review và duyệt claim trước khi tiếp tục.",
	},
	FACT_LOCK_STALE_SCRIPT: {
		title: "Fact Lock đã cũ theo script",
		description:
			"Script đã thay đổi sau lần đối chiếu gần nhất. Hãy chạy lại Fact Lock.",
	},
	FACT_LOCK_STALE_FACTS: {
		title: "Fact Lock đã cũ theo Product Facts",
		description:
			"Product Facts nguồn đã thay đổi hoặc không còn active. Hãy chạy lại Fact Lock.",
	},
	FACT_LOCK_FAILED: {
		title: "Fact Lock không thành công",
		description:
			"Lần đối chiếu gần nhất thất bại. Hãy thử chạy lại từ Fact Lock.",
	},
	FACT_LOCK_INDETERMINATE: {
		title: "Chưa xác định được kết quả",
		description:
			"Không thể xác nhận kết quả Fact Lock. Hãy kiểm tra lại trạng thái và chạy lại.",
	},
};

export default function FactLockGatePanel({
	projectId,
	gate,
	stepLabel,
}: {
	projectId: string;
	gate: FactLockGateResult;
	stepLabel: string;
}) {
	if (gate.allowed) {
		return (
			<Card className="border-emerald-200/80 bg-emerald-50/40">
				<CardContent className="flex items-center gap-3 p-6">
					<CheckCircle2
						className="size-5 text-emerald-600"
						aria-hidden="true"
					/>
					<div>
						<p className="font-medium">Fact Lock đã đạt</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Bước {stepLabel.toLowerCase()} có thể tiếp tục với script và
							Product Facts hiện tại.
						</p>
					</div>
					<Badge className="ml-auto" variant="success">
						Đã mở khóa
					</Badge>
				</CardContent>
			</Card>
		);
	}

	const copy = REASON_COPY[gate.reason as keyof typeof REASON_COPY];
	return (
		<Card className="border-amber-200/80 bg-amber-50/45">
			<CardHeader className="flex flex-row items-start gap-3 space-y-0">
				<div className="rounded-full bg-amber-100 p-2 text-amber-700">
					<LockKeyhole className="size-5" aria-hidden="true" />
				</div>
				<div className="min-w-0">
					<CardTitle className="text-lg">{copy.title}</CardTitle>
					<p className="mt-1 text-muted-foreground text-sm">
						{copy.description}
					</p>
				</div>
				<Badge className="ml-auto shrink-0" variant="warning">
					Đang khóa
				</Badge>
			</CardHeader>
			<CardContent className="flex flex-wrap items-center gap-3 border-amber-200/70 border-t pt-4">
				<p className="flex items-center gap-2 text-muted-foreground text-sm">
					<ShieldAlert className="size-4" aria-hidden="true" />
					Voice, Video và Preview chỉ mở khi gate đạt.
				</p>
				<Button
					className="ml-auto"
					nativeButton={false}
					render={<Link href={`/projects/${projectId}/fact-lock` as Route} />}
				>
					<RefreshCw aria-hidden="true" />
					Mở Fact Lock
				</Button>
			</CardContent>
		</Card>
	);
}
