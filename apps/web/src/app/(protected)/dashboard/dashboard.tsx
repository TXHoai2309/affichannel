"use client";

import { Badge } from "@affichannel/ui/components/badge";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

export default function DashboardData() {
	const privateData = useQuery(orpc.privateData.queryOptions());

	return (
		<section className="rounded-xl border bg-card p-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p className="font-medium">Kết nối workspace</p>
					<p className="mt-1 text-muted-foreground text-sm">
						Protected procedure đang hoạt động.
					</p>
				</div>
				<Badge variant={privateData.isError ? "destructive" : "success"}>
					{privateData.isPending
						? "Đang kiểm tra"
						: privateData.isError
							? "Lỗi kết nối"
							: "Đã kết nối"}
				</Badge>
			</div>
			<p className="mt-5 border-t pt-4 text-muted-foreground text-sm">
				{privateData.isPending
					? "Đang tải trạng thái API…"
					: (privateData.data?.message ?? "Chưa có phản hồi từ API.")}
			</p>
		</section>
	);
}
