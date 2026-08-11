import { auth } from "@affichannel/auth";
import { headers } from "next/headers";

import DashboardData from "./dashboard";

export default async function DashboardPage() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	return (
		<div className="mx-auto w-full max-w-6xl space-y-8">
			<div className="space-y-2">
				<p className="font-medium text-muted-foreground text-sm">
					Workspace overview
				</p>
				<h1 className="font-semibold text-3xl tracking-tight">Dashboard</h1>
				<p className="text-muted-foreground">
					Chào {session?.user.name}. Đây là điểm bắt đầu cho quy trình sản xuất.
				</p>
			</div>
			<DashboardData />
		</div>
	);
}
