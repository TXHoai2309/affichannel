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
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { orpc } from "@/utils/orpc";

type FormValues = {
	providerId: string;
	modelId: string;
	providerEnabled: boolean;
	modelEnabled: boolean;
	killSwitch: boolean;
	pricingVersion: string;
	budgetLimitMicros: string;
	budgetCurrency: string;
};

const INITIAL_VALUES: FormValues = {
	providerId: "deterministic",
	modelId: "deterministic-text-v1",
	providerEnabled: false,
	modelEnabled: false,
	killSwitch: true,
	pricingVersion: "deterministic-text.v1",
	budgetLimitMicros: "0",
	budgetCurrency: "VND",
};

function errorMessage(error: unknown) {
	if (!error || typeof error !== "object")
		return "Không thể lưu governance settings.";
	const candidate = error as { message?: unknown; data?: { code?: unknown } };
	return typeof candidate.message === "string"
		? candidate.message
		: typeof candidate.data?.code === "string"
			? candidate.data.code
			: "Không thể lưu governance settings.";
}

export function AiGovernanceSettings() {
	const queryClient = useQueryClient();
	const settings = useQuery(
		orpc.aiGovernance.settings.get.queryOptions({
			meta: { suppressGlobalErrorToast: true },
		}),
	);
	const registry = useQuery(
		orpc.aiGovernance.registry.list.queryOptions({
			meta: { suppressGlobalErrorToast: true },
		}),
	);
	const budget = useQuery(
		orpc.aiGovernance.budget.get.queryOptions({
			meta: { suppressGlobalErrorToast: true },
		}),
	);
	const save = useMutation(orpc.aiGovernance.settings.update.mutationOptions());
	const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		if (!settings.data) return;
		setValues({
			providerId: settings.data.providerId,
			modelId: settings.data.modelId,
			providerEnabled: settings.data.providerEnabled,
			modelEnabled: settings.data.modelEnabled,
			killSwitch: settings.data.killSwitch,
			pricingVersion: settings.data.pricingVersion ?? "deterministic-text.v1",
			budgetLimitMicros: String(settings.data.budgetLimitMicros),
			budgetCurrency: settings.data.budgetCurrency,
		});
	}, [settings.data]);

	const selectedProvider = useMemo(
		() =>
			registry.data?.providers.find(
				(provider) => provider.providerId === values.providerId,
			),
		[registry.data?.providers, values.providerId],
	);
	const selectedModel = selectedProvider?.models.find(
		(model) => model.modelId === values.modelId,
	);
	const pricingOptions =
		registry.data?.pricing.filter(
			(pricing) =>
				pricing.providerId === values.providerId &&
				pricing.modelId === values.modelId,
		) ?? [];

	function update(field: keyof FormValues, value: string | boolean) {
		setValues((current) => ({ ...current, [field]: value }));
		setSaved(false);
	}

	function submit() {
		save.mutate(
			{
				expectedVersion: settings.data?.version ? settings.data.version : null,
				providerId: values.providerId as "deterministic" | "apikeyfun",
				modelId: values.modelId,
				providerEnabled: values.providerEnabled,
				modelEnabled: values.modelEnabled,
				killSwitch: values.killSwitch,
				pricingVersion: values.pricingVersion,
				budgetPeriod: "MONTHLY",
				budgetLimitMicros: Number(values.budgetLimitMicros),
				budgetCurrency: values.budgetCurrency,
			},
			{
				onSuccess: () => {
					setSaved(true);
					void queryClient.invalidateQueries({
						queryKey: orpc.aiGovernance.settings.get.queryKey(),
					});
					void queryClient.invalidateQueries({
						queryKey: orpc.aiGovernance.budget.get.queryKey(),
					});
				},
			},
		);
	}

	if (settings.isLoading || registry.isLoading) {
		return (
			<Card>
				<CardContent className="py-6 text-muted-foreground">
					Đang tải AI governance…
				</CardContent>
			</Card>
		);
	}
	if (settings.isError || registry.isError || !registry.data) {
		return (
			<Card>
				<CardContent className="py-6 text-destructive">
					Không thể tải registry governance server-owned.
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-3">
					<div>
						<CardTitle>AI provider governance</CardTitle>
						<CardDescription>
							Registry, pricing, kill switch và ngân sách đều do server quyết
							định. Secret không được hiển thị.
						</CardDescription>
					</div>
					<Badge variant={values.killSwitch ? "warning" : "success"}>
						{values.killSwitch ? "KILL SWITCH ON" : "GOVERNED"}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-5">
				<div className="grid gap-4 md:grid-cols-2">
					<label className="space-y-1.5">
						<Label>Provider</Label>
						<select
							className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
							value={values.providerId}
							onChange={(event) => {
								const providerId = event.target.value;
								const provider = registry.data.providers.find(
									(item) => item.providerId === providerId,
								);
								const model = provider?.models[0];
								update("providerId", providerId);
								if (model) {
									setValues((current) => ({
										...current,
										providerId,
										modelId: model.modelId,
										pricingVersion:
											model.pricingVersions[0] ?? current.pricingVersion,
										budgetCurrency:
											registry.data.pricing.find(
												(item) =>
													item.pricingVersion === model.pricingVersions[0],
											)?.currency ?? current.budgetCurrency,
									}));
								}
							}}
						>
							{registry.data.providers.map((provider) => (
								<option key={provider.providerId} value={provider.providerId}>
									{provider.displayName}
									{provider.paid ? " · paid" : " · test-only"}
								</option>
							))}
						</select>
					</label>
					<label className="space-y-1.5">
						<Label>Model</Label>
						<select
							className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
							value={values.modelId}
							onChange={(event) => {
								const modelId = event.target.value;
								const pricing = registry.data.pricing.find(
									(item) =>
										item.providerId === values.providerId &&
										item.modelId === modelId,
								);
								setValues((current) => ({
									...current,
									modelId,
									pricingVersion:
										pricing?.pricingVersion ?? current.pricingVersion,
									budgetCurrency: pricing?.currency ?? current.budgetCurrency,
								}));
							}}
						>
							{selectedProvider?.models.map((model) => (
								<option key={model.modelId} value={model.modelId}>
									{model.modelId}
								</option>
							))}
						</select>
					</label>
				</div>
				<div className="grid gap-4 md:grid-cols-2">
					<label className="space-y-1.5">
						<Label>Pricing version</Label>
						<select
							className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
							value={values.pricingVersion}
							onChange={(event) => update("pricingVersion", event.target.value)}
						>
							{pricingOptions.map((pricing) => (
								<option
									key={pricing.pricingVersion}
									value={pricing.pricingVersion}
								>
									{pricing.pricingVersion} · {pricing.currency} / {pricing.unit}
								</option>
							))}
						</select>
					</label>
					<div className="space-y-1.5">
						<Label htmlFor="ai-budget-limit">Monthly budget (micros)</Label>
						<Input
							id="ai-budget-limit"
							inputMode="numeric"
							min="0"
							value={values.budgetLimitMicros}
							onChange={(event) =>
								update("budgetLimitMicros", event.target.value)
							}
						/>
					</div>
				</div>
				<div className="flex flex-wrap gap-4 text-sm">
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={values.providerEnabled}
							onChange={(event) =>
								update("providerEnabled", event.target.checked)
							}
						/>{" "}
						Provider enabled
					</label>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={values.modelEnabled}
							onChange={(event) => update("modelEnabled", event.target.checked)}
						/>{" "}
						Model enabled
					</label>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={values.killSwitch}
							onChange={(event) => update("killSwitch", event.target.checked)}
						/>{" "}
						Kill switch
					</label>
				</div>
				<div className="rounded-lg border bg-muted/30 p-3 text-muted-foreground text-xs">
					<p>
						Capability: {selectedModel?.capabilities.join(", ") || "unknown"} ·
						Currency: {values.budgetCurrency} · Period: MONTHLY
					</p>
					<p className="mt-1">
						Reserved: {budget.data?.reservedMicros ?? 0} · Settled:{" "}
						{budget.data?.settledMicros ?? 0} · Uncertain:{" "}
						{budget.data?.uncertainMicros ?? 0}
					</p>
				</div>
				{save.isError && (
					<p className="text-destructive text-xs" role="alert">
						{errorMessage(save.error)}
					</p>
				)}
				{saved && (
					<p className="text-emerald-600 text-xs" role="status">
						Đã lưu governance settings.
					</p>
				)}
				<div className="flex items-center gap-3">
					<Button type="button" disabled={save.isPending} onClick={submit}>
						{save.isPending ? "Đang lưu…" : "Lưu governance"}
					</Button>
					<span className="text-muted-foreground text-xs">
						Version {settings.data?.version ?? 0}; mọi thay đổi có optimistic
						concurrency.
					</span>
				</div>
			</CardContent>
		</Card>
	);
}
