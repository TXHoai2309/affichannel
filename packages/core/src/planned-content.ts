import { z } from "zod";
import type { ChannelStrategyReadModel } from "./channel-strategy";
import {
	CONTENT_FORMAT_DEFAULTS,
	getContentFormatDefinition,
	validateContentFormatAssignment,
} from "./content-format/registry";
import {
	CONTENT_TYPES,
	type ContentType,
	CREATION_PATHS,
	type CreationPath,
} from "./project/channel-first-types";

export const CALENDAR_TIME_ZONE_DEFAULT = "Asia/Ho_Chi_Minh";
export const PLANNED_CONTENT_ITEM_CONVERSION_STATES = [
	"UNCONVERTED",
	"CONVERTED",
] as const;
export type PlannedContentItemConversionState =
	(typeof PLANNED_CONTENT_ITEM_CONVERSION_STATES)[number];

const uuid = z.string().uuid();
export const calendarLocalDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD.")
	.refine((value) => {
		const [year, month, day] = value.split("-").map(Number);
		if (!year || !month || !day) return false;
		const date = new Date(Date.UTC(year, month - 1, day));
		return (
			date.getUTCFullYear() === year &&
			date.getUTCMonth() === month - 1 &&
			date.getUTCDate() === day
		);
	}, "Date is not a real calendar date.");
export const calendarLocalTimeSchema = z
	.string()
	.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must use HH:mm.");
const localDate = calendarLocalDateSchema;
const localTime = calendarLocalTimeSchema;
const text = (max: number) => z.string().trim().min(1).max(max);

const plannedContentItemFieldsSchema = z
	.object({
		scheduledDate: localDate,
		scheduledTime: localTime,
		timezone: text(100),
		contentType: z.enum(CONTENT_TYPES),
		creationPath: z.enum(CREATION_PATHS),
		contentFormat: z
			.object({ key: text(120), version: z.number().int().positive() })
			.strict(),
		pillar: text(160),
		series: text(160).nullable(),
		title: text(160),
		brief: text(2_000),
		productId: uuid.nullable(),
	})
	.strict();

function validatePlannedContentItemSemantic(
	value: z.infer<typeof plannedContentItemFieldsSchema>,
	context: z.RefinementCtx,
) {
	if (!isValidTimeZone(value.timezone)) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["timezone"],
			message: "Timezone is not supported by the runtime.",
		});
	}
	const assignment = validateContentFormatAssignment(
		value.contentFormat,
		value.creationPath,
	);
	if (!assignment.success) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["contentFormat"],
			message: assignment.reason,
		});
	}
}

export const plannedContentItemSemanticSchema = plannedContentItemFieldsSchema
	.superRefine(validatePlannedContentItemSemantic)
	.transform((value) => ({ ...value, title: value.title.trim() }));

export const plannedContentItemWriteSchema = plannedContentItemFieldsSchema
	.extend({
		expectedVersion: z.number().int().positive().nullable().optional(),
	})
	.strict()
	.superRefine(validatePlannedContentItemSemantic)
	.transform(({ expectedVersion: _expectedVersion, ...value }) => value);

export type PlannedContentItemSemantic = z.infer<
	typeof plannedContentItemSemanticSchema
>;
export type PlannedContentItemWrite = z.infer<
	typeof plannedContentItemWriteSchema
>;

export type PlannedContentItemReadModel = PlannedContentItemSemantic & {
	id: string;
	workspaceId: string;
	strategyId: string | null;
	strategyVersion: number | null;
	version: number;
	conversionState: PlannedContentItemConversionState;
	conversionProjectId: string | null;
	createdAt: Date;
	updatedAt: Date;
};

export type CalendarWindow = {
	startDate: string;
	endDate: string;
	timezone: string;
};

export function isValidTimeZone(timezone: string) {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
		return true;
	} catch {
		return false;
	}
}

function datePartsInTimeZone(date: Date, timezone: string) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const values = Object.fromEntries(
		parts
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, part.value]),
	);
	return {
		year: Number(values.year),
		month: Number(values.month),
		day: Number(values.day),
	};
}

export function getWorkspaceLocalDate(
	date: Date,
	timezone = CALENDAR_TIME_ZONE_DEFAULT,
) {
	const parts = datePartsInTimeZone(date, timezone);
	return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addCalendarDays(dateValue: string, amount: number) {
	const [year = 1970, month = 1, day = 1] = dateValue.split("-").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
	return date.toISOString().slice(0, 10);
}

export function getSevenDayWindow(
	date = new Date(),
	timezone = CALENDAR_TIME_ZONE_DEFAULT,
): CalendarWindow {
	const startDate = getWorkspaceLocalDate(date, timezone);
	return { startDate, endDate: addCalendarDays(startDate, 6), timezone };
}

export function roundNearestFeasibleCount(total: number, percentage: number) {
	return Math.floor((total * percentage) / 100 + 0.5);
}

export type MixCounts = {
	total: number;
	organic: number;
	affiliate: number;
	organicPercentage: number;
	affiliatePercentage: number;
};

export function calculateMixTargetCounts(
	total: number,
	target: { organicPercentage: number; affiliatePercentage: number },
): MixCounts {
	const affiliate = roundNearestFeasibleCount(
		total,
		target.affiliatePercentage,
	);
	const organic = total - affiliate;
	return {
		total,
		organic,
		affiliate,
		organicPercentage: total === 0 ? 0 : (organic / total) * 100,
		affiliatePercentage: total === 0 ? 0 : (affiliate / total) * 100,
	};
}

export function calculateMixActualCounts(
	items: Array<Pick<PlannedContentItemSemantic, "contentType">>,
) {
	const organic = items.filter((item) => item.contentType === "ORGANIC").length;
	const affiliate = items.length - organic;
	return {
		total: items.length,
		organic,
		affiliate,
		organicPercentage: items.length === 0 ? 0 : (organic / items.length) * 100,
		affiliatePercentage:
			items.length === 0 ? 0 : (affiliate / items.length) * 100,
	};
}

export function hasMixDeviation(
	actual: Pick<MixCounts, "organic" | "affiliate">,
	target: Pick<MixCounts, "organic" | "affiliate">,
) {
	return (
		actual.organic !== target.organic || actual.affiliate !== target.affiliate
	);
}

function compatiblePathAndFormat(
	strategy: ChannelStrategyReadModel,
	index: number,
) {
	const paths = strategy.preferredCreationPaths.filter(
		(path): path is CreationPath =>
			path === "SCRIPTED" || path === "QUICK_IMAGE",
	);
	const candidates = paths.length > 0 ? paths : ["SCRIPTED" as const];
	for (let offset = 0; offset < candidates.length; offset += 1) {
		const path = candidates[(index + offset) % candidates.length] ?? "SCRIPTED";
		const preferred = strategy.preferredContentFormats.find(
			(format) => validateContentFormatAssignment(format, path).success,
		);
		if (preferred) return { path, format: preferred };
		const fallback = CONTENT_FORMAT_DEFAULTS[path];
		if (getContentFormatDefinition(fallback)) return { path, format: fallback };
	}
	return {
		path: "SCRIPTED" as const,
		format: CONTENT_FORMAT_DEFAULTS.SCRIPTED,
	};
}

function scheduledTime(index: number, dayCount: number) {
	const slot = Math.floor(index / Math.max(dayCount, 1));
	return `${String(9 + (slot % 8)).padStart(2, "0")}:00`;
}

export function generateDeterministicPlan(
	strategy: ChannelStrategyReadModel,
	window: CalendarWindow,
): PlannedContentItemSemantic[] {
	const total = strategy.postingFrequency.postsPerWeek;
	const mix = calculateMixTargetCounts(
		total,
		strategy.organicAffiliateMixTarget,
	);
	const preferredDays = strategy.postingFrequency.preferredDays.length
		? [...strategy.postingFrequency.preferredDays].sort((a, b) => a - b)
		: [0, 1, 2, 3, 4, 5, 6];
	const items: PlannedContentItemSemantic[] = [];
	for (let index = 0; index < total; index += 1) {
		const dayOffset = preferredDays[index % preferredDays.length] ?? 0;
		const contentType: ContentType =
			index < mix.affiliate ? "AFFILIATE" : "ORGANIC";
		const pillar =
			strategy.contentPillars[index % strategy.contentPillars.length] ??
			"General";
		const series =
			strategy.contentSeries[index % strategy.contentSeries.length] ?? null;
		const assignment = compatiblePathAndFormat(strategy, index);
		items.push({
			scheduledDate: addCalendarDays(window.startDate, dayOffset),
			scheduledTime: scheduledTime(index, preferredDays.length),
			timezone: window.timezone,
			contentType,
			creationPath: assignment.path,
			contentFormat: assignment.format,
			pillar,
			series,
			title: `${pillar} · ${series ?? strategy.niche}`.slice(0, 160),
			brief: `Plan ${contentType.toLocaleLowerCase("en-US")} về ${pillar}${series ? ` trong series ${series}` : ""}.`,
			productId: null,
		});
	}
	return items;
}
