import { createHash, randomUUID } from "node:crypto";

import {
	type AnalyticsImportMapping,
	type AnalyticsMetricFamily,
	type AnalyticsReadModelFilter,
	type AnalyticsSnapshotForAggregation,
	type AnalyticsSourceType,
	aggregateAnalyticsSnapshots,
	analyticsMappingVersion,
	analyticsMetricRegistry,
	analyticsMinimumSampleSize,
	canonicalizeJson,
	defaultAnalyticsDateRange,
	getContentFormatDefinition,
	isContentType,
	isCreationPath,
	metricKeysForFamily,
	normalizeDateRange,
} from "@affichannel/core";
import {
	analyticsImportBatch,
	analyticsMetricSnapshot,
	channelStrategyPillar,
	channelStrategySeries,
	db,
	plannedContentItem,
	product,
	project,
	scriptClaimRefreshRun,
	scriptGeneration,
	workspace,
} from "@affichannel/db";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
	AnalyticsImportError,
	excelDateConverter,
	metricUnitFor,
	parseAnalyticsFile,
	proposeAnalyticsMapping,
	validateAnalyticsMapping,
} from "./analytics-import-parser";
import type { WorkspaceActor } from "./workspace";

export { AnalyticsImportError } from "./analytics-import-parser";

type FileInput = {
	fileName: string;
	fileBase64: string;
	sourceType: AnalyticsSourceType;
	sourceIdentity?: string;
	mapping?: AnalyticsImportMapping;
};

type NormalizedMetric = {
	recordedRangeStart: string;
	recordedRangeEnd: string;
	metricFamily: AnalyticsMetricFamily;
	metricKey: string;
	metricValue: number;
	unit: string;
	sourceIdentity: string | null;
	attributionScope: "CHANNEL" | "CONTENT" | "PRODUCT" | "UNATTRIBUTED";
	projectId: string | null;
	plannedContentItemId: string | null;
	productId: string | null;
	pillarId: string | null;
	seriesId: string | null;
	contentType: "ORGANIC" | "AFFILIATE" | null;
	contentFormatKey: string | null;
	contentFormatVersion: number | null;
	creationPath: "QUICK_IMAGE" | "SCRIPTED" | "MEDIA_FIRST" | null;
	usageRecordType: string | null;
	usageRecordId: string | null;
	sourceRowHash: string;
	dedupeKey: string;
};

type PreviewPreparation = {
	parsed: ReturnType<typeof parseAnalyticsFile>;
	timezone: string;
	sourceIdentity: string | null;
	mapping: AnalyticsImportMapping;
	mappingFingerprint: string;
	acceptedRows: NormalizedMetric[];
	rejectedCount: number;
	rejectionReasons: Record<string, number>;
	range: { startDate: string; endDate: string } | null;
};

const KNOWN_USAGE_RECORD_TYPES = [
	"SCRIPT_GENERATION",
	"SCRIPT_CLAIM_REFRESH",
] as const;

function hash(value: unknown) {
	return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

function postgresCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object") return undefined;
	const candidate = error as { code?: unknown; cause?: unknown };
	return typeof candidate.code === "string"
		? candidate.code
		: postgresCode(candidate.cause);
}

function decodeBase64(value: string) {
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
		throw new AnalyticsImportError(
			"ANALYTICS_FILE_ENCODING_INVALID",
			"The uploaded file encoding is invalid.",
		);
	}
	const bytes = Buffer.from(value, "base64");
	if (bytes.byteLength === 0) {
		throw new AnalyticsImportError(
			"ANALYTICS_FILE_EMPTY",
			"The uploaded file is empty.",
		);
	}
	return new Uint8Array(bytes);
}

function mappingFingerprint(input: {
	sourceType: AnalyticsSourceType;
	sourceIdentity: string | null;
	timezone: string;
	mapping: AnalyticsImportMapping;
}) {
	return hash({
		version: analyticsMappingVersion,
		sourceType: input.sourceType,
		sourceIdentity: input.sourceIdentity,
		timezone: input.timezone,
		mapping: input.mapping,
	});
}

function textValue(value: unknown) {
	if (value === null || value === undefined) return undefined;
	const text = String(value).trim();
	return text || undefined;
}

function safeMetricNumber(value: unknown) {
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Math.abs(value) > 1e15) return undefined;
		return value;
	}
	const text = textValue(value);
	if (!text || /^[=+\-@]/.test(text) || !/^(?:\d+)(?:\.\d+)?$/.test(text)) {
		return undefined;
	}
	const parsed = Number(text);
	return Number.isFinite(parsed) && Math.abs(parsed) <= 1e15
		? parsed
		: undefined;
}

function safeInteger(value: unknown) {
	const number = safeMetricNumber(value);
	return number !== undefined && Number.isSafeInteger(number)
		? number
		: undefined;
}

function getMappedValue(
	row: Record<string, unknown>,
	mapping: AnalyticsImportMapping,
	field: keyof AnalyticsImportMapping["columns"],
) {
	const column = mapping.columns[field];
	return column ? row[column] : undefined;
}

function sourceIdentityFor(
	row: Record<string, unknown>,
	mapping: AnalyticsImportMapping,
	inputSourceIdentity: string | undefined,
) {
	return (
		textValue(getMappedValue(row, mapping, "sourceIdentity")) ??
		mapping.fixed?.sourceIdentity ??
		textValue(inputSourceIdentity) ??
		null
	);
}

async function workspaceTimezone(actor: WorkspaceActor) {
	const [record] = await db
		.select({ timezone: workspace.timezone })
		.from(workspace)
		.where(eq(workspace.id, actor.workspaceId))
		.limit(1);
	if (!record?.timezone) {
		throw new AnalyticsImportError(
			"ANALYTICS_WORKSPACE_NOT_FOUND",
			"Workspace timezone is unavailable.",
		);
	}
	return record.timezone;
}

async function loadAuthorities(
	actor: WorkspaceActor,
	rows: readonly Record<string, unknown>[],
	mapping: AnalyticsImportMapping,
) {
	const valueFor = (
		row: Record<string, unknown>,
		column: keyof AnalyticsImportMapping["columns"],
	) => {
		const header = mapping.columns[column];
		return header ? row[header] : undefined;
	};
	const idsFor = (column: keyof AnalyticsImportMapping["columns"]) =>
		[
			...new Set(
				rows.map((row) => textValue(valueFor(row, column))).filter(Boolean),
			),
		] as string[];
	const projectIds = idsFor("projectId");
	const plannedIds = idsFor("plannedContentItemId");
	const productIds = idsFor("productId");
	const pillarIds = idsFor("pillarId");
	const seriesIds = idsFor("seriesId");
	const usageRows = rows
		.map((row) => ({
			type: textValue(valueFor(row, "usageRecordType")),
			id: textValue(valueFor(row, "usageRecordId")),
		}))
		.filter(
			(
				row,
			): row is {
				type: (typeof KNOWN_USAGE_RECORD_TYPES)[number];
				id: string;
			} =>
				KNOWN_USAGE_RECORD_TYPES.includes(
					row.type as (typeof KNOWN_USAGE_RECORD_TYPES)[number],
				) && Boolean(row.id),
		);
	const authorityProductIds = [...new Set([...productIds])];
	const [
		projects,
		plannedItems,
		products,
		pillars,
		series,
		generations,
		claimRefreshes,
	] = await Promise.all([
		projectIds.length
			? db
					.select({
						id: project.id,
						workspaceId: project.workspaceId,
						productId: project.productId,
						contentType: project.contentType,
						creationPath: project.creationPath,
						contentFormatKey: project.contentFormatKey,
						contentFormatVersion: project.contentFormatVersion,
						channelStrategyId: project.channelStrategyId,
					})
					.from(project)
					.where(
						and(
							eq(project.workspaceId, actor.workspaceId),
							inArray(project.id, projectIds),
						),
					)
			: [],
		plannedIds.length
			? db
					.select({
						id: plannedContentItem.id,
						workspaceId: plannedContentItem.workspaceId,
						productId: plannedContentItem.productId,
						contentType: plannedContentItem.contentType,
						creationPath: plannedContentItem.creationPath,
						contentFormatKey: plannedContentItem.contentFormatKey,
						contentFormatVersion: plannedContentItem.contentFormatVersion,
						strategyId: plannedContentItem.strategyId,
					})
					.from(plannedContentItem)
					.where(
						and(
							eq(plannedContentItem.workspaceId, actor.workspaceId),
							inArray(plannedContentItem.id, plannedIds),
						),
					)
			: [],
		authorityProductIds.length
			? db
					.select({
						id: product.id,
						workspaceId: product.workspaceId,
						name: product.name,
					})
					.from(product)
					.where(
						and(
							eq(product.workspaceId, actor.workspaceId),
							inArray(product.id, authorityProductIds),
						),
					)
			: [],
		pillarIds.length
			? db
					.select({
						id: channelStrategyPillar.id,
						strategyId: channelStrategyPillar.strategyId,
						name: channelStrategyPillar.name,
					})
					.from(channelStrategyPillar)
					.innerJoin(
						// A strategy is workspace-owned; scope through projects below when applicable.
						project,
						eq(project.channelStrategyId, channelStrategyPillar.strategyId),
					)
					.where(
						and(
							eq(project.workspaceId, actor.workspaceId),
							inArray(channelStrategyPillar.id, pillarIds),
						),
					)
					.groupBy(
						channelStrategyPillar.id,
						channelStrategyPillar.strategyId,
						channelStrategyPillar.name,
					)
			: [],
		seriesIds.length
			? db
					.select({
						id: channelStrategySeries.id,
						strategyId: channelStrategySeries.strategyId,
						name: channelStrategySeries.name,
					})
					.from(channelStrategySeries)
					.innerJoin(
						project,
						eq(project.channelStrategyId, channelStrategySeries.strategyId),
					)
					.where(
						and(
							eq(project.workspaceId, actor.workspaceId),
							inArray(channelStrategySeries.id, seriesIds),
						),
					)
					.groupBy(
						channelStrategySeries.id,
						channelStrategySeries.strategyId,
						channelStrategySeries.name,
					)
			: [],
		usageRows.some((row) => row.type === "SCRIPT_GENERATION")
			? db
					.select({
						id: scriptGeneration.id,
						actualCostMicros: scriptGeneration.actualCostMicros,
					})
					.from(scriptGeneration)
					.where(
						and(
							eq(scriptGeneration.workspaceId, actor.workspaceId),
							inArray(
								scriptGeneration.id,
								usageRows
									.filter((row) => row.type === "SCRIPT_GENERATION")
									.map((row) => row.id),
							),
						),
					)
			: [],
		usageRows.some((row) => row.type === "SCRIPT_CLAIM_REFRESH")
			? db
					.select({
						id: scriptClaimRefreshRun.id,
						actualCostMicros: scriptClaimRefreshRun.actualCostMicros,
					})
					.from(scriptClaimRefreshRun)
					.where(
						and(
							eq(scriptClaimRefreshRun.workspaceId, actor.workspaceId),
							inArray(
								scriptClaimRefreshRun.id,
								usageRows
									.filter((row) => row.type === "SCRIPT_CLAIM_REFRESH")
									.map((row) => row.id),
							),
						),
					)
			: [],
	]);
	return {
		projects: new Map(projects.map((row) => [row.id, row])),
		plannedItems: new Map(plannedItems.map((row) => [row.id, row])),
		products: new Map(products.map((row) => [row.id, row])),
		pillars: new Map(pillars.map((row) => [row.id, row])),
		series: new Map(series.map((row) => [row.id, row])),
		usage: new Map<string, bigint | null>([
			...generations.map(
				(row) => [`SCRIPT_GENERATION:${row.id}`, row.actualCostMicros] as const,
			),
			...claimRefreshes.map(
				(row) =>
					[`SCRIPT_CLAIM_REFRESH:${row.id}`, row.actualCostMicros] as const,
			),
		]),
	};
}

function valueFromRow(
	row: Record<string, unknown>,
	mapping: AnalyticsImportMapping,
	field: keyof AnalyticsImportMapping["columns"],
) {
	return getMappedValue(row, mapping, field);
}

async function normalizeRows(input: {
	actor: WorkspaceActor;
	parsed: ReturnType<typeof parseAnalyticsFile>;
	timezone: string;
	mapping: AnalyticsImportMapping;
	sourceIdentity?: string;
}) {
	const authorities = await loadAuthorities(
		input.actor,
		input.parsed.rows,
		input.mapping,
	);
	const acceptedRows: NormalizedMetric[] = [];
	const rejectionReasons: Record<string, number> = {};
	const rangeValues: { startDate: string; endDate: string }[] = [];
	for (const rawRow of input.parsed.rows) {
		try {
			const familyValue =
				textValue(valueFromRow(rawRow, input.mapping, "metricFamily")) ??
				input.mapping.fixed?.metricFamily;
			const family = familyValue?.toLocaleUpperCase() as
				| AnalyticsMetricFamily
				| undefined;
			if (
				!family ||
				!(Object.keys(analyticsMetricRegistry) as string[]).includes(family)
			) {
				throw new AnalyticsImportError(
					"METRIC_FAMILY_INVALID",
					"Metric family is invalid.",
				);
			}
			const metricKey = (
				textValue(valueFromRow(rawRow, input.mapping, "metricKey")) ??
				input.mapping.fixed?.metricKey
			)?.toLocaleLowerCase();
			if (!metricKey || !metricKeysForFamily(family).includes(metricKey)) {
				throw new AnalyticsImportError(
					"METRIC_KEY_INVALID",
					"Metric key is not in the canonical registry.",
				);
			}
			const expectedUnit = metricUnitFor(family, metricKey);
			if (!expectedUnit) {
				throw new AnalyticsImportError(
					"METRIC_KEY_INVALID",
					"Metric key is not in the canonical registry.",
				);
			}
			const suppliedUnit =
				textValue(valueFromRow(rawRow, input.mapping, "unit")) ??
				input.mapping.fixed?.unit ??
				expectedUnit;
			if (suppliedUnit !== expectedUnit) {
				throw new AnalyticsImportError(
					"METRIC_UNIT_INVALID",
					"Metric unit does not match the canonical registry.",
				);
			}
			const metricValue = safeMetricNumber(
				valueFromRow(rawRow, input.mapping, "metricValue"),
			);
			if (metricValue === undefined) {
				throw new AnalyticsImportError(
					"METRIC_VALUE_INVALID",
					"Metric value is not a safe scalar number.",
				);
			}
			const startValue =
				valueFromRow(rawRow, input.mapping, "recordedRangeStart") ??
				valueFromRow(rawRow, input.mapping, "recordedDate");
			const endValue =
				valueFromRow(rawRow, input.mapping, "recordedRangeEnd") ?? startValue;
			const dateRange = normalizeDateRange(
				startValue,
				endValue,
				input.timezone,
				{
					excelSerialToDate: excelDateConverter(),
				},
			);
			if (!dateRange) {
				throw new AnalyticsImportError(
					"RECORDED_DATE_INVALID",
					"Recorded date/range is invalid for the workspace timezone.",
				);
			}
			rangeValues.push(dateRange);

			const projectId =
				textValue(valueFromRow(rawRow, input.mapping, "projectId")) ?? null;
			const plannedContentItemId =
				textValue(
					valueFromRow(rawRow, input.mapping, "plannedContentItemId"),
				) ?? null;
			const explicitProductId =
				textValue(valueFromRow(rawRow, input.mapping, "productId")) ?? null;
			const projectAuthority = projectId
				? authorities.projects.get(projectId)
				: undefined;
			const plannedAuthority = plannedContentItemId
				? authorities.plannedItems.get(plannedContentItemId)
				: undefined;
			if (projectId && !projectAuthority)
				throw new AnalyticsImportError(
					"CONTENT_ATTRIBUTION_UNMAPPED",
					"Project attribution is not a canonical workspace record.",
				);
			if (plannedContentItemId && !plannedAuthority)
				throw new AnalyticsImportError(
					"CONTENT_ATTRIBUTION_UNMAPPED",
					"Planned content attribution is not a canonical workspace record.",
				);
			if (
				projectAuthority &&
				plannedAuthority &&
				plannedAuthority.id !== projectAuthority.id
			) {
				throw new AnalyticsImportError(
					"CONTENT_ATTRIBUTION_CONFLICT",
					"Project and planned content attribution conflict.",
				);
			}
			const authorityProductId =
				projectAuthority?.productId ?? plannedAuthority?.productId ?? null;
			if (explicitProductId && !authorities.products.has(explicitProductId)) {
				throw new AnalyticsImportError(
					"PRODUCT_ATTRIBUTION_UNMAPPED",
					"Product attribution is not a canonical workspace record.",
				);
			}
			if (
				explicitProductId &&
				authorityProductId &&
				explicitProductId !== authorityProductId
			) {
				throw new AnalyticsImportError(
					"PRODUCT_ATTRIBUTION_CONFLICT",
					"Product attribution conflicts with canonical content.",
				);
			}
			const productId = explicitProductId ?? authorityProductId;
			const contentTypeValue = textValue(
				valueFromRow(rawRow, input.mapping, "contentType"),
			)?.toLocaleUpperCase();
			const canonicalContentType = (projectAuthority?.contentType ??
				plannedAuthority?.contentType ??
				contentTypeValue ??
				null) as "ORGANIC" | "AFFILIATE" | null;
			if (canonicalContentType && !isContentType(canonicalContentType))
				throw new AnalyticsImportError(
					"CONTENT_TYPE_INVALID",
					"ContentType is not canonical.",
				);
			if (
				contentTypeValue &&
				(projectAuthority?.contentType ?? plannedAuthority?.contentType) &&
				contentTypeValue !==
					(projectAuthority?.contentType ?? plannedAuthority?.contentType)
			) {
				throw new AnalyticsImportError(
					"CONTENT_TYPE_CONFLICT",
					"ContentType conflicts with canonical content.",
				);
			}
			const creationPathValue = textValue(
				valueFromRow(rawRow, input.mapping, "creationPath"),
			)?.toLocaleUpperCase();
			const creationPath = (projectAuthority?.creationPath ??
				plannedAuthority?.creationPath ??
				creationPathValue ??
				null) as "QUICK_IMAGE" | "SCRIPTED" | "MEDIA_FIRST" | null;
			if (creationPath && !isCreationPath(creationPath))
				throw new AnalyticsImportError(
					"CREATION_PATH_INVALID",
					"CreationPath is not canonical.",
				);
			const contentFormatKey =
				projectAuthority?.contentFormatKey ??
				plannedAuthority?.contentFormatKey ??
				textValue(valueFromRow(rawRow, input.mapping, "contentFormatKey")) ??
				null;
			const contentFormatVersion =
				projectAuthority?.contentFormatVersion ??
				plannedAuthority?.contentFormatVersion ??
				safeInteger(
					valueFromRow(rawRow, input.mapping, "contentFormatVersion"),
				) ??
				null;
			if (
				contentFormatKey &&
				contentFormatVersion &&
				!getContentFormatDefinition({
					key: contentFormatKey,
					version: contentFormatVersion,
				})
			) {
				throw new AnalyticsImportError(
					"CONTENT_FORMAT_INVALID",
					"ContentFormat is not in the canonical registry.",
				);
			}
			const pillarId =
				textValue(valueFromRow(rawRow, input.mapping, "pillarId")) ?? null;
			const seriesId =
				textValue(valueFromRow(rawRow, input.mapping, "seriesId")) ?? null;
			if (pillarId && !authorities.pillars.has(pillarId))
				throw new AnalyticsImportError(
					"PILLAR_UNMAPPED",
					"Pillar must reference a canonical strategy dimension.",
				);
			if (seriesId && !authorities.series.has(seriesId))
				throw new AnalyticsImportError(
					"SERIES_UNMAPPED",
					"Series must reference a canonical strategy dimension.",
				);
			if (
				projectAuthority?.channelStrategyId &&
				pillarId &&
				authorities.pillars.get(pillarId)?.strategyId !==
					projectAuthority.channelStrategyId
			)
				throw new AnalyticsImportError(
					"PILLAR_ATTRIBUTION_CONFLICT",
					"Pillar is not part of the canonical project strategy.",
				);
			if (
				projectAuthority?.channelStrategyId &&
				seriesId &&
				authorities.series.get(seriesId)?.strategyId !==
					projectAuthority.channelStrategyId
			)
				throw new AnalyticsImportError(
					"SERIES_ATTRIBUTION_CONFLICT",
					"Series is not part of the canonical project strategy.",
				);

			const usageRecordType =
				textValue(valueFromRow(rawRow, input.mapping, "usageRecordType")) ??
				null;
			const usageRecordId =
				textValue(valueFromRow(rawRow, input.mapping, "usageRecordId")) ?? null;
			if (family === "AI_RENDER_COST") {
				if (
					!usageRecordType ||
					!usageRecordId ||
					!KNOWN_USAGE_RECORD_TYPES.includes(
						usageRecordType as (typeof KNOWN_USAGE_RECORD_TYPES)[number],
					)
				) {
					throw new AnalyticsImportError(
						"COST_USAGE_UNAVAILABLE",
						"AI/render cost requires a supported persisted usage record.",
					);
				}
				const persistedCost = authorities.usage.get(
					`${usageRecordType}:${usageRecordId}`,
				);
				if (
					persistedCost === null ||
					persistedCost === undefined ||
					Number(persistedCost) !== metricValue
				) {
					throw new AnalyticsImportError(
						"COST_USAGE_UNAVAILABLE",
						"No matching persisted usage cost exists; unavailable is not treated as zero.",
					);
				}
			}
			const sourceIdentity = sourceIdentityFor(
				rawRow,
				input.mapping,
				input.sourceIdentity,
			);
			const attributionScope =
				projectId || plannedContentItemId
					? "CONTENT"
					: productId
						? "PRODUCT"
						: canonicalContentType || pillarId || seriesId
							? "UNATTRIBUTED"
							: "CHANNEL";
			const rowForHash = {
				sourceType: input.parsed.sourceType,
				rawRow,
			};
			const sourceRowHash = hash(rowForHash);
			const semantic = {
				workspaceId: input.actor.workspaceId,
				sourceType: input.parsed.sourceType,
				sourceIdentity,
				...dateRange,
				metricFamily: family,
				metricKey,
				metricValue,
				unit: expectedUnit,
				attributionScope,
				projectId,
				plannedContentItemId,
				productId,
				pillarId,
				seriesId,
				contentType: canonicalContentType,
				contentFormatKey,
				contentFormatVersion,
				creationPath,
				usageRecordType,
				usageRecordId,
			};
			acceptedRows.push({
				recordedRangeStart: dateRange.startDate,
				recordedRangeEnd: dateRange.endDate,
				metricFamily: family,
				metricKey,
				metricValue,
				unit: expectedUnit,
				sourceIdentity,
				attributionScope,
				projectId,
				plannedContentItemId,
				productId,
				pillarId,
				seriesId,
				contentType: canonicalContentType,
				contentFormatKey,
				contentFormatVersion,
				creationPath,
				usageRecordType,
				usageRecordId,
				sourceRowHash,
				dedupeKey: hash(semantic),
			});
		} catch (error) {
			const code =
				error instanceof AnalyticsImportError
					? error.code
					: "ANALYTICS_ROW_INVALID";
			rejectionReasons[code] = (rejectionReasons[code] ?? 0) + 1;
		}
	}
	const firstRange = rangeValues[0];
	const range = firstRange
		? {
				startDate: rangeValues.reduce(
					(min, item) => (item.startDate < min ? item.startDate : min),
					firstRange.startDate,
				),
				endDate: rangeValues.reduce(
					(max, item) => (item.endDate > max ? item.endDate : max),
					firstRange.endDate,
				),
			}
		: null;
	return {
		acceptedRows,
		rejectedCount: input.parsed.rows.length - acceptedRows.length,
		rejectionReasons,
		range,
	};
}

async function prepare(
	input: FileInput,
	actor: WorkspaceActor,
): Promise<PreviewPreparation> {
	const timezone = await workspaceTimezone(actor);
	const parsed = parseAnalyticsFile({
		bytes: decodeBase64(input.fileBase64),
		fileName: input.fileName,
		sourceType: input.sourceType,
	});
	const mapping = input.mapping ?? proposeAnalyticsMapping(parsed.headers);
	const mappingIssues = validateAnalyticsMapping(mapping, parsed.headers);
	if (mappingIssues.length > 0) {
		throw new AnalyticsImportError(
			"ANALYTICS_MAPPING_INVALID",
			"Mapping is not supported.",
			{ issues: mappingIssues },
		);
	}
	const sourceIdentity =
		textValue(input.sourceIdentity) ?? mapping.fixed?.sourceIdentity ?? null;
	const normalized = await normalizeRows({
		actor,
		parsed,
		timezone,
		mapping,
		sourceIdentity: sourceIdentity ?? undefined,
	});
	return {
		parsed,
		timezone,
		sourceIdentity,
		mapping,
		mappingFingerprint: mappingFingerprint({
			sourceType: input.sourceType,
			sourceIdentity,
			timezone,
			mapping,
		}),
		...normalized,
	};
}

function importDto(batch: typeof analyticsImportBatch.$inferSelect) {
	return {
		id: batch.id,
		sourceType: batch.sourceType as AnalyticsSourceType,
		sourceIdentity: batch.sourceIdentity,
		originalFilename: batch.originalFilename,
		fileSha256: batch.fileSha256,
		recordedRangeStart: batch.recordedRangeStart,
		recordedRangeEnd: batch.recordedRangeEnd,
		workspaceTimezone: batch.workspaceTimezone,
		rowCount: batch.rowCount,
		acceptedCount: batch.acceptedCount,
		rejectedCount: batch.rejectedCount,
		duplicateCount: batch.duplicateCount,
		createdAt: batch.createdAt,
	};
}

export async function previewAnalyticsImport(
	actor: WorkspaceActor,
	input: FileInput,
) {
	const timezone = await workspaceTimezone(actor);
	const parsed = parseAnalyticsFile({
		bytes: decodeBase64(input.fileBase64),
		fileName: input.fileName,
		sourceType: input.sourceType,
	});
	const mapping = input.mapping ?? proposeAnalyticsMapping(parsed.headers);
	const mappingIssues = validateAnalyticsMapping(mapping, parsed.headers);
	const sourceIdentity =
		textValue(input.sourceIdentity) ?? mapping.fixed?.sourceIdentity ?? null;
	if (mappingIssues.length > 0) {
		return {
			fileSha256: parsed.fileSha256,
			mappingVersion: analyticsMappingVersion,
			mappingFingerprint: mappingFingerprint({
				sourceType: input.sourceType,
				sourceIdentity,
				timezone,
				mapping,
			}),
			workspaceTimezone: timezone,
			headers: parsed.headers,
			sampleRows: parsed.rows.slice(0, 5),
			proposedMapping: mapping,
			mapping,
			mappingIssues,
			acceptedRows: 0,
			rejectedRows: parsed.rows.length,
			rejectionReasons: { ANALYTICS_MAPPING_INVALID: parsed.rows.length },
			recordedRange: null,
			sourceType: input.sourceType,
			sourceIdentity,
			canonicalMetricFamilies: Object.keys(analyticsMetricRegistry),
			canonicalMetricKeys: Object.fromEntries(
				Object.keys(analyticsMetricRegistry).map((family) => [
					family,
					metricKeysForFamily(family),
				]),
			),
		};
	}
	const prepared = await prepare(input, actor);
	return {
		fileSha256: prepared.parsed.fileSha256,
		mappingVersion: analyticsMappingVersion,
		mappingFingerprint: prepared.mappingFingerprint,
		workspaceTimezone: prepared.timezone,
		headers: prepared.parsed.headers,
		sampleRows: prepared.parsed.rows.slice(0, 5),
		proposedMapping: proposeAnalyticsMapping(prepared.parsed.headers),
		mapping: prepared.mapping,
		mappingIssues: [],
		acceptedRows: prepared.acceptedRows.length,
		rejectedRows: prepared.rejectedCount,
		rejectionReasons: prepared.rejectionReasons,
		recordedRange: prepared.range,
		sourceType: input.sourceType,
		sourceIdentity: prepared.sourceIdentity,
		canonicalMetricFamilies: Object.keys(analyticsMetricRegistry),
		canonicalMetricKeys: Object.fromEntries(
			Object.keys(analyticsMetricRegistry).map((family) => [
				family,
				metricKeysForFamily(family),
			]),
		),
	};
}

export async function finalizeAnalyticsImport(
	actor: WorkspaceActor,
	input: FileInput & {
		previewFileSha256: string;
		previewMappingFingerprint: string;
		idempotencyKey: string;
	},
) {
	const prepared = await prepare(input, actor);
	if (
		prepared.parsed.fileSha256 !== input.previewFileSha256 ||
		prepared.mappingFingerprint !== input.previewMappingFingerprint
	) {
		throw new AnalyticsImportError(
			"ANALYTICS_PREVIEW_STALE",
			"The file or mapping changed after preview; preview it again before confirming.",
		);
	}
	const preparedRange = prepared.range;
	if (
		prepared.rejectedCount > 0 ||
		prepared.acceptedRows.length === 0 ||
		!preparedRange
	) {
		throw new AnalyticsImportError(
			"ANALYTICS_IMPORT_VALIDATION_FAILED",
			"Import is atomic: fix rejected rows before confirming.",
			{
				rejectedRows: prepared.rejectedCount,
				reasons: prepared.rejectionReasons,
			},
		);
	}
	const dedupeKey = hash({
		workspaceId: actor.workspaceId,
		sourceType: input.sourceType,
		sourceIdentity: prepared.sourceIdentity,
		mappingFingerprint: prepared.mappingFingerprint,
		rows: prepared.acceptedRows.map((row) => row.dedupeKey).sort(),
	});
	const existing = await db
		.select()
		.from(analyticsImportBatch)
		.where(
			and(
				eq(analyticsImportBatch.workspaceId, actor.workspaceId),
				inArray(analyticsImportBatch.dedupeKey, [dedupeKey]),
			),
		)
		.limit(1);
	if (existing[0]) return { replayed: true, batch: importDto(existing[0]) };
	const existingIdempotency = await db
		.select()
		.from(analyticsImportBatch)
		.where(
			and(
				eq(analyticsImportBatch.workspaceId, actor.workspaceId),
				eq(analyticsImportBatch.idempotencyKey, input.idempotencyKey.trim()),
			),
		)
		.limit(1);
	if (existingIdempotency[0])
		return { replayed: true, batch: importDto(existingIdempotency[0]) };

	try {
		return await db.transaction(async (tx) => {
			const [batch] = await tx
				.insert(analyticsImportBatch)
				.values({
					id: randomUUID(),
					workspaceId: actor.workspaceId,
					sourceType: input.sourceType,
					sourceIdentity: prepared.sourceIdentity,
					originalFilename: prepared.parsed.fileName,
					fileSha256: prepared.parsed.fileSha256,
					recordedRangeStart: preparedRange.startDate,
					recordedRangeEnd: preparedRange.endDate,
					workspaceTimezone: prepared.timezone,
					mappingVersion: analyticsMappingVersion,
					mappingFingerprint: prepared.mappingFingerprint,
					mappingJson: prepared.mapping,
					dedupeKey,
					rowCount: prepared.parsed.rows.length,
					acceptedCount: prepared.acceptedRows.length,
					rejectedCount: 0,
					duplicateCount: 0,
					idempotencyKey: input.idempotencyKey.trim(),
					createdByUserId: actor.userId,
				})
				.onConflictDoNothing()
				.returning();
			if (!batch) {
				const [raced] = await tx
					.select()
					.from(analyticsImportBatch)
					.where(
						and(
							eq(analyticsImportBatch.workspaceId, actor.workspaceId),
							inArray(analyticsImportBatch.dedupeKey, [dedupeKey]),
						),
					)
					.limit(1);
				if (raced) return { replayed: true, batch: importDto(raced) };
				throw new AnalyticsImportError(
					"ANALYTICS_IDEMPOTENCY_CONFLICT",
					"Import idempotency key is already used by another import.",
				);
			}
			const inserted = await tx
				.insert(analyticsMetricSnapshot)
				.values(
					prepared.acceptedRows.map((row) => ({
						id: randomUUID(),
						workspaceId: actor.workspaceId,
						importBatchId: batch.id,
						recordedRangeStart: row.recordedRangeStart,
						recordedRangeEnd: row.recordedRangeEnd,
						metricFamily: row.metricFamily,
						metricKey: row.metricKey,
						metricValue: row.metricValue,
						unit: row.unit,
						sourceIdentity: row.sourceIdentity,
						attributionScope: row.attributionScope,
						projectId: row.projectId,
						plannedContentItemId: row.plannedContentItemId,
						productId: row.productId,
						pillarId: row.pillarId,
						seriesId: row.seriesId,
						contentType: row.contentType,
						contentFormatKey: row.contentFormatKey,
						contentFormatVersion: row.contentFormatVersion,
						creationPath: row.creationPath,
						usageRecordType: row.usageRecordType,
						usageRecordId: row.usageRecordId,
						sourceRowHash: row.sourceRowHash,
						dedupeKey: row.dedupeKey,
					})),
				)
				.onConflictDoNothing()
				.returning({ id: analyticsMetricSnapshot.id });
			const duplicateCount = prepared.acceptedRows.length - inserted.length;
			const [updatedBatch] = await tx
				.update(analyticsImportBatch)
				.set({ duplicateCount })
				.where(eq(analyticsImportBatch.id, batch.id))
				.returning();
			return { replayed: false, batch: importDto(updatedBatch ?? batch) };
		});
	} catch (error) {
		if (postgresCode(error) === "23505") {
			const [raced] = await db
				.select()
				.from(analyticsImportBatch)
				.where(
					and(
						eq(analyticsImportBatch.workspaceId, actor.workspaceId),
						inArray(analyticsImportBatch.dedupeKey, [dedupeKey]),
					),
				)
				.limit(1);
			if (raced) return { replayed: true, batch: importDto(raced) };
		}
		throw error;
	}
}

export async function listAnalyticsImports(actor: WorkspaceActor, limit = 20) {
	const rows = await db
		.select()
		.from(analyticsImportBatch)
		.where(eq(analyticsImportBatch.workspaceId, actor.workspaceId))
		.orderBy(
			desc(analyticsImportBatch.createdAt),
			desc(analyticsImportBatch.id),
		)
		.limit(Math.min(Math.max(limit, 1), 50));
	return { items: rows.map(importDto) };
}

function optionalFilter(condition: boolean, expression: ReturnType<typeof eq>) {
	return condition ? expression : undefined;
}

export async function getAnalyticsReadModel(
	actor: WorkspaceActor,
	input?: Partial<AnalyticsReadModelFilter>,
) {
	const timezone = await workspaceTimezone(actor);
	const defaults = defaultAnalyticsDateRange(new Date(), timezone);
	const startDate = input?.startDate ?? defaults.startDate;
	const endDate = input?.endDate ?? defaults.endDate;
	const filters = {
		startDate,
		endDate,
		metricFamily: input?.metricFamily,
		sourceType: input?.sourceType,
		sourceIdentity: input?.sourceIdentity,
		contentType: input?.contentType,
		pillarId: input?.pillarId,
		seriesId: input?.seriesId,
		contentFormatKey: input?.contentFormatKey,
		creationPath: input?.creationPath,
		productId: input?.productId,
	};
	const rows = await db
		.select({
			metricFamily: analyticsMetricSnapshot.metricFamily,
			metricKey: analyticsMetricSnapshot.metricKey,
			metricValue: analyticsMetricSnapshot.metricValue,
			unit: analyticsMetricSnapshot.unit,
			sourceType: analyticsImportBatch.sourceType,
			sourceIdentity: analyticsMetricSnapshot.sourceIdentity,
			contentType: analyticsMetricSnapshot.contentType,
			pillarId: analyticsMetricSnapshot.pillarId,
			seriesId: analyticsMetricSnapshot.seriesId,
			contentFormatKey: analyticsMetricSnapshot.contentFormatKey,
			creationPath: analyticsMetricSnapshot.creationPath,
			productId: analyticsMetricSnapshot.productId,
			attributionScope: analyticsMetricSnapshot.attributionScope,
		})
		.from(analyticsMetricSnapshot)
		.innerJoin(
			analyticsImportBatch,
			eq(analyticsMetricSnapshot.importBatchId, analyticsImportBatch.id),
		)
		.where(
			and(
				eq(analyticsMetricSnapshot.workspaceId, actor.workspaceId),
				gte(analyticsMetricSnapshot.recordedRangeEnd, startDate),
				lte(analyticsMetricSnapshot.recordedRangeStart, endDate),
				optionalFilter(
					Boolean(input?.metricFamily),
					eq(analyticsMetricSnapshot.metricFamily, input?.metricFamily ?? ""),
				),
				optionalFilter(
					Boolean(input?.sourceType),
					eq(analyticsImportBatch.sourceType, input?.sourceType ?? ""),
				),
				optionalFilter(
					Boolean(input?.sourceIdentity),
					eq(
						analyticsMetricSnapshot.sourceIdentity,
						input?.sourceIdentity ?? "",
					),
				),
				optionalFilter(
					Boolean(input?.contentType),
					eq(analyticsMetricSnapshot.contentType, input?.contentType ?? ""),
				),
				optionalFilter(
					Boolean(input?.pillarId),
					eq(analyticsMetricSnapshot.pillarId, input?.pillarId ?? ""),
				),
				optionalFilter(
					Boolean(input?.seriesId),
					eq(analyticsMetricSnapshot.seriesId, input?.seriesId ?? ""),
				),
				optionalFilter(
					Boolean(input?.contentFormatKey),
					eq(
						analyticsMetricSnapshot.contentFormatKey,
						input?.contentFormatKey ?? "",
					),
				),
				optionalFilter(
					Boolean(input?.creationPath),
					eq(analyticsMetricSnapshot.creationPath, input?.creationPath ?? ""),
				),
				optionalFilter(
					Boolean(input?.productId),
					eq(analyticsMetricSnapshot.productId, input?.productId ?? ""),
				),
			),
		);
	const aggregateRows = rows.map(
		(row) =>
			({
				...row,
				metricFamily:
					row.metricFamily as AnalyticsSnapshotForAggregation["metricFamily"],
				metricValue: Number(row.metricValue),
				metricKey: row.metricKey,
				unit: row.unit,
				sourceType:
					row.sourceType as AnalyticsSnapshotForAggregation["sourceType"],
				contentType:
					row.contentType as AnalyticsSnapshotForAggregation["contentType"],
				creationPath:
					row.creationPath as AnalyticsSnapshotForAggregation["creationPath"],
				attributionScope:
					row.attributionScope as AnalyticsSnapshotForAggregation["attributionScope"],
			}) satisfies AnalyticsSnapshotForAggregation,
	);
	const aggregates = aggregateAnalyticsSnapshots(aggregateRows);
	const imports = await listAnalyticsImports(actor, 10);
	const dimensionIds = {
		product: [
			...new Set(aggregateRows.map((row) => row.productId).filter(Boolean)),
		] as string[],
		pillar: [
			...new Set(aggregateRows.map((row) => row.pillarId).filter(Boolean)),
		] as string[],
		series: [
			...new Set(aggregateRows.map((row) => row.seriesId).filter(Boolean)),
		] as string[],
	};
	const [products, pillars, series] = await Promise.all([
		dimensionIds.product.length
			? db
					.select({ id: product.id, label: product.name })
					.from(product)
					.where(
						and(
							eq(product.workspaceId, actor.workspaceId),
							inArray(product.id, dimensionIds.product),
						),
					)
			: [],
		dimensionIds.pillar.length
			? db
					.select({
						id: channelStrategyPillar.id,
						label: channelStrategyPillar.name,
					})
					.from(channelStrategyPillar)
					.where(inArray(channelStrategyPillar.id, dimensionIds.pillar))
			: [],
		dimensionIds.series.length
			? db
					.select({
						id: channelStrategySeries.id,
						label: channelStrategySeries.name,
					})
					.from(channelStrategySeries)
					.where(inArray(channelStrategySeries.id, dimensionIds.series))
			: [],
	]);
	const cost = aggregates.find((row) => row.metricFamily === "AI_RENDER_COST");
	return {
		timezone,
		filters,
		channelGrowth: {
			aggregates: aggregates.filter(
				(row) => row.metricFamily === "CHANNEL_GROWTH",
			),
			sampleSize: aggregateRows.filter(
				(row) => row.metricFamily === "CHANNEL_GROWTH",
			).length,
		},
		affiliateMonetization: {
			aggregates: aggregates.filter(
				(row) => row.metricFamily === "AFFILIATE_MONETIZATION",
			),
			sampleSize: aggregateRows.filter(
				(row) => row.metricFamily === "AFFILIATE_MONETIZATION",
			).length,
		},
		cost: cost
			? {
					available: true,
					totalMicros: cost.total,
					sampleSize: cost.sampleSize,
					insufficientSample: cost.insufficientSample,
				}
			: {
					available: false,
					totalMicros: null,
					sampleSize: 0,
					insufficientSample: false,
				},
		dimensions: {
			contentTypes: [
				...new Set(aggregateRows.map((row) => row.contentType).filter(Boolean)),
			],
			pillars,
			series,
			products,
		},
		unattributedSampleSize: aggregateRows.filter(
			(row) => row.attributionScope === "UNATTRIBUTED",
		).length,
		insufficientSampleThreshold: analyticsMinimumSampleSize,
		correlationNote:
			"Số liệu mô tả trong mẫu đã nhập; không phải kết luận nhân quả hay khuyến nghị.",
		imports: imports.items,
	};
}
