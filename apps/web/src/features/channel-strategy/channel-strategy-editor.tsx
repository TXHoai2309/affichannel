"use client";

import {
	CHANNEL_STRATEGY_PRESENCE_MODES,
	type ChannelStrategyPresenceMode,
	type ChannelStrategyReadModel,
	CREATION_PATHS,
	type CreationPath,
	channelStrategySaveInputSchema,
	INITIAL_CONTENT_FORMAT_REGISTRY,
} from "@affichannel/core";
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
import { Skeleton } from "@affichannel/ui/components/skeleton";
import { Textarea } from "@affichannel/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { orpc } from "@/utils/orpc";

type FormValues = {
	niche: string;
	targetAudience: string;
	presenceMode: ChannelStrategyPresenceMode;
	tone: string;
	contentPillars: string;
	contentSeries: string;
	preferredCreationPaths: CreationPath[];
	preferredContentFormats: string[];
	postsPerWeek: string;
	preferredDays: string;
	visualStyle: string;
	organicPercentage: string;
	affiliatePercentage: string;
};

const INITIAL_VALUES: FormValues = {
	niche: "",
	targetAudience: "",
	presenceMode: "FACELESS",
	tone: "",
	contentPillars: "\n\n",
	contentSeries: "",
	preferredCreationPaths: ["SCRIPTED"],
	preferredContentFormats: ["SCRIPTED_STANDARD@1"],
	postsPerWeek: "3",
	preferredDays: "1,3,5",
	visualStyle: "",
	organicPercentage: "50",
	affiliatePercentage: "50",
};

function formatIdentity(key: string, version: number) {
	return `${key}@${version}`;
}

function splitLines(value: string) {
	return value
		.split("\n")
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseDays(value: string) {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean)
		.map((item) => Number(item));
}

function toFormValues(strategy: ChannelStrategyReadModel): FormValues {
	return {
		niche: strategy.niche,
		targetAudience: strategy.targetAudience,
		presenceMode: strategy.presenceMode,
		tone: strategy.tone,
		contentPillars: strategy.contentPillars.join("\n"),
		contentSeries: strategy.contentSeries.join("\n"),
		preferredCreationPaths: [...strategy.preferredCreationPaths],
		preferredContentFormats: strategy.preferredContentFormats.map((format) =>
			formatIdentity(format.key, format.version),
		),
		postsPerWeek: String(strategy.postingFrequency.postsPerWeek),
		preferredDays: strategy.postingFrequency.preferredDays.join(","),
		visualStyle: strategy.visualStyle,
		organicPercentage: String(
			strategy.organicAffiliateMixTarget.organicPercentage,
		),
		affiliatePercentage: String(
			strategy.organicAffiliateMixTarget.affiliatePercentage,
		),
	};
}

function errorMessage(error: unknown) {
	if (!error || typeof error !== "object")
		return "Không thể lưu Channel Strategy.";
	const candidate = error as { message?: unknown; data?: { code?: unknown } };
	return typeof candidate.message === "string"
		? candidate.message
		: typeof candidate.data?.code === "string"
			? candidate.data.code
			: "Không thể lưu Channel Strategy.";
}

function isConflict(error: unknown) {
	const message = errorMessage(error);
	return (
		message.includes("VERSION_CONFLICT") || message.includes("ALREADY_EXISTS")
	);
}

function FieldError({ message }: { message?: string }) {
	return message ? (
		<p className="text-destructive text-xs" role="alert">
			{message}
		</p>
	) : null;
}

export function ChannelStrategyEditor() {
	const queryClient = useQueryClient();
	const strategyQuery = useQuery(
		orpc.channelStrategy.getCurrent.queryOptions({
			meta: { suppressGlobalErrorToast: true },
		}),
	);
	const saveStrategy = useMutation(orpc.channelStrategy.save.mutationOptions());
	const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [saved, setSaved] = useState(false);
	const [conflict, setConflict] = useState(false);

	useEffect(() => {
		if (strategyQuery.data) setValues(toFormValues(strategyQuery.data));
	}, [strategyQuery.data]);

	function update<K extends keyof FormValues>(field: K, value: FormValues[K]) {
		setValues((current) => ({ ...current, [field]: value }));
		setErrors({});
		setSaved(false);
		setConflict(false);
	}

	function togglePath(path: CreationPath) {
		const next = values.preferredCreationPaths.includes(path)
			? values.preferredCreationPaths.filter((item) => item !== path)
			: [...values.preferredCreationPaths, path];
		update("preferredCreationPaths", next);
	}

	function toggleFormat(identity: string) {
		const next = values.preferredContentFormats.includes(identity)
			? values.preferredContentFormats.filter((item) => item !== identity)
			: [...values.preferredContentFormats, identity];
		update("preferredContentFormats", next);
	}

	function submit() {
		const contentFormats = values.preferredContentFormats.map((identity) => {
			const [key, version] = identity.split("@");
			return { key, version: Number(version) };
		});
		const parsed = channelStrategySaveInputSchema.safeParse({
			expectedVersion: strategyQuery.data?.version ?? null,
			niche: values.niche,
			targetAudience: values.targetAudience,
			presenceMode: values.presenceMode,
			tone: values.tone,
			contentPillars: splitLines(values.contentPillars),
			contentSeries: splitLines(values.contentSeries),
			preferredCreationPaths: values.preferredCreationPaths,
			preferredContentFormats: contentFormats,
			postingFrequency: {
				postsPerWeek: Number(values.postsPerWeek),
				preferredDays: parseDays(values.preferredDays),
			},
			visualStyle: values.visualStyle,
			organicAffiliateMixTarget: {
				organicPercentage: Number(values.organicPercentage),
				affiliatePercentage: Number(values.affiliatePercentage),
			},
		});
		if (!parsed.success) {
			const nextErrors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				nextErrors[String(issue.path[0] ?? "form")] = issue.message;
			}
			setErrors(nextErrors);
			setSaved(false);
			return;
		}

		saveStrategy.mutate(parsed.data, {
			onSuccess: (nextStrategy) => {
				if (!nextStrategy) return;
				setValues(toFormValues(nextStrategy));
				setSaved(true);
				setConflict(false);
				setErrors({});
				void queryClient.invalidateQueries({
					queryKey: orpc.channelStrategy.getCurrent.queryKey(),
				});
			},
			onError: (error) => {
				setConflict(isConflict(error));
				setErrors({ form: errorMessage(error) });
				setSaved(false);
			},
		});
	}

	if (strategyQuery.isPending) {
		return <Skeleton className="h-[760px] rounded-2xl" />;
	}

	if (strategyQuery.isError) {
		return (
			<Card className="border-destructive/30">
				<CardHeader>
					<CardTitle>Không thể tải Channel Strategy</CardTitle>
					<CardDescription>{errorMessage(strategyQuery.error)}</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const isSaving = saveStrategy.isPending;
	return (
		<Card className="rounded-2xl">
			<CardHeader>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<CardTitle>Channel Strategy</CardTitle>
						<CardDescription>
							Cấu hình thủ công cho hướng nội dung của workspace. US26 sẽ đọc
							aggregate này để lập kế hoạch.
						</CardDescription>
					</div>
					<Badge variant={strategyQuery.data ? "secondary" : "outline"}>
						{strategyQuery.data
							? `Đã lưu · v${strategyQuery.data.version}`
							: "Chưa cấu hình"}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				{conflict ? (
					<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
						<p className="font-medium">Conflict: strategy đã được cập nhật.</p>
						<p className="mt-1 text-muted-foreground">
							Bản mới hơn không bị ghi đè. Hãy tải lại giá trị hiện tại rồi
							chỉnh lại.
						</p>
						<Button
							className="mt-3"
							size="sm"
							variant="outline"
							onClick={() => {
								setConflict(false);
								setErrors({});
								void strategyQuery.refetch();
							}}
						>
							Tải lại strategy hiện tại
						</Button>
					</div>
				) : null}
				{saved ? (
					<p className="rounded-lg bg-emerald-500/10 p-3 text-emerald-700 text-sm dark:text-emerald-300">
						Đã lưu Channel Strategy thành công.
					</p>
				) : null}

				<div className="grid gap-5 md:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="strategy-niche">Niche</Label>
						<Input
							id="strategy-niche"
							value={values.niche}
							onChange={(event) => update("niche", event.target.value)}
						/>
						<FieldError message={errors.niche} />
					</div>
					<div className="space-y-2">
						<Label htmlFor="strategy-audience">Target audience</Label>
						<Input
							id="strategy-audience"
							value={values.targetAudience}
							onChange={(event) => update("targetAudience", event.target.value)}
						/>
						<FieldError message={errors.targetAudience} />
					</div>
					<div className="space-y-2">
						<Label htmlFor="strategy-presence">Face / faceless</Label>
						<select
							className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
							id="strategy-presence"
							value={values.presenceMode}
							onChange={(event) =>
								update(
									"presenceMode",
									event.target.value as ChannelStrategyPresenceMode,
								)
							}
						>
							{CHANNEL_STRATEGY_PRESENCE_MODES.map((mode) => (
								<option key={mode} value={mode}>
									{mode}
								</option>
							))}
						</select>
						<FieldError message={errors.presenceMode} />
					</div>
					<div className="space-y-2">
						<Label htmlFor="strategy-tone">Tone</Label>
						<Input
							id="strategy-tone"
							value={values.tone}
							onChange={(event) => update("tone", event.target.value)}
						/>
						<FieldError message={errors.tone} />
					</div>
				</div>

				<div className="grid gap-5 md:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="strategy-pillars">Content pillars (3–5 dòng)</Label>
						<Textarea
							id="strategy-pillars"
							rows={5}
							value={values.contentPillars}
							onChange={(event) => update("contentPillars", event.target.value)}
						/>
						<FieldError message={errors.contentPillars} />
					</div>
					<div className="space-y-2">
						<Label htmlFor="strategy-series">Content series</Label>
						<Textarea
							id="strategy-series"
							rows={5}
							value={values.contentSeries}
							onChange={(event) => update("contentSeries", event.target.value)}
						/>
						<FieldError message={errors.contentSeries} />
					</div>
				</div>

				<div className="grid gap-5 md:grid-cols-2">
					<fieldset className="space-y-3">
						<legend className="font-medium text-sm">
							Preferred CreationPaths
						</legend>
						<div className="grid gap-2 sm:grid-cols-3">
							{CREATION_PATHS.map((path) => (
								<label className="flex items-center gap-2 text-sm" key={path}>
									<input
										checked={values.preferredCreationPaths.includes(path)}
										name="preferredCreationPaths"
										type="checkbox"
										onChange={() => togglePath(path)}
									/>
									{path}
								</label>
							))}
						</div>
						<FieldError message={errors.preferredCreationPaths} />
					</fieldset>
					<fieldset className="space-y-3">
						<legend className="font-medium text-sm">
							Preferred ContentFormats
						</legend>
						<div className="space-y-2">
							{INITIAL_CONTENT_FORMAT_REGISTRY.map((format) => {
								const identity = formatIdentity(
									format.ref.key,
									format.ref.version,
								);
								return (
									<label
										className="flex items-center gap-2 text-sm"
										key={identity}
									>
										<input
											checked={values.preferredContentFormats.includes(
												identity,
											)}
											name="preferredContentFormats"
											type="checkbox"
											onChange={() => toggleFormat(identity)}
										/>
										{format.label}
									</label>
								);
							})}
						</div>
						<FieldError message={errors.preferredContentFormats} />
					</fieldset>
				</div>

				<div className="grid gap-5 md:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="strategy-frequency">
							Posting frequency (bài/tuần)
						</Label>
						<Input
							id="strategy-frequency"
							max={7}
							min={1}
							type="number"
							value={values.postsPerWeek}
							onChange={(event) => update("postsPerWeek", event.target.value)}
						/>
						<p className="text-muted-foreground text-xs">
							Ngày trong tuần dùng số 0–6, nhập cách nhau bằng dấu phẩy.
						</p>
						<FieldError message={errors.postingFrequency} />
					</div>
					<div className="space-y-2">
						<Label htmlFor="strategy-visual-style">Visual style</Label>
						<Input
							id="strategy-visual-style"
							value={values.visualStyle}
							onChange={(event) => update("visualStyle", event.target.value)}
						/>
						<FieldError message={errors.visualStyle} />
					</div>
				</div>

				<div className="grid gap-5 md:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="strategy-organic">Organic (%)</Label>
						<Input
							id="strategy-organic"
							max={100}
							min={0}
							type="number"
							value={values.organicPercentage}
							onChange={(event) =>
								update("organicPercentage", event.target.value)
							}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="strategy-affiliate">Affiliate (%)</Label>
						<Input
							id="strategy-affiliate"
							max={100}
							min={0}
							type="number"
							value={values.affiliatePercentage}
							onChange={(event) =>
								update("affiliatePercentage", event.target.value)
							}
						/>
						<FieldError message={errors.organicAffiliateMixTarget} />
					</div>
				</div>

				{errors.form ? (
					<p
						className="rounded-lg bg-destructive/5 p-3 text-destructive text-sm"
						role="alert"
					>
						{errors.form}
					</p>
				) : null}
				<div className="flex justify-end border-t pt-5">
					<Button disabled={isSaving} type="button" onClick={submit}>
						{isSaving ? "Đang lưu…" : "Lưu Channel Strategy"}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
