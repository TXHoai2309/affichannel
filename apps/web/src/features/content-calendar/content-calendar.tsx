"use client";

import {
	addCalendarDays,
	type PlannedContentItemReadModel,
} from "@affichannel/core";
import { Button } from "@affichannel/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { orpc } from "@/utils/orpc";

function formatDay(date: string) {
	return new Intl.DateTimeFormat("vi-VN", {
		weekday: "short",
		day: "2-digit",
		month: "2-digit",
	}).format(new Date(`${date}T12:00:00Z`));
}

function itemLabel(item: PlannedContentItemReadModel) {
	return `${item.contentType} · ${item.pillar}`;
}

export function ContentCalendar() {
	const queryClient = useQueryClient();
	const [message, setMessage] = useState<string | null>(null);
	const [draggedItem, setDraggedItem] = useState<string | null>(null);
	const plan = useQuery(
		orpc.contentCalendar.get7DayPlan.queryOptions({
			input: {},
			meta: { suppressGlobalErrorToast: true },
		}),
	);
	const products = useQuery(
		orpc.product.listMinimal.queryOptions({ input: { selectableOnly: true } }),
	);
	const generate = useMutation(
		orpc.contentCalendar.generatePlan.mutationOptions({
			onSuccess: (next) => {
				queryClient.setQueryData(
					orpc.contentCalendar.get7DayPlan.queryKey({ input: {} }),
					next,
				);
				setMessage("Đã tạo lại kế hoạch deterministic cho 7 ngày.");
			},
			onError: () =>
				setMessage("Không thể tạo kế hoạch. Hãy kiểm tra Channel Strategy."),
		}),
	);
	const move = useMutation(
		orpc.contentCalendar.moveItem.mutationOptions({
			onMutate: async (input) => {
				const queryKey = orpc.contentCalendar.get7DayPlan.queryKey({
					input: {},
				});
				await queryClient.cancelQueries({ queryKey });
				const previous = queryClient.getQueryData(queryKey);
				queryClient.setQueryData(queryKey, (current) =>
					current
						? {
								...current,
								items: current.items.map((item) =>
									item.id === input.id
										? {
												...item,
												scheduledDate: input.scheduledDate,
												scheduledTime: input.scheduledTime,
												version: item.version + 1,
											}
										: item,
								),
							}
						: current,
				);
				return { previous };
			},
			onSuccess: (next) => {
				queryClient.setQueryData(
					orpc.contentCalendar.get7DayPlan.queryKey({ input: {} }),
					(current) =>
						current
							? {
									...current,
									items: current.items.map((item) =>
										item.id === next.id ? next : item,
									),
								}
							: current,
				);
				setMessage(null);
			},
			onError: async (_error, _input, context) => {
				const queryKey = orpc.contentCalendar.get7DayPlan.queryKey({
					input: {},
				});
				if (context?.previous) {
					queryClient.setQueryData(queryKey, context.previous);
				}
				setMessage(
					"Lịch đã thay đổi ở nơi khác; đã tải lại dữ liệu canonical.",
				);
				await queryClient.invalidateQueries({
					queryKey: orpc.contentCalendar.get7DayPlan.queryKey({ input: {} }),
				});
			},
		}),
	);
	const convert = useMutation(
		orpc.contentCalendar.convertToProject.mutationOptions({
			onSuccess: async (result) => {
				setMessage(
					result.status === "ALREADY_CONVERTED"
						? "Item đã được convert; giữ nguyên Project hiện có."
						: "Đã tạo Project từ planned item.",
				);
				await queryClient.invalidateQueries({
					queryKey: orpc.contentCalendar.get7DayPlan.queryKey({ input: {} }),
				});
			},
			onError: () =>
				setMessage("Không thể convert. Affiliate item cần Product hợp lệ."),
		}),
	);
	const attachProduct = useMutation(
		orpc.contentCalendar.attachProduct.mutationOptions({
			onSuccess: (next) => {
				queryClient.setQueryData(
					orpc.contentCalendar.get7DayPlan.queryKey({ input: {} }),
					(current) =>
						current
							? {
									...current,
									items: current.items.map((item) =>
										item.id === next.id ? next : item,
									),
								}
							: current,
				);
				setMessage("Đã cập nhật Product theo policy hiện hành.");
			},
			onError: async () => {
				setMessage(
					"Product không hợp lệ hoặc item đã đổi version; đã tải lại calendar.",
				);
				await queryClient.invalidateQueries({
					queryKey: orpc.contentCalendar.get7DayPlan.queryKey({ input: {} }),
				});
			},
		}),
	);

	const days = useMemo(() => {
		if (!plan.data) return [];
		return Array.from({ length: 7 }, (_, index) =>
			addCalendarDays(plan.data.window.startDate, index),
		);
	}, [plan.data]);

	function moveItemTo(item: PlannedContentItemReadModel, date: string) {
		setMessage(null);
		move.mutate({
			id: item.id,
			scheduledDate: date,
			scheduledTime: item.scheduledTime,
			expectedVersion: item.version,
		});
	}

	if (plan.isLoading) {
		return (
			<div className="rounded-2xl border p-6 text-muted-foreground">
				Đang tải calendar…
			</div>
		);
	}
	if (plan.isError || !plan.data) {
		return (
			<div className="rounded-2xl border border-destructive/40 p-6 text-destructive">
				Không thể tải calendar.
			</div>
		);
	}

	return (
		<section className="space-y-5" aria-label="7-day content calendar">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-muted-foreground text-sm">
						{plan.data.window.timezone}
					</p>
					<h1 className="font-semibold text-2xl tracking-tight">
						7-day Content Calendar
					</h1>
					<p className="text-muted-foreground text-sm">
						{plan.data.window.startDate} → {plan.data.window.endDate}
					</p>
				</div>
				<Button
					disabled={generate.isPending || plan.data.strategyVersion === null}
					onClick={() =>
						generate.mutate({
							startDate: plan.data.window.startDate,
							expectedStrategyVersion: plan.data.strategyVersion ?? undefined,
						})
					}
				>
					{generate.isPending ? "Đang tạo…" : "Generate deterministic plan"}
				</Button>
			</div>

			{plan.data.strategyVersion === null ? (
				<div className="rounded-xl border border-dashed p-4 text-sm">
					Chưa có Channel Strategy. Hãy cấu hình strategy trước khi generate
					plan.
				</div>
			) : null}
			{plan.data.mix.deviates ? (
				<div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-amber-900 text-sm">
					Mix planned hiện lệch target Channel Strategy. Đây là cảnh báo thông
					tin; không tự động rewrite kế hoạch.
				</div>
			) : null}
			{message ? <p className="text-sm">{message}</p> : null}

			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
				{days.map((day) => {
					const items = plan.data.items.filter(
						(item) => item.scheduledDate === day,
					);
					return (
						<div
							aria-label={`Ngày ${day}`}
							className="min-h-56 rounded-2xl border bg-card p-3"
							key={day}
							role="listbox"
							onDragOver={(event) => event.preventDefault()}
							onDrop={() => {
								if (!draggedItem) return;
								const item = plan.data.items.find(
									(candidate) => candidate.id === draggedItem,
								);
								if (item && item.scheduledDate !== day) moveItemTo(item, day);
								setDraggedItem(null);
							}}
						>
							<div className="mb-3 border-b pb-2 font-medium text-sm">
								{formatDay(day)}
							</div>
							<div className="space-y-2">
								{items.map((item) => (
									<article
										className="rounded-xl border bg-background p-3 text-xs shadow-sm"
										draggable
										key={item.id}
										onDragStart={() => setDraggedItem(item.id)}
									>
										<div className="flex items-start justify-between gap-2">
											<strong className="line-clamp-2">{item.title}</strong>
											<span className="text-muted-foreground">
												{item.scheduledTime}
											</span>
										</div>
										<p className="mt-1 text-muted-foreground">
											{itemLabel(item)}
										</p>
										<p className="text-muted-foreground">
											{item.creationPath} · {item.contentFormat.key}
										</p>
										<p className="text-muted-foreground">
											Series: {item.series ?? "—"}
										</p>
										<p className="text-muted-foreground">
											{item.conversionState === "CONVERTED"
												? "Đã convert"
												: item.productId
													? "Có Product"
													: "Chưa có Product"}
										</p>
										{item.contentType === "AFFILIATE" ? (
											<label className="mt-2 block text-muted-foreground">
												Product
												<select
													aria-label={`Product cho ${item.title}`}
													className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-foreground text-xs"
													disabled={
														attachProduct.isPending ||
														item.conversionState === "CONVERTED"
													}
													value={item.productId ?? ""}
													onChange={(event) =>
														attachProduct.mutate({
															id: item.id,
															productId: event.target.value || null,
															expectedVersion: item.version,
														})
													}
												>
													<option value="">Chọn Product</option>
													{(products.data ?? []).map((product) => (
														<option key={product.id} value={product.id}>
															{product.name}
														</option>
													))}
												</select>
											</label>
										) : null}
										<div className="mt-2 flex flex-wrap gap-1">
											{days
												.filter((candidate) => candidate !== day)
												.slice(0, 2)
												.map((target) => (
													<Button
														key={target}
														className="h-7 px-2 text-[11px]"
														variant="outline"
														disabled={move.isPending}
														onClick={() => moveItemTo(item, target)}
													>
														→ {formatDay(target)}
													</Button>
												))}
											<Button
												className="h-7 px-2 text-[11px]"
												disabled={
													convert.isPending ||
													item.conversionState === "CONVERTED"
												}
												onClick={() =>
													convert.mutate({
														id: item.id,
														expectedVersion: item.version,
													})
												}
											>
												{item.conversionState === "CONVERTED"
													? "Project linked"
													: "Convert Project"}
											</Button>
										</div>
									</article>
								))}
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}
