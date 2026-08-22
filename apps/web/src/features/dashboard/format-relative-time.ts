const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("vi", {
	numeric: "auto",
});

export function formatRelativeTime(value: string | Date) {
	const elapsedSeconds = Math.round(
		(new Date(value).getTime() - Date.now()) / 1_000,
	);

	if (Math.abs(elapsedSeconds) < 60) {
		return RELATIVE_TIME_FORMATTER.format(elapsedSeconds, "second");
	}

	const elapsedMinutes = Math.round(elapsedSeconds / 60);
	if (Math.abs(elapsedMinutes) < 60) {
		return RELATIVE_TIME_FORMATTER.format(elapsedMinutes, "minute");
	}

	const elapsedHours = Math.round(elapsedMinutes / 60);
	if (Math.abs(elapsedHours) < 24) {
		return RELATIVE_TIME_FORMATTER.format(elapsedHours, "hour");
	}

	const elapsedDays = Math.round(elapsedHours / 24);
	if (Math.abs(elapsedDays) < 7) {
		return RELATIVE_TIME_FORMATTER.format(elapsedDays, "day");
	}

	const elapsedWeeks = Math.round(elapsedDays / 7);
	if (Math.abs(elapsedWeeks) < 5) {
		return RELATIVE_TIME_FORMATTER.format(elapsedWeeks, "week");
	}

	return RELATIVE_TIME_FORMATTER.format(Math.round(elapsedDays / 30), "month");
}
