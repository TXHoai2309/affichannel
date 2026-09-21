export type NormalizedDateRange = {
	startDate: string;
	endDate: string;
};

function dateParts(date: Date, timezone: string) {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	return Object.fromEntries(
		formatter.formatToParts(date).map((part) => [part.type, part.value]),
	) as Record<string, string>;
}

export function isValidIsoDate(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parts = value.split("-").map(Number);
	const year = parts[0];
	const month = parts[1];
	const day = parts[2];
	if (year === undefined || month === undefined || day === undefined)
		return false;
	const candidate = new Date(Date.UTC(year, month - 1, day));
	return (
		candidate.getUTCFullYear() === year &&
		candidate.getUTCMonth() === month - 1 &&
		candidate.getUTCDate() === day
	);
}

function localDateFromParts(parts: Record<string, string>) {
	return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDateValue(value: unknown, timezone: string) {
	if (typeof value === "number") {
		return undefined;
	}
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (isValidIsoDate(trimmed)) return trimmed;
	if (!trimmed) return undefined;
	const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
	const candidate = hasOffset
		? new Date(trimmed)
		: new Date(trimmed.replace(" ", "T"));
	if (Number.isNaN(candidate.getTime())) return undefined;
	return localDateFromParts(dateParts(candidate, hasOffset ? timezone : "UTC"));
}

export function normalizeRecordedDate(
	value: unknown,
	timezone: string,
	options?: { excelSerialToDate?: (value: number) => Date | undefined },
) {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
	} catch {
		return undefined;
	}
	if (typeof value === "number" && options?.excelSerialToDate) {
		const date = options.excelSerialToDate(value);
		return date ? localDateFromParts(dateParts(date, timezone)) : undefined;
	}
	return parseDateValue(value, timezone);
}

export function normalizeDateRange(
	start: unknown,
	end: unknown,
	timezone: string,
	options?: { excelSerialToDate?: (value: number) => Date | undefined },
): NormalizedDateRange | undefined {
	const startDate = normalizeRecordedDate(start, timezone, options);
	const endDate = normalizeRecordedDate(end ?? start, timezone, options);
	if (!startDate || !endDate || endDate < startDate) return undefined;
	return { startDate, endDate };
}

export function defaultAnalyticsDateRange(now: Date, timezone: string) {
	const endDate = localDateFromParts(dateParts(now, timezone));
	const parts = endDate.split("-").map(Number);
	const year = parts[0] ?? 1970;
	const month = parts[1] ?? 1;
	const day = parts[2] ?? 1;
	const start = new Date(Date.UTC(year, month - 1, day));
	start.setUTCDate(start.getUTCDate() - 29);
	return {
		startDate: start.toISOString().slice(0, 10),
		endDate,
	};
}
