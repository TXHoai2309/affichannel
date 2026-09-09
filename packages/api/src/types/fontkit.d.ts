declare module "fontkit" {
	export type ParsedFont = {
		type: string;
		familyName: string | null;
		subfamilyName: string | null;
		version: string | null;
		italicAngle: number;
		characterSet: readonly number[];
		"OS/2"?: { usWeightClass?: number };
	};

	export function create(buffer: Uint8Array): ParsedFont;
}
