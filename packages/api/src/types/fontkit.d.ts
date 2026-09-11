declare module "fontkit" {
	export type ParsedFont = {
		type: string;
		familyName: string | null;
		subfamilyName: string | null;
		version: string | null;
		italicAngle: number;
		characterSet: readonly number[];
		unitsPerEm: number;
		ascent: number;
		layout: (
			text: string,
			features?: Record<string, boolean>,
			script?: string,
			language?: string,
			direction?: string,
		) => {
			glyphs: readonly { advanceWidth: number }[];
			positions: readonly {
				xAdvance: number;
				yAdvance: number;
				xOffset: number;
				yOffset: number;
			}[];
		};
		"OS/2"?: { usWeightClass?: number };
	};

	export function create(buffer: Uint8Array): ParsedFont;
}
