import { Button } from "@affichannel/ui/components/button";
import Link from "next/link";

export default function ProjectsPage() {
	return (
		<div className="mx-auto w-full max-w-6xl space-y-8">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div className="space-y-2">
					<p className="font-medium text-muted-foreground text-sm">Workflow</p>
					<h1 className="font-semibold text-3xl tracking-tight">Dự án</h1>
					<p className="text-muted-foreground">
						Mở project để theo dõi các bước sản xuất affiliate.
					</p>
				</div>
				<Button render={<Link href="/projects/demo" />}>Mở project demo</Button>
			</div>
			<div className="rounded-xl border bg-card p-6">
				<p className="font-medium">Video Affiliate Tai nghe</p>
				<p className="mt-1 text-muted-foreground text-sm">
					Fixture dùng để kiểm thử navigation trong US002.
				</p>
			</div>
		</div>
	);
}
