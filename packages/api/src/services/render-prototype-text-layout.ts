/// <reference path="../types/fontkit.d.ts" />

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	materializeT09TextLayout,
	type T09FontMetrics,
	type T09TextLayoutInput,
	type T09TextLayoutResult,
} from "@affichannel/core";
import * as fontkit from "fontkit";
import { readFontAssetManifest } from "./composition-technical-loader";

/**
 * The complete deterministic Latin/ASCII policy for
 * affichannel-text-layout-v1 on fontkit 2.0.4.
 *
 * Fontkit's DefaultShaper adds rvrn, ltra/ltrm, frac/numr/dnom, ccmp, locl,
 * rlig, mark, mkmk, calt, clig, liga, rclt, curs, and kern unless explicitly
 * overridden. The T09 fixture needs canonical composition, kerning, and no
 * optional alternates or ligatures. Tags which are not present in Noto Sans
 * are still listed so the policy remains explicit if the pinned font changes.
 */
const T09_OPEN_TYPE_FEATURES = Object.freeze({
	rvrn: false,
	ltra: false,
	ltrm: false,
	frac: false,
	numr: false,
	dnom: false,
	ccmp: true,
	locl: false,
	rlig: false,
	mark: false,
	mkmk: false,
	calt: false,
	clig: false,
	liga: false,
	rclt: false,
	curs: false,
	kern: true,
	vert: false,
	rtla: false,
	rtlm: false,
	dist: false,
	dlig: false,
	hlig: false,
});

async function loadPinnedFont(input: T09TextLayoutInput) {
	const manifest = await readFontAssetManifest();
	const face = manifest.faces.find(
		(candidate) =>
			candidate.fontStableId === input.fontStableId &&
			candidate.weight === input.fontWeight &&
			candidate.family === input.fontFamily,
	);
	if (face?.style !== "normal")
		throw new Error("T09 text layout requested an unpinned font face.");
	if (face.sha256 !== input.fontContentSha256)
		throw new Error(
			"T09 text layout font checksum does not match the manifest.",
		);
	const bytes = await readFile(
		new URL(
			`../render-assets/fonts/affichannel-fonts-v1/${face.fileName}`,
			import.meta.url,
		),
	);
	const actualSha256 = createHash("sha256").update(bytes).digest("hex");
	if (actualSha256 !== face.sha256)
		throw new Error("T09 text layout font bytes do not match the manifest.");
	const font = fontkit.create(bytes);
	return { face, font };
}

export async function inspectT09ShapedRun(input: T09TextLayoutInput) {
	const { font } = await loadPinnedFont(input);
	const run = font.layout(input.text, { ...T09_OPEN_TYPE_FEATURES });
	return {
		shapedUnits: run.positions.reduce(
			(sum, position) => sum + position.xAdvance,
			0,
		),
		nominalUnits: run.glyphs.reduce(
			(sum, glyph) => sum + glyph.advanceWidth,
			0,
		),
	};
}

export async function layoutT09Text(
	input: T09TextLayoutInput,
): Promise<T09TextLayoutResult> {
	const { face, font } = await loadPinnedFont(input);
	const metrics: T09FontMetrics = {
		fontStableId: face.fontStableId,
		fontFamily: face.family,
		fontWeight: face.weight,
		fontContentSha256: face.sha256,
		unitsPerEm: font.unitsPerEm,
		ascent: font.ascent,
		hasGlyphs: (text) =>
			Array.from(text).every((character) =>
				font.characterSet.includes(character.codePointAt(0) ?? -1),
			),
		measureUnits: (text) => {
			const run = font.layout(text, { ...T09_OPEN_TYPE_FEATURES });
			if (run.positions.length !== run.glyphs.length)
				throw new Error("T09 fontkit returned an unaligned shaped run.");
			const shapedAdvance = run.positions.reduce((sum, position) => {
				if (
					!Number.isFinite(position.xAdvance) ||
					!Number.isSafeInteger(position.xAdvance)
				)
					throw new Error(
						"T09 fontkit returned a non-safe shaped xAdvance value.",
					);
				return sum + position.xAdvance;
			}, 0);
			if (!Number.isSafeInteger(shapedAdvance))
				throw new Error("T09 shaped advance exceeds safe integer range.");
			return shapedAdvance;
		},
	};
	return materializeT09TextLayout(input, metrics);
}

export { T09_OPEN_TYPE_FEATURES };
