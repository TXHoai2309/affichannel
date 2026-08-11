"use client";

import { Button } from "@affichannel/ui/components/button";
import { Card, CardContent } from "@affichannel/ui/components/card";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function DashboardError({ onRetry }: { onRetry: () => void }) {
	return (
		<Card className="rounded-2xl border-destructive/20 shadow-sm">
			<CardContent className="flex flex-col items-center gap-4 p-10 text-center">
				<span className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
					<AlertCircle aria-hidden="true" className="size-5" />
				</span>
				<div className="space-y-1">
					<h2 className="font-semibold text-lg">Không thể tải Dashboard</h2>
					<p className="text-muted-foreground text-sm">
						Đã có lỗi khi tải dữ liệu. Bạn có thể thử lại ngay.
					</p>
				</div>
				<Button onClick={onRetry} type="button" variant="outline">
					<RefreshCw aria-hidden="true" />
					Thử lại
				</Button>
			</CardContent>
		</Card>
	);
}
