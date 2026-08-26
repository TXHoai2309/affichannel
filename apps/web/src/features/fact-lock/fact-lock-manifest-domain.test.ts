import {
	buildManifestFactLockVerificationInput,
	buildManifestZeroClaimOutcome,
	claimManifestFingerprint,
	computeManifestRequestHash,
	computeProductFactsFingerprint,
	computeZeroClaimManifestRequestHash,
	evaluateManifestExecutionEligibility,
	FACT_LOCK_MANIFEST_INPUT_MODE,
	FACT_LOCK_MANIFEST_INPUT_VERSION,
	factLockInputModeSchema,
	getManifestFactLockResolutionPolicy,
	type ManifestFactLockManifest,
	type ManifestFactLockVerificationInput,
	type ManifestProductFactsSnapshot,
	manifestRequestHashProjection,
	productFactsFingerprintProjection,
	validateManifestFactLockProviderResult,
	zeroClaimManifestRequestHashProjection,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const claimKeyA = `claim_${"a".repeat(64)}`;
const claimKeyB = `claim_${"b".repeat(64)}`;

function fact(
	id: string,
	revision: number,
	content: string,
	metadata: Record<string, unknown> = {},
) {
	return {
		id,
		revision,
		content,
		type: "specification" as const,
		status: "verified" as const,
		assessment: {
			verification: "verified" as const,
			evidence: "complete" as const,
			freshness: "not_applicable" as const,
			freshnessReason: "not_applicable" as const,
		},
		generationUsability: "allowed" as const,
		source: {
			type: "official",
			label: "Website hãng",
			url: "https://example.com/facts",
			confirmedAt: "2026-08-20",
			expiresAt: null,
		},
		...metadata,
	};
}

function facts(): ManifestProductFactsSnapshot {
	return [
		fact("fact-b", 4, "Pin dùng liên tục 20 giờ."),
		fact("fact-a", 2, "Sạc nhanh trong 30 phút."),
	] as ManifestProductFactsSnapshot;
}

function manifest(
	overrides: Partial<ManifestFactLockManifest> = {},
): ManifestFactLockManifest {
	const claims = [
		{
			claimKey: claimKeyA,
			claimText: "Pin dùng liên tục 20 giờ.",
			locator: {
				sourceType: "SCRIPT_VERSION" as const,
				occurrence: { section: "caption" as const },
			},
			sourceTextHash: "c".repeat(64),
		},
		{
			claimKey: claimKeyB,
			claimText: "Sạc nhanh trong 30 phút.",
			locator: {
				sourceType: "SCRIPT_VERSION" as const,
				occurrence: { section: "cta" as const },
			},
			sourceTextHash: "d".repeat(64),
		},
	];
	return {
		id: "manifest-18a",
		workspaceId: "workspace-18a",
		projectId: "project-18a",
		source: {
			sourceType: "SCRIPT_VERSION",
			scriptVersionId: "script-18a",
			scriptVersionRevision: 7,
			claimsSourceRevision: 3,
			sourceContentHash: "e".repeat(64),
		},
		productId: "product-18a",
		schemaVersion: "claim-manifest.v1",
		builderVersion: "claim-manifest-builder.v1",
		claims,
		claimCount: claims.length,
		isEmpty: false,
		fingerprint: "f".repeat(64),
		...overrides,
	};
}

async function executableManifest(
	overrides: Partial<ManifestFactLockManifest> = {},
): Promise<ManifestFactLockManifest> {
	const base = manifest(overrides);
	return {
		...base,
		fingerprint: await claimManifestFingerprint(base),
	};
}

function executableProject(overrides: Record<string, unknown> = {}) {
	return {
		id: "project-18a",
		workspaceId: "workspace-18a",
		contentType: "AFFILIATE" as const,
		creationPath: "SCRIPTED" as const,
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
		productId: "product-18a",
		currentScriptVersionId: "script-18a",
		...overrides,
	};
}

function eligibilityInput(
	manifestInput = manifest(),
	projectOverrides: Record<string, unknown> = {},
	currentScriptVersionOverrides: Record<string, unknown> = {},
) {
	return {
		manifest: manifestInput,
		project: executableProject(projectOverrides),
		currentScriptVersion: {
			id: "script-18a",
			revision: 7,
			status: "draft" as const,
			...currentScriptVersionOverrides,
		},
	};
}

function verificationInput(
	manifestInput = manifest(),
	factInput = facts(),
): ManifestFactLockVerificationInput {
	return buildManifestFactLockVerificationInput({
		manifest: manifestInput,
		productFacts: factInput,
	});
}

function providerClaim(
	claimKey: string,
	factId: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		claimKey,
		classificationStatus: "SUPPORTED" as const,
		reason: "Khớp Product Fact.",
		confidence: 0.98,
		suggestionText: null,
		factMappings: [{ factId, relation: "supports" as const }],
		...overrides,
	};
}

function providerOutput(
	claims: readonly Record<string, unknown>[],
	extra: Record<string, unknown> = {},
) {
	return {
		schemaVersion: "fact-lock-output.v1",
		claims,
		...extra,
	};
}

describe("AFF-US-018 Phase 18A pure Manifest Fact Lock", () => {
	it("represents legacy null and explicit MANIFEST_V1 without inference", () => {
		expect(factLockInputModeSchema.safeParse(null).success).toBe(true);
		expect(
			factLockInputModeSchema.safeParse(FACT_LOCK_MANIFEST_INPUT_MODE).success,
		).toBe(true);
		expect(factLockInputModeSchema.safeParse("OTHER").success).toBe(false);
	});

	it("uses the server-owned input version and rejects caller override", () => {
		expect(FACT_LOCK_MANIFEST_INPUT_VERSION).toBe("fact-lock.manifest.v1");
		const input = verificationInput();
		expect(input.inputVersion).toBe(FACT_LOCK_MANIFEST_INPUT_VERSION);
		expect(() =>
			buildManifestFactLockVerificationInput({
				manifest: manifest(),
				productFacts: facts(),
				inputVersion: "fact-lock.manifest.v999",
			} as never),
		).toThrow();
	});

	it("sorts Product Facts by id and projects only verification fields", async () => {
		const original = facts();
		const reordered = [...original].reverse();
		expect(
			productFactsFingerprintProjection(reordered).map((item) => item.id),
		).toEqual(["fact-a", "fact-b"]);
		expect(await computeProductFactsFingerprint(original)).toBe(
			"f83601772dcf2bb06745f86a3b4700221a76b54cbded872ec13148bbb30da5ee",
		);
		expect(await computeProductFactsFingerprint(reordered)).toBe(
			"f83601772dcf2bb06745f86a3b4700221a76b54cbded872ec13148bbb30da5ee",
		);
		const withIncidentalChange = original.map((item) => ({
			...item,
			createdAt: "2099-01-01T00:00:00.000Z",
			notes: "ignored database metadata",
		}));
		expect(await computeProductFactsFingerprint(withIncidentalChange)).toBe(
			"f83601772dcf2bb06745f86a3b4700221a76b54cbded872ec13148bbb30da5ee",
		);
	});

	it("changes Product Facts fingerprint for revision or semantic content changes", async () => {
		const base = await computeProductFactsFingerprint(facts());
		const changedRevision = await computeProductFactsFingerprint([
			fact("fact-a", 3, "Sạc nhanh trong 30 phút."),
			fact("fact-b", 4, "Pin dùng liên tục 20 giờ."),
		]);
		const changedContent = await computeProductFactsFingerprint([
			fact("fact-a", 2, "Sạc nhanh trong 25 phút."),
			fact("fact-b", 4, "Pin dùng liên tục 20 giờ."),
		]);
		expect(changedRevision).not.toBe(base);
		expect(changedContent).not.toBe(base);
	});

	it("uses distinct non-empty and zero-claim request projections", async () => {
		const productFactsFingerprint = await computeProductFactsFingerprint(
			facts(),
		);
		const nonEmptyInput = {
			claimManifestFingerprint: "f".repeat(64),
			productFactsFingerprint,
		};
		const zeroInput = { claimManifestFingerprint: "f".repeat(64) };
		expect(manifestRequestHashProjection(nonEmptyInput)).toEqual({
			inputVersion: FACT_LOCK_MANIFEST_INPUT_VERSION,
			...nonEmptyInput,
		});
		expect(zeroClaimManifestRequestHashProjection(zeroInput)).toEqual({
			inputVersion: FACT_LOCK_MANIFEST_INPUT_VERSION,
			claimManifestFingerprint: "f".repeat(64),
			zeroClaims: true,
		});
		expect(await computeManifestRequestHash(nonEmptyInput)).toBe(
			"d941a5a43065bfab643cf3da35c7d23404b28f1a3112f27c256b6bb703c050d9",
		);
		expect(await computeZeroClaimManifestRequestHash(zeroInput)).toBe(
			"0edde530b6a68fb02c2cf7afebc5c84ded8c3f5407c59df69d8d502dff02ebc6",
		);
		expect(await computeManifestRequestHash(nonEmptyInput)).not.toBe(
			await computeZeroClaimManifestRequestHash(zeroInput),
		);
		expect(() =>
			manifestRequestHashProjection({
				...nonEmptyInput,
				claimManifestFingerprint: "F".repeat(64),
			}),
		).toThrow();
	});

	it("normalizes exact provider result sets to Manifest order", () => {
		const input = verificationInput();
		const result = validateManifestFactLockProviderResult(
			providerOutput([
				providerClaim(claimKeyB, "fact-b"),
				providerClaim(claimKeyA, "fact-a", {
					claimText: "provider text is not authoritative",
					occurrence: { section: "caption" },
				}),
			]),
			input,
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.claims.map((claim) => claim.claimKey)).toEqual([
				claimKeyA,
				claimKeyB,
			]);
			expect(result.claims[0]).toMatchObject({
				claimText: "Pin dùng liên tục 20 giờ.",
				locator: {
					sourceType: "SCRIPT_VERSION",
					occurrence: { section: "caption" },
				},
			});
			expect(result.claims[0]?.factMappings[0]).toMatchObject({
				factId: "fact-a",
				factRevision: 2,
			});
		}
	});

	it("rejects every exact-set and Fact mapping violation with the typed error", () => {
		const input = verificationInput();
		const validA = providerClaim(claimKeyA, "fact-a");
		const validB = providerClaim(claimKeyB, "fact-b");
		const cases = [
			["missing claim", providerOutput([validA]), "MISSING_CLAIM"],
			[
				"extra claim",
				providerOutput([
					validA,
					validB,
					providerClaim(`claim_${"c".repeat(64)}`, "fact-a"),
				]),
				"EXTRA_CLAIM",
			],
			[
				"unknown claim key",
				providerOutput([
					validA,
					providerClaim(`claim_${"c".repeat(64)}`, "fact-a"),
				]),
				"UNKNOWN_CLAIM_KEY",
			],
			[
				"duplicate claim key",
				providerOutput([validA, providerClaim(claimKeyA, "fact-b")]),
				"DUPLICATE_CLAIM_KEY",
			],
			[
				"invalid fact id",
				providerOutput([validA, providerClaim(claimKeyB, "missing-fact")]),
				"INVALID_FACT_REFERENCE",
			],
			[
				"duplicate fact mapping",
				providerOutput([
					{
						...validA,
						factMappings: [
							{ factId: "fact-a", relation: "supports" },
							{ factId: "fact-a", relation: "supports" },
						],
					},
					validB,
				]),
				"DUPLICATE_FACT_MAPPING",
			],
			[
				"malformed verdict",
				providerOutput([
					validA,
					{ ...validB, classificationStatus: "UNKNOWN" },
				]),
				"MALFORMED_RESULT",
			],
			[
				"missing claim key",
				providerOutput([validA, { ...validB, claimKey: undefined }]),
				"MALFORMED_RESULT",
			],
		] as const;
		for (const [, raw, expectedIssue] of cases) {
			const result = validateManifestFactLockProviderResult(raw, input);
			expect(result).toMatchObject({
				success: false,
				code: "FACT_LOCK_PROVIDER_RESULT_MISMATCH",
			});
			if (!result.success) expect(result.issueCodes).toContain(expectedIssue);
		}
	});

	it("supports the pure executable eligibility boundary and resolution policy", async () => {
		const validInput = await executableManifest();
		expect(
			await evaluateManifestExecutionEligibility(eligibilityInput(validInput)),
		).toEqual({
			eligible: true,
			reason: "ELIGIBLE",
		});
		expect(
			await evaluateManifestExecutionEligibility(
				eligibilityInput(validInput, { contentType: "ORGANIC" }),
			),
		).toMatchObject({ eligible: false, reason: "CONTENT_TYPE_MISMATCH" });
		expect(
			await evaluateManifestExecutionEligibility(
				eligibilityInput(validInput, {}, { status: "saved" }),
			),
		).toMatchObject({
			eligible: false,
			reason: "SCRIPT_VERSION_NOT_ACTIVE_DRAFT",
		});
		expect(
			await evaluateManifestExecutionEligibility(
				eligibilityInput({ ...validInput, fingerprint: "0".repeat(64) }),
			),
		).toMatchObject({
			eligible: false,
			code: "CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
		});
		expect(getManifestFactLockResolutionPolicy()).toEqual({
			sourceMutationAllowed: false,
			allowedActions: ["status_only_manual_approval"],
		});
	});

	it("produces the passed/no-provider/no-dependency zero-claim outcome", async () => {
		const zeroManifest = await executableManifest({
			claims: [],
			claimCount: 0,
			isEmpty: true,
		});
		const eligibility = await evaluateManifestExecutionEligibility(
			eligibilityInput(zeroManifest),
		);
		const outcome = buildManifestZeroClaimOutcome({
			manifest: zeroManifest,
			eligibility,
		});
		expect(outcome).toEqual({
			status: "passed",
			providerRequired: false,
			claimResults: [],
			dependenciesRequired: false,
		});
		expect(() =>
			buildManifestZeroClaimOutcome({
				manifest: {
					...zeroManifest,
					claims: [manifest().claims[0]],
					claimCount: 1,
					isEmpty: false,
				},
				eligibility,
			}),
		).toThrow();
	});
});
