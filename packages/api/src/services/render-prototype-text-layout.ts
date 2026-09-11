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

const T09_OPEN_TYPE_FEATURES = Object.freeze({
	ccmp: true,
	kern: true,
	liga: false,
	clig: false,
	calt: false,
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
		measureUnits: (text) =>
			font
				.layout(text, { ...T09_OPEN_TYPE_FEATURES })
				.glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0),
	};
	return materializeT09TextLayout(input, metrics);
}

export { T09_OPEN_TYPE_FEATURES };
