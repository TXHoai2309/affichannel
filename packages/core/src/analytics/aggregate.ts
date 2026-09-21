import {
	type AnalyticsMetricFamily,
	type AnalyticsSnapshotForAggregation,
	analyticsMinimumSampleSize,
} from "./types";

export type AnalyticsAggregate = {
	metricFamily: AnalyticsMetricFamily;
	metricKey: string;
	unit: string;
	total: number;
	average: number;
	sampleSize: number;
	insufficientSample: boolean;
};

export function aggregateAnalyticsSnapshots(
	rows: readonly AnalyticsSnapshotForAggregation[],
) {
	const groups = new Map<string, AnalyticsAggregate>();
	for (const row of rows) {
		const key = `${row.metricFamily}\u0000${row.metricKey}\u0000${row.unit}`;
		const current = groups.get(key);
		if (current) {
			current.total += row.metricValue;
			current.sampleSize += 1;
			current.average = current.total / current.sampleSize;
			current.insufficientSample =
				current.sampleSize < analyticsMinimumSampleSize;
			continue;
		}
		groups.set(key, {
			metricFamily: row.metricFamily,
			metricKey: row.metricKey,
			unit: row.unit,
			total: row.metricValue,
			average: row.metricValue,
			sampleSize: 1,
			insufficientSample: true,
		});
	}
	return [...groups.values()].sort((a, b) =>
		`${a.metricFamily}:${a.metricKey}`.localeCompare(
			`${b.metricFamily}:${b.metricKey}`,
		),
	);
}
