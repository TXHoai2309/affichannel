"use client";

import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

function statusVariant(status: string) {
	if (status === "COMPLETED") return "success" as const;
	if (status === "FAILED") return "destructive" as const;
	if (status === "INDETERMINATE") return "warning" as const;
	return "outline" as const;
}

export function AiOperationsDashboard() {
	const queryClient = useQueryClient();
	const operations = useQuery(
		orpc.aiGovernance.operations.list.queryOptions({
			input: {},
			meta: { suppressGlobalErrorToast: true },
		}),
	);
	const budget = useQuery(
		orpc.aiGovernance.budget.get.queryOptions({
			meta: { suppressGlobalErrorToast: true },
		}),
	);
	const gate = useQuery(
		orpc.aiGovernance.releaseGate.get.queryOptions({
			meta: { suppressGlobalErrorToast: true },
		}),
	);
	const reconcile = useMutation(
		orpc.aiGovernance.operations.reconcile.mutationOptions(),
	);

	function reconcileOperation(id: string) {
		reconcile.mutate(
			{ id, action: "RECONCILE" },
			{
				onSuccess: () => {
					void queryClient.invalidateQueries({
						queryKey: orpc.aiGovernance.operations.list.queryKey(),
					});
					void queryClient.invalidateQueries({
						queryKey: orpc.aiGovernance.budget.get.queryKey(),
					});
				},
			},
		);
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-3">
					<div>
						<CardTitle>AI operations & safety ledger</CardTitle>
						<CardDescription>
							Estimate, reservation, provider request ID, usage và recovery theo
							workspace. INDETERMINATE không có nút retry mù.
						</CardDescription>
					</div>
					<Badge
						variant={gate.data?.paidExecutionReleased ? "success" : "warning"}
					>
						{gate.data?.paidExecutionReleased
							? "RELEASED"
							: "PAID RELEASE BLOCKED"}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid gap-3 text-sm md:grid-cols-4">
					<div className="rounded-lg border p-3">
						<p className="text-muted-foreground text-xs">Budget limit</p>
						<p className="mt-1 font-semibold">
							{budget.data?.budgetLimitMicros ?? 0}
						</p>
					</div>
					<div className="rounded-lg border p-3">
						<p className="text-muted-foreground text-xs">Reserved</p>
						<p className="mt-1 font-semibold">
							{budget.data?.reservedMicros ?? 0}
						</p>
					</div>
					<div className="rounded-lg border p-3">
						<p className="text-muted-foreground text-xs">Settled</p>
						<p className="mt-1 font-semibold">
							{budget.data?.settledMicros ?? 0}
						</p>
					</div>
					<div className="rounded-lg border p-3">
						<p className="text-muted-foreground text-xs">Uncertain</p>
						<p className="mt-1 font-semibold">
							{budget.data?.uncertainMicros ?? 0}
						</p>
					</div>
				</div>
				{operations.isLoading && (
					<p className="text-muted-foreground text-sm">
						Đang tải operation ledger…
					</p>
				)}
				{operations.isError && (
					<p className="text-destructive text-sm">
						Không thể tải operation ledger.
					</p>
				)}
				{operations.data?.length === 0 && (
					<p className="text-muted-foreground text-sm">
						Chưa có operation nào.
					</p>
				)}
				{operations.data && operations.data.length > 0 && (
					<div className="overflow-x-auto rounded-lg border">
						<table className="w-full text-left text-xs">
							<thead className="border-b bg-muted/30 text-muted-foreground">
								<tr>
									<th className="p-3">Operation</th>
									<th className="p-3">Provider / model</th>
									<th className="p-3">Status</th>
									<th className="p-3">Estimate → actual</th>
									<th className="p-3">Recovery</th>
								</tr>
							</thead>
							<tbody>
								{operations.data.map((operation) => (
									<tr className="border-b last:border-0" key={operation.id}>
										<td className="p-3">
											<p className="font-medium">{operation.operationKind}</p>
											<p className="text-muted-foreground">
												{operation.id.slice(0, 8)} ·{" "}
												{operation.correlationId.slice(0, 8)}
											</p>
										</td>
										<td className="p-3">
											{operation.providerId}
											<br />
											<span className="text-muted-foreground">
												{operation.modelId}
											</span>
										</td>
										<td className="p-3">
											<Badge variant={statusVariant(operation.status)}>
												{operation.status}
											</Badge>
											<p className="mt-1 text-muted-foreground">
												{operation.callStage}
											</p>
										</td>
										<td className="p-3">
											{operation.estimatedCostMicros ?? 0} →{" "}
											{operation.actualCostMicros ?? "—"}{" "}
											{operation.currency ?? ""}
											<br />
											<span className="text-muted-foreground">
												{operation.providerRequestId ??
													"no provider request id"}
											</span>
										</td>
										<td className="p-3">
											{operation.status === "INDETERMINATE" ? (
												<Button
													size="sm"
													variant="outline"
													disabled={reconcile.isPending}
													onClick={() => reconcileOperation(operation.id)}
												>
													Review / reconcile
												</Button>
											) : (
												<span className="text-muted-foreground">—</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				{reconcile.isError && (
					<p className="text-destructive text-xs" role="alert">
						Không thể reconcile operation; cần kiểm tra evidence server.
					</p>
				)}
			</CardContent>
		</Card>
	);
}
