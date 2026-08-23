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

	it.each([
		["ORGANIC", "SCRIPTED", "SCRIPTED_STANDARD"],
		["AFFILIATE", "QUICK_IMAGE", "QUICK_IMAGE_STANDARD"],
		["AFFILIATE", "MEDIA_FIRST", "MEDIA_FIRST_STANDARD"],
	])("keeps %s/%s inactive during M3", (contentType, creationPath, key) => {
		expect(
			classify({
				contentType,
				creationPath,
				contentFormat: { key, version: 1 },
			}),
		).toEqual({
			kind: "rejected",
			reasonCode: "CHANNEL_FIRST_IDENTITY_NOT_ACTIVE",
		});
	});

	it("keeps Product required on both legacy and canonical schemas", () => {
		expect(
			channelFirstCompatibleCreateProjectInputSchema.safeParse({
				...canonicalAffiliateIdentity,
				...legacyPayload,
				productId: undefined,
			}).success,
		).toBe(false);
		expect(
			channelFirstCompatibleUpdateProjectInputSchema.safeParse({
				...canonicalAffiliateIdentity,
				...legacyPayload,
				productId: undefined,
				id: "00000000-0000-4000-8000-000000000002",
			}).success,
		).toBe(false);
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

	it("keeps explicit Channel-First identity outside active production schemas", () => {
		const createResult = createProjectInputSchema.safeParse({
			...legacyPayload,
			...canonicalAffiliateIdentity,
		});
		const updateResult = updateProjectInputSchema.safeParse({
			...legacyPayload,
			...canonicalAffiliateIdentity,
			id: "00000000-0000-4000-8000-000000000002",
		});

		expect(createResult.success).toBe(false);
		expect(updateResult.success).toBe(false);
		if (!createResult.success && !updateResult.success) {
			expect(
				createResult.error.issues.some(
					(issue) => issue.message === "CHANNEL_FIRST_IDENTITY_NOT_ACTIVE",
				),
			).toBe(true);
			expect(
				updateResult.error.issues.some(
					(issue) => issue.message === "CHANNEL_FIRST_IDENTITY_NOT_ACTIVE",
				),
			).toBe(true);
		}
	});
});
