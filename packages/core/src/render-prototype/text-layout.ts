import { z } from "zod";

export const t09TextLayoutVersion = "affichannel-text-layout-v1" as const;

const textBoxSchema = z
	.object({
		xPx: z.number().int().finite(),
		yPx: z.number().int().finite(),
		widthPx: z.number().int().positive(),
		heightPx: z.number().int().positive(),
	})
	.strict();

export const t09TextLayoutInputSchema = z
	.object({
		text: z.string().min(1),
		box: textBoxSchema,
		fontStableId: z.string().trim().min(1),
		fontFamily: z.string().trim().min(1),
		fontWeight: z.union([z.literal(400), z.literal(600), z.literal(700)]),
		fontSizePx: z.number().int().positive(),
		lineHeightPx: z.number().int().positive(),
		textAlign: z.enum(["LEFT", "CENTER", "RIGHT"]),
		maxLines: z.number().int().positive(),
		fontContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();

export type T09TextLayoutInput = z.infer<typeof t09TextLayoutInputSchema>;

export type T09FontMetrics = Readonly<{
	fontStableId: string;
	fontFamily: string;
	fontWeight: 400 | 600 | 700;
	fontContentSha256: string;
	unitsPerEm: number;
	ascent: number;
	hasGlyphs: (text: string) => boolean;
	measureUnits: (text: string) => number;
}>;

export type T09MaterializedTextLine = Readonly<{
	lineIndex: number;
	text: string;
	xPx: number;
	baselineYPx: number;
	measuredWidthPx: number;
	fontStableId: string;
	fontSizePx: number;
	lineHeightPx: number;
}>;

export type T09TextLayoutResult = Readonly<{
	version: typeof t09TextLayoutVersion;
	normalizedText: string;
	box: T09TextLayoutInput["box"];
	fontStableId: string;
	fontContentSha256: string;
	fontSizePx: number;
	lineHeightPx: number;
	textAlign: T09TextLayoutInput["textAlign"];
	lines: readonly T09MaterializedTextLine[];
}>;

export class T09TextLayoutError extends Error {
	readonly code:
		| "TEXT_LAYOUT_INVALID"
		| "TEXT_LAYOUT_UNSUPPORTED_GLYPH"
		| "TEXT_LAYOUT_OVERFLOW";

	constructor(code: T09TextLayoutError["code"], message: string) {
		super(message);
		this.name = "T09TextLayoutError";
		this.code = code;
	}
}

function roundHalfUp(numerator: number, denominator: number): number {
	if (
		!Number.isInteger(numerator) ||
		!Number.isInteger(denominator) ||
		denominator <= 0
	)
		throw new T09TextLayoutError(
			"TEXT_LAYOUT_INVALID",
			"Text layout metrics must be finite positive integers.",
		);
	return Math.floor(numerator / denominator + 0.5);
}

/**
 * Canonical text normalization shared by technical font coverage and T09
 * layout. Line endings are structural text delimiters, not glyph content.
 */
export function normalizeT09Text(text: string): string {
	return text.replace(/\r\n?/g, "\n").normalize("NFC");
}

/**
 * Returns canonical hard lines. Empty leading, trailing, and intermediate
 * lines are preserved for deterministic layout, but LF delimiters are not
 * part of any glyph-bearing line.
 */
export function splitT09TextIntoHardLines(text: string): readonly string[] {
	return normalizeT09Text(text).split("\n");
}

function fits(
	units: number,
	fontSizePx: number,
	boxWidthPx: number,
	unitsPerEm: number,
): boolean {
	return units * fontSizePx <= boxWidthPx * unitsPerEm;
}

function measuredUnits(metrics: T09FontMetrics, text: string): number {
	const value = metrics.measureUnits(text);
	if (!Number.isSafeInteger(value) || value < 0)
		throw new T09TextLayoutError(
			"TEXT_LAYOUT_INVALID",
			"Text measurement must be a finite non-negative safe integer.",
		);
	return value;
}

function wrapLine(
	line: string,
	input: T09TextLayoutInput,
	metrics: T09FontMetrics,
): string[] {
	if (line.length === 0) return [""];
	if (!metrics.hasGlyphs(line))
		throw new T09TextLayoutError(
			"TEXT_LAYOUT_UNSUPPORTED_GLYPH",
			`Text contains a glyph not supported by ${metrics.fontStableId}.`,
		);
	const result: string[] = [];
	let remaining = line;
	while (remaining.length > 0) {
		if (
			fits(
				measuredUnits(metrics, remaining),
				input.fontSizePx,
				input.box.widthPx,
				metrics.unitsPerEm,
			)
		) {
			result.push(remaining);
			break;
		}
		let splitAt = -1;
		for (
			let index = remaining.lastIndexOf(" ");
			index > 0;
			index = remaining.lastIndexOf(" ", index - 1)
		) {
			const candidate = remaining.slice(0, index);
			if (
				fits(
					measuredUnits(metrics, candidate),
					input.fontSizePx,
					input.box.widthPx,
					metrics.unitsPerEm,
				)
			) {
				splitAt = index;
				break;
			}
		}
		if (splitAt < 0)
			throw new T09TextLayoutError(
				"TEXT_LAYOUT_OVERFLOW",
				"A greedy text token cannot fit inside the layout box.",
			);
		result.push(remaining.slice(0, splitAt));
		remaining = remaining.slice(splitAt + 1);
	}
	return result;
}

export function materializeT09TextLayout(
	input: T09TextLayoutInput,
	metrics: T09FontMetrics,
): T09TextLayoutResult {
	const parsed = t09TextLayoutInputSchema.safeParse(input);
	if (!parsed.success)
		throw new T09TextLayoutError(
			"TEXT_LAYOUT_INVALID",
			"Text layout input does not satisfy the T09 contract.",
		);
	if (
		metrics.fontStableId !== input.fontStableId ||
		metrics.fontFamily !== input.fontFamily ||
		metrics.fontWeight !== input.fontWeight ||
		metrics.fontContentSha256 !== input.fontContentSha256 ||
		!Number.isInteger(metrics.unitsPerEm) ||
		metrics.unitsPerEm <= 0 ||
		!Number.isInteger(metrics.ascent) ||
		metrics.ascent <= 0
	)
		throw new T09TextLayoutError(
			"TEXT_LAYOUT_INVALID",
			"Text layout metrics do not match the pinned font identity.",
		);
	const normalizedText = normalizeT09Text(input.text);
	const lines = splitT09TextIntoHardLines(normalizedText).flatMap((line) =>
		wrapLine(line, input, metrics),
	);
	if (lines.length > input.maxLines)
		throw new T09TextLayoutError(
			"TEXT_LAYOUT_OVERFLOW",
			"Text exceeds the configured maximum line count.",
		);
	if (lines.length * input.lineHeightPx > input.box.heightPx)
		throw new T09TextLayoutError(
			"TEXT_LAYOUT_OVERFLOW",
			"Text exceeds the configured layout box height.",
		);
	const ascentPx = roundHalfUp(
		metrics.ascent * input.fontSizePx,
		metrics.unitsPerEm,
	);
	const materialized = lines.map((line, lineIndex) => {
		const measuredWidthPx = roundHalfUp(
			measuredUnits(metrics, line) * input.fontSizePx,
			metrics.unitsPerEm,
		);
		if (measuredWidthPx > input.box.widthPx)
			throw new T09TextLayoutError(
				"TEXT_LAYOUT_OVERFLOW",
				"A materialized text line exceeds the layout box width.",
			);
		const xPx =
			input.textAlign === "LEFT"
				? input.box.xPx
				: input.textAlign === "RIGHT"
					? input.box.xPx + input.box.widthPx - measuredWidthPx
					: input.box.xPx +
						Math.floor((input.box.widthPx - measuredWidthPx) / 2);
		return {
			lineIndex,
			text: line,
			xPx,
			baselineYPx: input.box.yPx + ascentPx + lineIndex * input.lineHeightPx,
			measuredWidthPx,
			fontStableId: input.fontStableId,
			fontSizePx: input.fontSizePx,
			lineHeightPx: input.lineHeightPx,
		} satisfies T09MaterializedTextLine;
	});
	return {
		version: t09TextLayoutVersion,
		normalizedText,
		box: input.box,
		fontStableId: input.fontStableId,
		fontContentSha256: input.fontContentSha256,
		fontSizePx: input.fontSizePx,
		lineHeightPx: input.lineHeightPx,
		textAlign: input.textAlign,
		lines: materialized,
	};
}
