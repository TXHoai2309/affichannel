type JsonPrimitive = string | number | boolean | null;
export type CanonicalJsonValue =
	| JsonPrimitive
	| CanonicalJsonValue[]
	| { [key: string]: CanonicalJsonValue };

function normalize(value: unknown, path: string): CanonicalJsonValue {
	if (value === null) return null;
	if (typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(`Non-finite number at ${path}.`);
		}
		return value;
	}
	if (value === undefined) throw new TypeError(`Undefined value at ${path}.`);
	if (typeof value !== "object") {
		throw new TypeError(`Unsupported value at ${path}.`);
	}
	if (Array.isArray(value)) {
		return value.map((item, index) => normalize(item, `${path}[${index}]`));
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`Non-plain object at ${path}.`);
	}
	const result: { [key: string]: CanonicalJsonValue } = {};
	for (const key of Object.keys(value).sort()) {
		result[key] = normalize((value as Record<string, unknown>)[key], `${path}.${key}`);
	}
	return result;
}

export function canonicalizeJson(value: unknown): string {
	return JSON.stringify(normalize(value, "$"));
}
