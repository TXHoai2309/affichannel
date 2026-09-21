"use client";

import type {
	AnalyticsColumnMapping,
	AnalyticsImportMapping,
	AnalyticsMetricFamily,
	AnalyticsSourceType,
} from "@affichannel/core";
import {
	analyticsMetricFamilies,
	analyticsSourceTypes,
	metricKeysForFamily,
} from "@affichannel/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	FileSpreadsheet,
	LoaderCircle,
	Upload,
} from "lucide-react";
import { useMemo, useState } from "react";

import { orpc } from "@/utils/orpc";

const MAPPING_FIELDS: Array<{
	key: keyof AnalyticsColumnMapping;
	label: string;
	required?: boolean;
}> = [
	{ key: "recordedDate", label: "Ngày ghi nhận" },
	{ key: "recordedRangeStart", label: "Ngày bắt đầu" },
	{ key: "recordedRangeEnd", label: "Ngày kết thúc" },
	{ key: "metricValue", label: "Giá trị metric", required: true },
	{ key: "metricFamily", label: "Nhóm metric" },
	{ key: "metricKey", label: "Metric key" },
	{ key: "unit", label: "Đơn vị" },
	{ key: "sourceIdentity", label: "Nguồn trong file" },
	{ key: "projectId", label: "Project ID" },
	{ key: "plannedContentItemId", label: "Planned content ID" },
	{ key: "productId", label: "Product ID" },
	{ key: "pillarId", label: "Pillar ID" },
	{ key: "seriesId", label: "Series ID" },
	{ key: "contentType", label: "ContentType" },
	{ key: "contentFormatKey", label: "ContentFormat" },
	{ key: "contentFormatVersion", label: "Format version" },
	{ key: "creationPath", label: "CreationPath" },
	{ key: "usageRecordType", label: "Usage record type" },
	{ key: "usageRecordId", label: "Usage record ID" },
];

function dateInputValue(date: Date) {
	return date.toISOString().slice(0, 10);
}

function initialDateFilter() {
	const end = new Date();
	const start = new Date(end);
	start.setUTCDate(start.getUTCDate() - 29);
	return { startDate: dateInputValue(start), endDate: dateInputValue(end) };
}

type AnalyticsDashboardFilter = ReturnType<typeof initialDateFilter> & {
	metricFamily?: AnalyticsMetricFamily;
	contentType?: "ORGANIC" | "AFFILIATE";
	pillarId?: string;
	seriesId?: string;
	productId?: string;
};

function fileToBase64(file: File) {
	return file.arrayBuffer().then((buffer) => {
		const bytes = new Uint8Array(buffer);
		let binary = "";
		const chunkSize = 0x8000;
		for (let offset = 0; offset < bytes.length; offset += chunkSize) {
			binary += String.fromCharCode(
				...bytes.subarray(offset, offset + chunkSize),
			);
		}
		return btoa(binary);
	});
}

function setColumnMapping(
	mapping: AnalyticsImportMapping,
	key: keyof AnalyticsColumnMapping,
	value: string,
) {
	const columns: AnalyticsColumnMapping = { ...mapping.columns };
	if (value) columns[key] = value;
	else delete columns[key];
	return { ...mapping, columns };
}

function formatMetric(value: number, unit: string) {
	if (unit === "MICROS")
		return `${Math.round(value).toLocaleString("vi-VN")} micros`;
	if (unit === "CURRENCY") return value.toLocaleString("vi-VN");
	if (unit === "RATE") return `${value.toLocaleString("vi-VN")} %`;
	return value.toLocaleString("vi-VN");
}

function MappingEditor({
	mapping,
	headers,
	metricKeys,
	onChange,
}: {
	mapping: AnalyticsImportMapping;
	headers: string[];
	metricKeys: Record<string, string[]>;
	onChange: (mapping: AnalyticsImportMapping) => void;
}) {
	const familyColumn = mapping.columns.metricFamily ?? "";
	const keyColumn = mapping.columns.metricKey ?? "";
	const familyFixed = mapping.fixed?.metricFamily ?? "";
	const keyFixed = mapping.fixed?.metricKey ?? "";
	const selectedFamily = familyFixed as AnalyticsMetricFamily | "";
	const availableKeys = selectedFamily
		? (metricKeys[selectedFamily] ?? metricKeysForFamily(selectedFamily))
		: [];

	return (
		<div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-2">
			{MAPPING_FIELDS.map((field) => (
				<label className="flex flex-col gap-1 text-sm" key={field.key}>
					<span className="font-medium text-foreground">
						{field.label}
						{field.required ? " *" : ""}
					</span>
					<select
						className="h-10 rounded-lg border bg-background px-3 text-sm"
						value={mapping.columns[field.key] ?? ""}
						onChange={(event) =>
							onChange(setColumnMapping(mapping, field.key, event.target.value))
						}
					>
						<option value="">Không dùng</option>
						{headers.map((header) => (
							<option key={header} value={header}>
								{header}
							</option>
						))}
					</select>
				</label>
			))}
			<label className="flex flex-col gap-1 text-sm">
				<span className="font-medium text-foreground">Nhóm metric cố định</span>
				<select
					className="h-10 rounded-lg border bg-background px-3 text-sm"
					value={familyFixed}
					onChange={(event) => {
						const fixed = { ...mapping.fixed };
						if (event.target.value)
							fixed.metricFamily = event.target.value as AnalyticsMetricFamily;
						else delete fixed.metricFamily;
						onChange({ ...mapping, fixed });
					}}
				>
					<option value="">Lấy từ cột</option>
					{analyticsMetricFamilies.map((family) => (
						<option key={family} value={family}>
							{family}
						</option>
					))}
				</select>
			</label>
			<label className="flex flex-col gap-1 text-sm">
				<span className="font-medium text-foreground">Metric key cố định</span>
				<select
					className="h-10 rounded-lg border bg-background px-3 text-sm"
					value={keyFixed}
					onChange={(event) => {
						const fixed = { ...mapping.fixed };
						if (event.target.value) fixed.metricKey = event.target.value;
						else delete fixed.metricKey;
						onChange({ ...mapping, fixed });
					}}
				>
					<option value="">Lấy từ cột</option>
					{availableKeys.map((key) => (
						<option key={key} value={key}>
							{key}
						</option>
					))}
				</select>
			</label>
			<div className="flex flex-col gap-1 text-sm">
				<span className="font-medium text-foreground">Cột đã chọn</span>
				<p className="text-muted-foreground">
					{familyColumn || familyFixed
						? "Nhóm metric đã có nguồn"
						: "Chưa có nhóm metric"}
					;{" "}
					{keyColumn || keyFixed
						? "metric key đã có nguồn"
						: "chưa có metric key"}
					.
				</p>
			</div>
		</div>
	);
}

function AggregateTable({
	title,
	aggregates,
	sampleSize,
}: {
	title: string;
	aggregates: Array<{
		metricKey: string;
		unit: string;
		total: number;
		average: number;
		sampleSize: number;
		insufficientSample: boolean;
	}>;
	sampleSize: number;
}) {
	return (
		<section
			className="rounded-xl border bg-card p-5 shadow-sm"
			aria-labelledby={`${title}-title`}
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<div>
					<h3 className="font-semibold text-lg" id={`${title}-title`}>
						{title}
					</h3>
					<p className="text-muted-foreground text-sm">
						N = {sampleSize} quan sát
					</p>
				</div>
				<span className="text-muted-foreground text-xs">
					Observed average · không phải kết luận nhân quả
				</span>
			</div>
			{aggregates.length === 0 ? (
				<p className="mt-5 rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
					Chưa có dữ liệu trong bộ lọc này.
				</p>
			) : (
				<div className="mt-4 overflow-x-auto">
					<table className="w-full min-w-[520px] text-left text-sm">
						<thead className="border-b text-muted-foreground">
							<tr>
								<th className="pb-2">Metric</th>
								<th className="pb-2">Tổng</th>
								<th className="pb-2">Trung bình</th>
								<th className="pb-2">N</th>
							</tr>
						</thead>
						<tbody>
							{aggregates.map((aggregate) => (
								<tr
									className="border-b last:border-0"
									key={`${aggregate.metricKey}-${aggregate.unit}`}
								>
									<td className="py-3 font-medium">{aggregate.metricKey}</td>
									<td className="py-3">
										{formatMetric(aggregate.total, aggregate.unit)}
									</td>
									<td className="py-3">
										{formatMetric(aggregate.average, aggregate.unit)}
									</td>
									<td className="py-3">
										{aggregate.sampleSize}
										{aggregate.insufficientSample ? (
											<span className="ml-2 text-amber-700">Mẫu nhỏ</span>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}

export default function AnalyticsDashboard() {
	const [filter, setFilter] =
		useState<AnalyticsDashboardFilter>(initialDateFilter);
	const [file, setFile] = useState<File | null>(null);
	const [encodedFile, setEncodedFile] = useState<string | null>(null);
	const [sourceType, setSourceType] =
		useState<AnalyticsSourceType>("MANUAL_CSV");
	const [sourceIdentity, setSourceIdentity] = useState("");
	const [mapping, setMapping] = useState<AnalyticsImportMapping>({
		columns: { metricValue: "" },
	});
	const [preview, setPreview] = useState<Awaited<
		ReturnType<typeof import("@/utils/orpc").client.analytics.previewImport>
	> | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const readModelQuery = useQuery(
		orpc.analytics.getReadModel.queryOptions({
			input: filter,
			meta: { suppressGlobalErrorToast: true },
			staleTime: 15_000,
		}),
	);
	const importsQuery = useQuery(
		orpc.analytics.listImports.queryOptions({
			meta: { suppressGlobalErrorToast: true },
		}),
	);
	const previewMutation = useMutation(
		orpc.analytics.previewImport.mutationOptions({ retry: false }),
	);
	const finalizeMutation = useMutation(
		orpc.analytics.finalizeImport.mutationOptions({ retry: false }),
	);

	const canConfirm = Boolean(
		preview &&
			encodedFile &&
			preview.mappingIssues.length === 0 &&
			preview.rejectedRows === 0 &&
			preview.acceptedRows > 0,
	);
	const filterOptions = useMemo(
		() => readModelQuery.data?.dimensions,
		[readModelQuery.data?.dimensions],
	);

	async function previewFile() {
		if (!file) return;
		setMessage(null);
		const base64 = encodedFile ?? (await fileToBase64(file));
		setEncodedFile(base64);
		try {
			const result = await previewMutation.mutateAsync({
				fileName: file.name,
				fileBase64: base64,
				sourceType,
				sourceIdentity: sourceIdentity || undefined,
				mapping: mapping.columns.metricValue ? mapping : undefined,
			});
			setMapping(result.mapping);
			setPreview(result);
		} catch {
			setMessage(
				"Không thể đọc file. Kiểm tra định dạng, giới hạn file và mapping rồi thử lại.",
			);
		}
	}

	async function finalizeFile() {
		if (!file || !encodedFile || !preview || !canConfirm) return;
		setMessage(null);
		try {
			const result = await finalizeMutation.mutateAsync({
				fileName: file.name,
				fileBase64: encodedFile,
				sourceType,
				sourceIdentity: sourceIdentity || undefined,
				mapping,
				previewFileSha256: preview.fileSha256,
				previewMappingFingerprint: preview.mappingFingerprint,
				idempotencyKey: `analytics-${preview.fileSha256.slice(0, 32)}-${preview.mappingFingerprint.slice(0, 16)}`,
			});
			setMessage(
				result.replayed
					? "Import đã tồn tại; hệ thống không tạo bản ghi trùng."
					: "Import thành công; read model đã được cập nhật.",
			);
			await Promise.all([readModelQuery.refetch(), importsQuery.refetch()]);
		} catch {
			setMessage(
				"Import chưa được ghi. Dữ liệu phải hợp lệ toàn bộ và khớp bản preview.",
			);
		}
	}

	function updateFilter(key: keyof typeof filter, value: string) {
		setFilter((current) => ({ ...current, [key]: value || undefined }));
	}

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
			<section
				className="flex flex-col gap-1"
				aria-labelledby="analytics-title"
			>
				<h2 className="font-semibold text-2xl" id="analytics-title">
					Phân tích hiệu quả
				</h2>
				<p className="text-muted-foreground text-sm">
					Nhập snapshot từ nguồn được chọn để xem Channel Growth và Affiliate
					Monetization riêng biệt. Đây là read model mô tả, không đưa ra khuyến
					nghị.
				</p>
			</section>

			<section
				className="rounded-xl border bg-card p-5 shadow-sm"
				aria-labelledby="analytics-import-title"
			>
				<div className="flex items-start gap-3">
					<Upload className="mt-1 text-affi-blue" aria-hidden="true" />
					<div>
						<h3 className="font-semibold text-lg" id="analytics-import-title">
							Nhập dữ liệu analytics
						</h3>
						<p className="text-muted-foreground text-sm">
							CSV/XLSX được parse ở server. Chọn file chỉ tạo preview; hệ thống
							chỉ ghi sau khi xác nhận mapping.
						</p>
					</div>
				</div>
				<div className="mt-4 grid gap-4 md:grid-cols-3">
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">File CSV/XLSX</span>
						<input
							className="h-10 rounded-lg border bg-background px-3 py-2 text-sm"
							type="file"
							accept=".csv,.xlsx"
							onChange={(event) => {
								const next = event.target.files?.[0] ?? null;
								setFile(next);
								setEncodedFile(null);
								setPreview(null);
								if (next)
									setSourceType(
										next.name.toLowerCase().endsWith(".xlsx")
											? "MANUAL_XLSX"
											: "MANUAL_CSV",
									);
							}}
						/>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Source authority (tuỳ chọn)</span>
						<input
							className="h-10 rounded-lg border bg-background px-3 text-sm"
							value={sourceIdentity}
							onChange={(event) => setSourceIdentity(event.target.value)}
							placeholder="Ví dụ: export tháng 9"
						/>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Loại nguồn</span>
						<select
							className="h-10 rounded-lg border bg-background px-3 text-sm"
							value={sourceType}
							onChange={(event) =>
								setSourceType(event.target.value as AnalyticsSourceType)
							}
						>
							{analyticsSourceTypes.map((type) => (
								<option key={type} value={type}>
									{type}
								</option>
							))}
						</select>
					</label>
				</div>
				<div className="mt-4 flex flex-wrap gap-2">
					<button
						className="inline-flex h-10 items-center gap-2 rounded-lg bg-affi-blue px-4 font-medium text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
						type="button"
						disabled={!file || previewMutation.isPending}
						onClick={() => void previewFile()}
					>
						{previewMutation.isPending ? (
							<LoaderCircle className="animate-spin" size={16} />
						) : (
							<FileSpreadsheet size={16} />
						)}{" "}
						Xem preview
					</button>
					<button
						className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 font-medium text-sm disabled:cursor-not-allowed disabled:opacity-50"
						type="button"
						disabled={!canConfirm || finalizeMutation.isPending}
						onClick={() => void finalizeFile()}
					>
						{finalizeMutation.isPending ? (
							<LoaderCircle className="animate-spin" size={16} />
						) : null}{" "}
						Xác nhận import
					</button>
				</div>
				{message ? (
					<p className="mt-3 rounded-lg bg-affi-blue-soft p-3 text-sm">
						{message}
					</p>
				) : null}
				{preview ? (
					<div className="mt-5 rounded-lg border p-4">
						<div className="grid gap-3 text-sm sm:grid-cols-4">
							<div>
								<span className="text-muted-foreground">Rows hợp lệ</span>
								<p className="font-semibold text-lg">{preview.acceptedRows}</p>
							</div>
							<div>
								<span className="text-muted-foreground">Rows bị loại</span>
								<p className="font-semibold text-lg">{preview.rejectedRows}</p>
							</div>
							<div>
								<span className="text-muted-foreground">Khoảng ngày</span>
								<p className="font-semibold text-sm">
									{preview.recordedRange
										? `${preview.recordedRange.startDate} → ${preview.recordedRange.endDate}`
										: "Chưa xác định"}
								</p>
							</div>
							<div>
								<span className="text-muted-foreground">Timezone</span>
								<p className="font-semibold text-sm">
									{preview.workspaceTimezone}
								</p>
							</div>
						</div>
						{preview.mappingIssues.length > 0 ? (
							<div className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-amber-900 text-sm">
								<AlertTriangle className="mt-0.5 shrink-0" size={16} />
								<div>
									<p className="font-medium">Mapping cần chỉnh</p>
									<ul className="mt-1 list-inside list-disc">
										{preview.mappingIssues.map((issue) => (
											<li key={issue}>{issue}</li>
										))}
									</ul>
								</div>
							</div>
						) : null}
						<MappingEditor
							mapping={mapping}
							headers={preview.headers}
							metricKeys={preview.canonicalMetricKeys}
							onChange={(next) => {
								setMapping(next);
								setPreview(null);
							}}
						/>
						<p className="mt-3 text-muted-foreground text-xs">
							SHA-256 file: {preview.fileSha256}; mapping fingerprint:{" "}
							{preview.mappingFingerprint}. Nếu đổi mapping, hãy preview lại
							trước khi xác nhận.
						</p>
					</div>
				) : null}
			</section>

			<section
				className="rounded-xl border bg-card p-5 shadow-sm"
				aria-labelledby="analytics-filter-title"
			>
				<div className="flex items-baseline justify-between gap-3">
					<div>
						<h3 className="font-semibold text-lg" id="analytics-filter-title">
							Bộ lọc read model
						</h3>
						<p className="text-muted-foreground text-sm">
							Workspace và timezone do server quyết định.
						</p>
					</div>
					{readModelQuery.isFetching ? (
						<LoaderCircle
							className="animate-spin text-muted-foreground"
							size={18}
						/>
					) : null}
				</div>
				<div className="mt-4 grid gap-3 md:grid-cols-4">
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Từ ngày</span>
						<input
							className="h-10 rounded-lg border bg-background px-3"
							type="date"
							value={filter.startDate}
							onChange={(event) =>
								updateFilter("startDate", event.target.value)
							}
						/>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Đến ngày</span>
						<input
							className="h-10 rounded-lg border bg-background px-3"
							type="date"
							value={filter.endDate}
							onChange={(event) => updateFilter("endDate", event.target.value)}
						/>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Metric family</span>
						<select
							className="h-10 rounded-lg border bg-background px-3"
							value={filter.metricFamily ?? ""}
							onChange={(event) =>
								updateFilter("metricFamily", event.target.value)
							}
						>
							<option value="">Tất cả</option>
							{analyticsMetricFamilies.map((family) => (
								<option key={family} value={family}>
									{family}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">ContentType</span>
						<select
							className="h-10 rounded-lg border bg-background px-3"
							value={filter.contentType ?? ""}
							onChange={(event) =>
								updateFilter("contentType", event.target.value)
							}
						>
							<option value="">Tất cả</option>
							<option value="ORGANIC">ORGANIC</option>
							<option value="AFFILIATE">AFFILIATE</option>
						</select>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Pillar</span>
						<select
							className="h-10 rounded-lg border bg-background px-3"
							value={filter.pillarId ?? ""}
							onChange={(event) => updateFilter("pillarId", event.target.value)}
						>
							<option value="">Tất cả</option>
							{filterOptions?.pillars.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Series</span>
						<select
							className="h-10 rounded-lg border bg-background px-3"
							value={filter.seriesId ?? ""}
							onChange={(event) => updateFilter("seriesId", event.target.value)}
						>
							<option value="">Tất cả</option>
							{filterOptions?.series.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Product</span>
						<select
							className="h-10 rounded-lg border bg-background px-3"
							value={filter.productId ?? ""}
							onChange={(event) =>
								updateFilter("productId", event.target.value)
							}
						>
							<option value="">Tất cả</option>
							{filterOptions?.products.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</select>
					</label>
				</div>
			</section>

			{readModelQuery.isError ? (
				<div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900 text-sm">
					Không thể tải Analytics read model. Vui lòng thử lại.
				</div>
			) : null}
			{readModelQuery.data ? (
				<>
					<div className="grid gap-5 xl:grid-cols-2">
						<AggregateTable
							title="Channel Growth"
							aggregates={readModelQuery.data.channelGrowth.aggregates}
							sampleSize={readModelQuery.data.channelGrowth.sampleSize}
						/>
						<AggregateTable
							title="Affiliate Monetization"
							aggregates={readModelQuery.data.affiliateMonetization.aggregates}
							sampleSize={readModelQuery.data.affiliateMonetization.sampleSize}
						/>
					</div>
					<section
						className="rounded-xl border bg-card p-5 shadow-sm"
						aria-labelledby="analytics-cost-title"
					>
						<h3 className="font-semibold text-lg" id="analytics-cost-title">
							AI / Render cost
						</h3>
						{readModelQuery.data.cost.available ? (
							<p className="mt-2 text-sm">
								Tổng cost:{" "}
								<strong>
									{formatMetric(
										readModelQuery.data.cost.totalMicros ?? 0,
										"MICROS",
									)}
								</strong>{" "}
								· N = {readModelQuery.data.cost.sampleSize}
								{readModelQuery.data.cost.insufficientSample
									? " · Mẫu nhỏ"
									: ""}
							</p>
						) : (
							<p className="mt-2 text-muted-foreground text-sm">
								Chưa có usage record hợp lệ được liên kết; cost là unavailable,
								không quy đổi thành 0.
							</p>
						)}
						<p className="mt-3 text-muted-foreground text-xs">
							{readModelQuery.data.correlationNote}
						</p>
					</section>
					<section
						className="rounded-xl border bg-card p-5 shadow-sm"
						aria-labelledby="analytics-attribution-title"
					>
						<h3
							className="font-semibold text-lg"
							id="analytics-attribution-title"
						>
							Attribution & sample safety
						</h3>
						<p className="mt-2 text-sm">
							Unattributed observations:{" "}
							<strong>{readModelQuery.data.unattributedSampleSize}</strong>.
							Ngưỡng cảnh báo mẫu nhỏ:{" "}
							<strong>{readModelQuery.data.insufficientSampleThreshold}</strong>
							.
						</p>
						<p className="mt-2 text-muted-foreground text-sm">
							Metric chỉ gắn với Project/Product/Pillar/Series khi source có
							canonical ID hợp lệ; không fuzzy-match theo title.
						</p>
					</section>
				</>
			) : null}

			<section
				className="rounded-xl border bg-card p-5 shadow-sm"
				aria-labelledby="analytics-history-title"
			>
				<h3 className="font-semibold text-lg" id="analytics-history-title">
					Lịch sử import
				</h3>
				{importsQuery.data?.items.length ? (
					<div className="mt-3 overflow-x-auto">
						<table className="w-full min-w-[680px] text-left text-sm">
							<thead className="border-b text-muted-foreground">
								<tr>
									<th className="pb-2">Nguồn</th>
									<th className="pb-2">Khoảng ngày</th>
									<th className="pb-2">Rows</th>
									<th className="pb-2">Snapshot trùng</th>
									<th className="pb-2">Thời điểm</th>
								</tr>
							</thead>
							<tbody>
								{importsQuery.data.items.map((item) => (
									<tr className="border-b last:border-0" key={item.id}>
										<td className="py-3">
											{item.sourceType}
											{item.sourceIdentity ? ` · ${item.sourceIdentity}` : ""}
										</td>
										<td className="py-3">
											{item.recordedRangeStart} → {item.recordedRangeEnd}
										</td>
										<td className="py-3">
											{item.acceptedCount}/{item.rowCount}
										</td>
										<td className="py-3">{item.duplicateCount}</td>
										<td className="py-3 text-muted-foreground">
											{new Date(item.createdAt).toLocaleString("vi-VN")}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<p className="mt-3 text-muted-foreground text-sm">
						Chưa có import nào.
					</p>
				)}
			</section>
		</div>
	);
}
