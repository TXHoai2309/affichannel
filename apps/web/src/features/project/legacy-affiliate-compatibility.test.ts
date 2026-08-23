import {
	classifyLegacyProject,
	INITIAL_CONTENT_FORMAT_REGISTRY,
	type LegacyProjectState,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const canonicalAffiliate: LegacyProjectState = {
	contentType: "AFFILIATE",
	creationPath: "SCRIPTED",
	contentFormatKey: "SCRIPTED_STANDARD",
	contentFormatVersion: 1,
	hasProduct: true,
};

function classify(overrides: Partial<LegacyProjectState>) {
	return classifyLegacyProject({ ...canonicalAffiliate, ...overrides });
}

describe("AFF-US-016 legacy Project classifier", () => {
	it("classifies all-null identity with Product as the legacy candidate", () => {
		expect(
			classify({
				contentType: null,
				creationPath: null,
				contentFormatKey: null,
				contentFormatVersion: null,
			}),
		).toEqual({
			kind: "candidate",
			reasonCode: "LEGACY_COMPATIBLE_CANDIDATE",
		});
	});

	it("gives all-null Productless identity the first exception reason", () => {
		expect(
			classify({
				contentType: null,
				creationPath: null,
				contentFormatKey: null,
				contentFormatVersion: null,
				hasProduct: false,
			}),
		).toEqual({
			kind: "exception",
			reasonCode: "LEGACY_PROJECT_WITHOUT_PRODUCT",
		});
	});

	it("prioritizes invalid ContentType over structural partial state", () => {
		expect(
			classify({
				contentType: "HYBRID",
				creationPath: null,
				contentFormatKey: null,
				contentFormatVersion: null,
			}),
		).toMatchObject({ reasonCode: "INVALID_CONTENT_TYPE" });
	});

	it("prioritizes invalid CreationPath over structural partial state", () => {
		expect(
			classify({
				creationPath: "ORGANIC_SCRIPTED",
				contentFormatKey: null,
				contentFormatVersion: null,
			}),
		).toMatchObject({ reasonCode: "INVALID_CREATION_PATH" });
	});

	it("classifies a structurally partial identity without guessing", () => {
		expect(classify({ contentFormatVersion: null })).toMatchObject({
			reasonCode: "PARTIAL_CHANNEL_FIRST_FIELDS",
		});
	});

	it("prioritizes an unresolved complete format over missing Affiliate Product", () => {
		expect(
			classify({
				contentFormatKey: "UNKNOWN_FORMAT",
				hasProduct: false,
			}),
		).toMatchObject({ reasonCode: "INVALID_CONTENT_FORMAT_REF" });
	});

	it("classifies complete Affiliate identity without Product", () => {
		expect(classify({ hasProduct: false })).toMatchObject({
			reasonCode: "AFFILIATE_PRODUCT_MISSING",
		});
	});

	it("classifies a known format and CreationPath mismatch", () => {
		expect(classify({ creationPath: "QUICK_IMAGE" })).toMatchObject({
			reasonCode: "CONTENT_FORMAT_CREATION_PATH_MISMATCH",
		});
	});

	it("does not treat valid future identities as conflicts or activation", () => {
		expect(
			classify({
				contentType: "ORGANIC",
				creationPath: "QUICK_IMAGE",
				contentFormatKey: "QUICK_IMAGE_STANDARD",
				contentFormatVersion: 1,
				hasProduct: false,
			}),
		).toEqual({ kind: "canonical" });
	});

	it("resolves the locked legacy format from the canonical registry", () => {
		expect(
			INITIAL_CONTENT_FORMAT_REGISTRY.some(
				(definition) =>
					definition.ref.key === "SCRIPTED_STANDARD" &&
					definition.ref.version === 1 &&
					definition.supportedCreationPaths.some(
						(creationPath) => creationPath === "SCRIPTED",
					),
			),
		).toBe(true);
	});
});
