import { z } from "zod";

import {
	analyticsDimensionKeys,
	analyticsMetricFamilies,
	analyticsMetricRegistry,
	analyticsSourceTypes,
} from "./types";

const optionalColumn = z.string().trim().min(1).max(160).optional();

export const analyticsColumnMappingSchema = z
	.object({
		recordedDate: optionalColumn,
		recordedRangeStart: optionalColumn,
		recordedRangeEnd: optionalColumn,
		metricFamily: optionalColumn,
		metricKey: optionalColumn,
		metricValue: z.string().trim().min(1).max(160),
		unit: optionalColumn,
		sourceIdentity: optionalColumn,
		projectId: optionalColumn,
		plannedContentItemId: optionalColumn,
		productId: optionalColumn,
		pillarId: optionalColumn,
		seriesId: optionalColumn,
		contentType: optionalColumn,
		contentFormatKey: optionalColumn,
		contentFormatVersion: optionalColumn,
		creationPath: optionalColumn,
		usageRecordType: optionalColumn,
		usageRecordId: optionalColumn,
	})
	.strict();

export const analyticsFixedMappingSchema = z
	.object({
		metricFamily: z.enum(analyticsMetricFamilies).optional(),
		metricKey: z.string().trim().min(1).max(120).optional(),
		unit: z.string().trim().min(1).max(40).optional(),
		sourceIdentity: z.string().trim().min(1).max(160).optional(),
	})
	.strict();

export function metricKeysForFamily(family: string) {
	if (!(analyticsMetricFamilies as readonly string[]).includes(family)) {
		return [];
	}
	return Object.keys(
		analyticsMetricRegistry[family as keyof typeof analyticsMetricRegistry],
	);
}

export function canonicalDimensionKeys() {
	return [...analyticsDimensionKeys];
}

export function isSupportedSourceType(
	value: unknown,
): value is (typeof analyticsSourceTypes)[number] {
	return (
		typeof value === "string" &&
		(analyticsSourceTypes as readonly string[]).includes(value)
	);
}
