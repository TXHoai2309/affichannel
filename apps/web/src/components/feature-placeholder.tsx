import { Badge } from "@affichannel/ui/components/badge";

export default function FeaturePlaceholder({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<div className="mx-auto w-full max-w-6xl space-y-8">
			<div className="space-y-2">
				<Badge variant="outline">Đang chuẩn bị</Badge>
				<h1 className="font-semibold text-3xl tracking-tight">{title}</h1>
				<p className="max-w-2xl text-muted-foreground">{description}</p>
			</div>
			<div className="rounded-xl border border-dashed bg-card p-8">
				<p className="font-medium">Feature đang được phát triển</p>
				<p className="mt-2 max-w-xl text-muted-foreground text-sm">
					US002 đã chuẩn bị route và app shell. Business logic sẽ được triển
					khai ở các slice tương ứng.
				</p>
			</div>
		</div>
	);
}
