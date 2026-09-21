import { z } from "zod";

export const analyticsSourceTypes = ["MANUAL_CSV", "MANUAL_XLSX"] as const;
export type AnalyticsSourceType = (typeof analyticsSourceTypes)[number];

export const analyticsMetricFamilies = [
	"CHANNEL_GROWTH",
	"AFFILIATE_MONETIZATION",
	"AI_RENDER_COST",
] as const;
export type AnalyticsMetricFamily = (typeof analyticsMetricFamilies)[number];

export const analyticsAttributionScopes = [
	"CHANNEL",
	"CONTENT",
	"PRODUCT",
	"UNATTRIBUTED",
] as const;
export type AnalyticsAttributionScope =
	(typeof analyticsAttributionScopes)[number];

export const analyticsDimensionKeys = [
	"contentType",
	"pillarId",
	"seriesId",
	"contentFormatKey",
	"creationPath",
	"productId",
] as const;
export type AnalyticsDimensionKey = (typeof analyticsDimensionKeys)[number];

export const analyticsMetricRegistry = {
	CHANNEL_GROWTH: {
		views: "COUNT",
		impressions: "COUNT",
		reach: "COUNT",
		watch_time_seconds: "SECONDS",
		followers_change: "COUNT",
		subscribers_change: "COUNT",
		likes: "COUNT",
		comments: "COUNT",
		shares: "COUNT",
		saves: "COUNT",
		engagement_rate: "RATE",
	},
	AFFILIATE_MONETIZATION: {
		clicks: "COUNT",
		orders: "COUNT",
		conversions: "COUNT",
		revenue: "CURRENCY",
		commission: "CURRENCY",
	},
	AI_RENDER_COST: {
		actual_cost_micros: "MICROS",
	},
} as const satisfies Record<AnalyticsMetricFamily, Record<string, string>>;

export type AnalyticsMetricKey = {
	[K in AnalyticsMetricFamily]: keyof (typeof analyticsMetricRegistry)[K];
}[AnalyticsMetricFamily];

export const analyticsMappingVersion = "analytics-import.v1" as const;
export const analyticsMinimumSampleSize = 5;

export const analyticsMetricFamilySchema = z.enum(analyticsMetricFamilies);
export const analyticsSourceTypeSchema = z.enum(analyticsSourceTypes);
export const analyticsAttributionScopeSchema = z.enum(
	analyticsAttributionScopes,
);

export type AnalyticsColumnMapping = {
	recordedDate?: string;
	recordedRangeStart?: string;
	recordedRangeEnd?: string;
	metricFamily?: string;
	metricKey?: string;
	metricValue: string;
	unit?: string;
	sourceIdentity?: string;
	projectId?: string;
	plannedContentItemId?: string;
	productId?: string;
	pillarId?: string;
	seriesId?: string;
	contentType?: string;
	contentFormatKey?: string;
	contentFormatVersion?: string;
	creationPath?: string;
	usageRecordType?: string;
	usageRecordId?: string;
};

export type AnalyticsFixedMapping = {
	metricFamily?: AnalyticsMetricFamily;
	metricKey?: string;
	unit?: string;
	sourceIdentity?: string;
};

export type AnalyticsImportMapping = {
	columns: AnalyticsColumnMapping;
	fixed?: AnalyticsFixedMapping;
};

export type AnalyticsReadModelFilter = {
	startDate: string;
	endDate: string;
	metricFamily?: AnalyticsMetricFamily;
	sourceType?: AnalyticsSourceType;
	sourceIdentity?: string;
	contentType?: "ORGANIC" | "AFFILIATE";
	pillarId?: string;
	seriesId?: string;
	contentFormatKey?: string;
	creationPath?: "QUICK_IMAGE" | "SCRIPTED" | "MEDIA_FIRST";
	productId?: string;
};

export type AnalyticsSnapshotForAggregation = {
	metricFamily: AnalyticsMetricFamily;
	metricKey: string;
	metricValue: number;
	unit: string;
	sourceType: AnalyticsSourceType;
	sourceIdentity: string | null;
	contentType: "ORGANIC" | "AFFILIATE" | null;
	pillarId: string | null;
	seriesId: string | null;
	contentFormatKey: string | null;
	creationPath: "QUICK_IMAGE" | "SCRIPTED" | "MEDIA_FIRST" | null;
	productId: string | null;
	attributionScope: AnalyticsAttributionScope;
};
