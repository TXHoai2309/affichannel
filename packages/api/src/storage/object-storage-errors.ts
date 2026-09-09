/**
 * Normalize only provider signals that positively identify a missing object.
 * Do not classify generic 4xx/5xx or unknown errors as absence.
 */
export function isObjectNotFoundError(error: unknown) {
	const seen = new Set<unknown>();
	let current: unknown = error;
	while (current && typeof current === "object" && !seen.has(current)) {
		seen.add(current);
		const value = current as {
			name?: unknown;
			code?: unknown;
			status?: unknown;
			statusCode?: unknown;
			$metadata?: { httpStatusCode?: unknown };
			cause?: unknown;
		};
		const names = [value.name, value.code].filter(
			(candidate): candidate is string => typeof candidate === "string",
		);
		if (
			names.some((candidate) => ["NotFound", "NoSuchKey"].includes(candidate))
		)
			return true;
		const statuses = [
			value.status,
			value.statusCode,
			value.$metadata?.httpStatusCode,
		];
		if (statuses.some((candidate) => candidate === 404 || candidate === "404"))
			return true;
		current = value.cause;
	}
	return false;
}
