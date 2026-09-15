import {
	type ContentFormatRegistry,
	channelFirstCompatibleCreateProjectInputSchema,
	channelFirstCompatibleUpdateProjectInputSchema,
	classifyProjectWriteIdentity,
	createProjectInputSchema,
	updateProjectInputSchema,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const legacyPayload = {
	name: "Legacy project",
	productId: "00000000-0000-4000-8000-000000000001",
	platform: "tiktok" as const,
	goal: "Legacy goal",
	durationSeconds: 30,
	angle: "Legacy angle",
	description: "Legacy description",
};

const canonicalAffiliateIdentity = {
	contentType: "AFFILIATE",
	creationPath: "SCRIPTED",
	contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
};

const deprecatedRegistry = [
	{
		ref: { key: "SCRIPTED_LEGACY", version: 1 },
		label: "Deprecated scripted format",
		supportedCreationPaths: ["SCRIPTED"],
		availability: "deprecated",
	},
] as const satisfies ContentFormatRegistry;

function classify(input: Record<string, unknown>) {
	const parsed = channelFirstCompatibleCreateProjectInputSchema.parse({
		...legacyPayload,
		...input,
	});
	return classifyProjectWriteIdentity(parsed);
}

describe("AFF-US-016 M3A Project write contract", () => {
	it("keeps the existing legacy create payload compatible", () => {
		const parsed = createProjectInputSchema.safeParse(legacyPayload);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(classifyProjectWriteIdentity({}).kind).toBe("legacy");
		}
	});

	it("keeps the existing legacy update payload compatible", () => {
		const parsed = updateProjectInputSchema.safeParse({
			...legacyPayload,
			id: "00000000-0000-4000-8000-000000000002",
		});
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(classifyProjectWriteIdentity({}).kind).toBe("legacy");
		}
	});

	it("keeps canonical identity fields visible to the parser", () => {
		const parsed = channelFirstCompatibleCreateProjectInputSchema.parse({
			...legacyPayload,
			...canonicalAffiliateIdentity,
		});
		expect(parsed.contentType).toBe("AFFILIATE");
		expect(parsed.creationPath).toBe("SCRIPTED");
		expect(parsed.contentFormat).toEqual({
			key: "SCRIPTED_STANDARD",
			version: 1,
		});
	});

	it("allows the rolled-out Affiliate Scripted identity", () => {
		expect(classify(canonicalAffiliateIdentity)).toEqual({
			kind: "canonical",
			identity: canonicalAffiliateIdentity,
			writableDuringM3: true,
		});
	});

	it.each([
		["contentType only", { contentType: "ORGANIC" }],
		["creationPath only", { creationPath: "SCRIPTED" }],
		[
			"contentType and creationPath without format",
			{ contentType: "AFFILIATE", creationPath: "SCRIPTED" },
		],
	])("rejects %s as partial identity", (_label, input) => {
		expect(classify(input)).toEqual({
			kind: "rejected",
			reasonCode: "PARTIAL_CHANNEL_FIRST_IDENTITY",
		});
	});

	it.each([[{ key: "SCRIPTED_STANDARD" }], [{ version: 1 }], [{}]])(
		"gives an incomplete ContentFormatRef its specific reason",
		(contentFormat) => {
			expect(classify({ contentFormat })).toEqual({
				kind: "rejected",
				reasonCode: "PARTIAL_CONTENT_FORMAT_REF",
			});
		},
	);

	it("does not treat supplied null identity as legacy omission", () => {
		expect(classify({ contentType: null })).toEqual({
			kind: "rejected",
			reasonCode: "PARTIAL_CHANNEL_FIRST_IDENTITY",
		});
	});

	it("gives a supplied null ContentFormatRef its specific reason", () => {
		expect(classify({ contentFormat: null })).toEqual({
			kind: "rejected",
			reasonCode: "PARTIAL_CONTENT_FORMAT_REF",
		});
	});

	it("rejects unknown formats, invalid versions, and path mismatches", () => {
		expect(
			classify({
				...canonicalAffiliateIdentity,
				contentFormat: { key: "UNKNOWN_FORMAT", version: 1 },
			}),
		).toEqual({ kind: "rejected", reasonCode: "UNKNOWN_CONTENT_FORMAT_REF" });
		expect(
			classify({
				...canonicalAffiliateIdentity,
				contentFormat: { key: "SCRIPTED_STANDARD", version: 0 },
			}),
		).toEqual({
			kind: "rejected",
			reasonCode: "INVALID_CONTENT_FORMAT_VERSION",
		});
		expect(
			classify({
				...canonicalAffiliateIdentity,
				creationPath: "QUICK_IMAGE",
			}),
		).toEqual({
			kind: "rejected",
			reasonCode: "CONTENT_FORMAT_PATH_MISMATCH",
		});
		expect(
			classify({
				...canonicalAffiliateIdentity,
				contentFormat: { key: "", version: 1 },
			}),
		).toEqual({ kind: "rejected", reasonCode: "INVALID_CONTENT_FORMAT_REF" });
		expect(classify({ contentType: "NOT_A_CONTENT_TYPE" })).toEqual({
			kind: "rejected",
			reasonCode: "INVALID_CONTENT_TYPE",
		});
	});

	it("distinguishes a known deprecated format from an unknown format", () => {
		const parsed = channelFirstCompatibleCreateProjectInputSchema.parse({
			...legacyPayload,
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormat: { key: "SCRIPTED_LEGACY", version: 1 },
		});
		expect(classifyProjectWriteIdentity(parsed, deprecatedRegistry)).toEqual({
			kind: "rejected",
			reasonCode: "DEPRECATED_CONTENT_FORMAT",
		});
	});

	it("allows the locked Affiliate Quick Image identity", () => {
		expect(
			classify({
				contentType: "AFFILIATE",
				creationPath: "QUICK_IMAGE",
				contentFormat: { key: "QUICK_IMAGE_STANDARD", version: 1 },
				quickImage: { durationSeconds: 5 },
			}),
		).toEqual({
			kind: "canonical",
			identity: {
				contentType: "AFFILIATE",
				creationPath: "QUICK_IMAGE",
				contentFormat: { key: "QUICK_IMAGE_STANDARD", version: 1 },
			},
			writableDuringM3: true,
		});
	});

	it.each([5, 10])(
		"rejects a Scripted request carrying Quick Image duration %s",
		(durationSeconds) => {
			expect(
				classify({
					...canonicalAffiliateIdentity,
					quickImage: { durationSeconds },
				}),
			).toEqual({
				kind: "rejected",
				reasonCode: "QUICK_IMAGE_FIELDS_REQUIRE_QUICK_IMAGE_IDENTITY",
			});
		},
	);

	it("requires the Quick Image payload for a Quick Image identity", () => {
		expect(
			classify({
				contentType: "AFFILIATE",
				creationPath: "QUICK_IMAGE",
				contentFormat: { key: "QUICK_IMAGE_STANDARD", version: 1 },
			}),
		).toEqual({ kind: "rejected", reasonCode: "QUICK_IMAGE_PAYLOAD_REQUIRED" });
	});

	it("rejects a malformed Quick Image payload", () => {
		const parsed = channelFirstCompatibleCreateProjectInputSchema.safeParse({
			...legacyPayload,
			contentType: "AFFILIATE",
			creationPath: "QUICK_IMAGE",
			contentFormat: { key: "QUICK_IMAGE_STANDARD", version: 1 },
			quickImage: { durationSeconds: 7 },
		});

		expect(parsed.success).toBe(false);
	});

	it("keeps unrelated legacy unknown fields strip-compatible", () => {
		const parsed = channelFirstCompatibleCreateProjectInputSchema.safeParse({
			...legacyPayload,
			...canonicalAffiliateIdentity,
			unrelatedLegacyField: "ignored",
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect("unrelatedLegacyField" in parsed.data).toBe(false);
		}
	});

	it.each([
		["AFFILIATE", "QUICK_IMAGE", "SCRIPTED_STANDARD"],
		["AFFILIATE", "MEDIA_FIRST", "MEDIA_FIRST_STANDARD"],
		["AFFILIATE", "SCRIPTED", "QUICK_IMAGE_STANDARD"],
	])(
		"rejects inactive or mismatched %s/%s identity",
		(contentType, creationPath, key) => {
			expect(
				classify({
					contentType,
					creationPath,
					contentFormat: { key, version: 1 },
				}),
			).toEqual({
				kind: "rejected",
				reasonCode:
					creationPath === "MEDIA_FIRST"
						? "CHANNEL_FIRST_IDENTITY_NOT_ACTIVE"
						: "CONTENT_FORMAT_PATH_MISMATCH",
			});
		},
	);

	it("rejects an unsupported Quick Image format version", () => {
		expect(
			classify({
				contentType: "AFFILIATE",
				creationPath: "QUICK_IMAGE",
				contentFormat: { key: "QUICK_IMAGE_STANDARD", version: 2 },
			}),
		).toEqual({ kind: "rejected", reasonCode: "UNKNOWN_CONTENT_FORMAT_REF" });
	});

	it("rejects an unknown creation path", () => {
		expect(
			classify({
				contentType: "AFFILIATE",
				creationPath: "UNKNOWN_PATH",
				contentFormat: { key: "QUICK_IMAGE_STANDARD", version: 1 },
			}),
		).toEqual({ kind: "rejected", reasonCode: "INVALID_CREATION_PATH" });
	});

	it("allows Organic Scripted creation without a Product", () => {
		const parsed = channelFirstCompatibleCreateProjectInputSchema.safeParse({
			...canonicalAffiliateIdentity,
			...legacyPayload,
			contentType: "ORGANIC",
			productId: null,
		});
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(classifyProjectWriteIdentity(parsed.data)).toMatchObject({
				kind: "canonical",
				identity: { contentType: "ORGANIC", creationPath: "SCRIPTED" },
			});
		}
	});

	it("keeps Affiliate Product validation explicit", () => {
		expect(
			channelFirstCompatibleCreateProjectInputSchema.safeParse({
				...canonicalAffiliateIdentity,
				...legacyPayload,
				productId: null,
			}).success,
		).toBe(true);
		expect(
			channelFirstCompatibleUpdateProjectInputSchema.safeParse({
				...canonicalAffiliateIdentity,
				...legacyPayload,
				productId: null,
				id: "00000000-0000-4000-8000-000000000002",
			}).success,
		).toBe(true);
	});

	it("does not accept read-model-only ContentFormat fields as write input", () => {
		const parsed = channelFirstCompatibleCreateProjectInputSchema.safeParse({
			...legacyPayload,
			...canonicalAffiliateIdentity,
			contentFormat: {
				key: "SCRIPTED_STANDARD",
				version: 1,
				resolution: "resolved",
			},
		});
		expect(parsed.success).toBe(false);
	});

	it("exposes the compatible identity through active production schemas in M3B", () => {
		const createResult = createProjectInputSchema.safeParse({
			...legacyPayload,
			...canonicalAffiliateIdentity,
		});
		const updateResult = updateProjectInputSchema.safeParse({
			...legacyPayload,
			...canonicalAffiliateIdentity,
			id: "00000000-0000-4000-8000-000000000002",
		});

		expect(createResult.success).toBe(true);
		expect(updateResult.success).toBe(true);
		if (createResult.success && updateResult.success) {
			expect(classifyProjectWriteIdentity(createResult.data).kind).toBe(
				"canonical",
			);
			expect(classifyProjectWriteIdentity(updateResult.data).kind).toBe(
				"canonical",
			);
		}
	});
});
