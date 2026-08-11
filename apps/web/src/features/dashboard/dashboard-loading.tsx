import { Skeleton } from "@affichannel/ui/components/skeleton";

export default function DashboardLoading() {
	return (
		<div aria-label="Đang tải Dashboard" className="space-y-6" role="status">
			<div className="space-y-2">
				<Skeleton className="h-6 w-44" />
				<Skeleton className="h-4 w-72 max-w-full" />
			</div>
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{Array.from({ length: 4 }, (_, index) => (
					<Skeleton className="h-36 rounded-2xl" key={index} />
				))}
			</div>
			<div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.8fr)]">
				<Skeleton className="h-80 rounded-2xl" />
				<Skeleton className="h-80 rounded-2xl" />
			</div>
		</div>
	);
}
