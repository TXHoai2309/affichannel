import { Skeleton } from "@affichannel/ui/components/skeleton";

export default function ProjectWorkflowLoading() {
	return (
		<div
			aria-busy="true"
			aria-label="Đang tải workflow project"
			className="mx-auto flex w-full max-w-6xl flex-col gap-6"
			role="status"
		>
			<div className="rounded-xl border bg-card p-4">
				<div className="mb-4 flex items-center justify-between gap-4">
					<div className="flex flex-col gap-2">
						<Skeleton className="h-5 w-36" />
						<Skeleton className="h-3 w-80 max-w-full" />
					</div>
					<Skeleton className="h-5 w-16" />
				</div>
				<div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
					{Array.from({ length: 5 }, (_, index) => (
						<Skeleton className="h-28" key={index} />
					))}
				</div>
			</div>
			<div className="flex flex-col gap-4">
				<Skeleton className="h-8 w-64 max-w-full" />
				<div className="grid gap-4 md:grid-cols-2">
					<Skeleton className="h-64 rounded-2xl" />
					<Skeleton className="h-64 rounded-2xl" />
				</div>
			</div>
		</div>
	);
}
