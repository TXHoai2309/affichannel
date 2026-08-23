import {
	CONTENT_FORMAT_DEFAULTS,
	CONTENT_FORMAT_RESOLUTIONS,
	CONTENT_TYPES,
	type ContentFormatDefinition,
	CREATION_PATHS,
	INITIAL_CONTENT_FORMAT_REGISTRY,
	resolveContentFormatRef,
	validateContentFormatAssignment,
	validateContentFormatRegistry,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const deprecatedRegistry = [
	...INITIAL_CONTENT_FORMAT_REGISTRY,
	{
		ref: { key: "SCRIPTED_STANDARD", version: 2 },
		label: "Scripted Standard v2",
		supportedCreationPaths: ["SCRIPTED"] as const,
		availability: "deprecated" as const,
	},
] satisfies readonly ContentFormatDefinition[];

describe("AFF-US-013 M1 ContentFormat contract", () => {
	it("defines independent ContentType and CreationPath contracts without HYBRID variants", () => {
		expect(CONTENT_TYPES).toEqual(["ORGANIC", "AFFILIATE"]);
		expect(CREATION_PATHS).toEqual(["QUICK_IMAGE", "SCRIPTED", "MEDIA_FIRST"]);
	});

	it("allows multiple versions for one format family but rejects duplicate pairs", () => {
		const twoVersions = [
			...INITIAL_CONTENT_FORMAT_REGISTRY,
			{
				ref: { key: "FORMAT", version: 1 },
				label: "Format v1",
				supportedCreationPaths: ["SCRIPTED"] as const,
				availability: "active" as const,
			},
			{
				ref: { key: "FORMAT", version: 2 },
				label: "Format v2",
				supportedCreationPaths: ["SCRIPTED"] as const,
				availability: "active" as const,
			},
		] satisfies readonly ContentFormatDefinition[];
		const defaults = { ...CONTENT_FORMAT_DEFAULTS };

		expect(validateContentFormatRegistry(twoVersions, defaults)).toEqual({
			success: true,
		});
		expect(
			validateContentFormatRegistry([...twoVersions, twoVersions[0]], defaults),
		).toMatchObject({
			success: false,
			issues: ["DUPLICATE_CONTENT_FORMAT_REF"],
		});
	});

	it("requires positive versions and one active compatible default per path", () => {
		const invalid = INITIAL_CONTENT_FORMAT_REGISTRY.map((definition, index) =>
			index === 0
				? {
						...definition,
						ref: { ...definition.ref, version: 0 },
					}
				: definition,
		);
		const result = validateContentFormatRegistry(
			invalid,
			CONTENT_FORMAT_DEFAULTS,
		);
		expect(result).toMatchObject({
			success: false,
			issues: expect.arrayContaining(["INVALID_CONTENT_FORMAT_VERSION"]),
		});
		expect(CREATION_PATHS).toHaveLength(3);
		for (const path of CREATION_PATHS) {
			expect(CONTENT_FORMAT_DEFAULTS[path]).toBeDefined();
			const definition = INITIAL_CONTENT_FORMAT_REGISTRY.find(
				(candidate) =>
					candidate.ref.key === CONTENT_FORMAT_DEFAULTS[path].key &&
					candidate.ref.version === CONTENT_FORMAT_DEFAULTS[path].version,
			);
			expect(definition?.availability).toBe("active");
			expect(definition?.supportedCreationPaths).toContain(path);
		}
	});

	it("keeps the registry free of applicability policy and exposes the scripted default", () => {
		expect(Object.isFrozen(INITIAL_CONTENT_FORMAT_REGISTRY)).toBe(true);
		expect(
			INITIAL_CONTENT_FORMAT_REGISTRY.some((definition) =>
				Object.keys(definition).some((key) =>
					[
						"productRequired",
						"scriptRequired",
						"factLockRequired",
						"voiceRequired",
						"renderRequired",
					].includes(key),
				),
			),
		).toBe(false);
		expect(CONTENT_FORMAT_DEFAULTS.SCRIPTED).toEqual({
			key: "SCRIPTED_STANDARD",
			version: 1,
		});
	});

	it("resolves active, deprecated, unknown, partial and invalid refs without fallback", () => {
		expect(CONTENT_FORMAT_RESOLUTIONS).toEqual([
			"resolved",
			"deprecated",
			"unsupported",
		]);
		expect(resolveContentFormatRef("SCRIPTED_STANDARD", 1)).toMatchObject({
			resolution: "resolved",
		});
		expect(
			resolveContentFormatRef("SCRIPTED_STANDARD", 2, deprecatedRegistry),
		).toMatchObject({
			resolution: "deprecated",
		});
		expect(resolveContentFormatRef("UNKNOWN", 1)).toMatchObject({
			resolution: "unsupported",
			reasonCode: "UNKNOWN_CONTENT_FORMAT_REF",
		});
		expect(resolveContentFormatRef("SCRIPTED_STANDARD", null)).toMatchObject({
			resolution: "unsupported",
			reasonCode: "PARTIAL_CONTENT_FORMAT_REF",
		});
		expect(resolveContentFormatRef(null, 1)).toMatchObject({
			resolution: "unsupported",
			reasonCode: "PARTIAL_CONTENT_FORMAT_REF",
		});
		expect(resolveContentFormatRef("SCRIPTED_STANDARD", 0)).toMatchObject({
			resolution: "unsupported",
			reasonCode: "INVALID_CONTENT_FORMAT_VERSION",
		});
		expect(resolveContentFormatRef(null, null)).toBeNull();
	});

	it("rejects deprecated assignments while allowing deprecated historical reads", () => {
		expect(
			validateContentFormatAssignment(
				{ key: "SCRIPTED_STANDARD", version: 2 },
				"SCRIPTED",
				deprecatedRegistry,
			),
		).toEqual({ success: false, reason: "DEPRECATED_CONTENT_FORMAT" });
		expect(
			validateContentFormatAssignment(
				{ key: "SCRIPTED_STANDARD", version: 1 },
				"SCRIPTED",
			),
		).toMatchObject({ success: true });
	});
});
