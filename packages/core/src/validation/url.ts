import { z } from "zod";

export function optionalUrl(label: string, protocols: readonly string[]) {
	return z
		.string()
		.trim()
		.max(2_048, `${label} tối đa 2048 ký tự.`)
		.optional()
		.transform((value) => value || undefined)
		.refine((value) => {
			if (!value) {
				return true;
			}

			try {
				const parsed = new URL(value);
				return (
					Boolean(parsed.hostname) &&
					protocols.includes(parsed.protocol.toLowerCase())
				);
			} catch {
				return false;
			}
		}, `${label} có protocol không hợp lệ.`);
}

export const optionalHttpUrl = (label: string) =>
	optionalUrl(label, ["http:", "https:"]);

export const optionalHttpsUrl = (label: string) =>
	optionalUrl(label, ["https:"]);
