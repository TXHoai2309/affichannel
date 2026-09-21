import {
	AnalyticsImportError,
	parseAnalyticsFile,
	proposeAnalyticsMapping,
	validateAnalyticsMapping,
} from "@affichannel/api/services/analytics-import-parser";
import {
	aggregateAnalyticsSnapshots,
	analyticsMetricRegistry,
	normalizeDateRange,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

describe("US27 analytics domain", () => {
	it("keeps mixed channel and affiliate metrics in separate families", () => {
		const rows = [
			{
				metricFamily: "CHANNEL_GROWTH" as const,
				metricKey: "views",
				metricValue: 100,
				unit: "COUNT",
				sourceType: "MANUAL_CSV" as const,
				sourceIdentity: "organic-export",
				contentType: "ORGANIC" as const,
				pillarId: null,
				seriesId: null,
				contentFormatKey: null,
				creationPath: null,
				productId: null,
				attributionScope: "CHANNEL" as const,
			},
			{
				metricFamily: "AFFILIATE_MONETIZATION" as const,
				metricKey: "commission",
				metricValue: 250,
				unit: "CURRENCY",
				sourceType: "MANUAL_CSV" as const,
				sourceIdentity: "affiliate-export",
				contentType: "AFFILIATE" as const,
				pillarId: null,
				seriesId: null,
				contentFormatKey: null,
				creationPath: null,
				productId: null,
				attributionScope: "CHANNEL" as const,
			},
		];

		const aggregates = aggregateAnalyticsSnapshots(rows);
		expect(aggregates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					metricFamily: "CHANNEL_GROWTH",
					metricKey: "views",
					total: 100,
				}),
				expect.objectContaining({
					metricFamily: "AFFILIATE_MONETIZATION",
					metricKey: "commission",
					total: 250,
				}),
			]),
		);
		expect(aggregates).toHaveLength(2);
	});

	it("uses the workspace timezone for offset timestamps and rejects reversed ranges", () => {
		expect(
			normalizeDateRange(
				"2026-09-20T16:30:00Z",
				"2026-09-20T17:30:00Z",
				"Asia/Ho_Chi_Minh",
			),
		).toEqual({ startDate: "2026-09-20", endDate: "2026-09-21" });
		expect(
			normalizeDateRange("2026-09-21", "2026-09-20", "Asia/Ho_Chi_Minh"),
		).toBeUndefined();
	});

	it("parses CSV as inert data and proposes only server-supported mappings", () => {
		const csv =
			"recorded_date,metric_family,metric_key,value\n2026-09-20,CHANNEL_GROWTH,views,=1+1\n";
		const parsed = parseAnalyticsFile({
			bytes: new TextEncoder().encode(csv),
			fileName: "growth.csv",
			sourceType: "MANUAL_CSV",
		});
		const mapping = proposeAnalyticsMapping(parsed.headers);
		expect(parsed.rows[0]?.value).toBe("=1+1");
		expect(mapping.columns.metricValue).toBe("value");
		expect(validateAnalyticsMapping(mapping, parsed.headers)).toEqual([]);
		expect(analyticsMetricRegistry.CHANNEL_GROWTH.views).toBe("COUNT");
	});

	it("rejects formula cells in XLSX instead of using cached values", () => {
		const sheet = XLSX.utils.aoa_to_sheet([
			["recorded_date", "metric_family", "metric_key", "value"],
			["2026-09-20", "CHANNEL_GROWTH", "views", { f: "1+1", v: 2 }],
		]);
		const workbook = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(workbook, sheet, "Analytics");
		const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
		expect(() =>
			parseAnalyticsFile({
				bytes: new Uint8Array(bytes),
				fileName: "growth.xlsx",
				sourceType: "MANUAL_XLSX",
			}),
		).toThrowError(AnalyticsImportError);
		try {
			parseAnalyticsFile({
				bytes: new Uint8Array(bytes),
				fileName: "growth.xlsx",
				sourceType: "MANUAL_XLSX",
			});
		} catch (error) {
			expect(error).toMatchObject({ code: "ANALYTICS_FORMULA_UNSUPPORTED" });
		}
	});
});
