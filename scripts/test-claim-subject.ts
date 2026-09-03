import assert from "node:assert/strict";

import {
	buildSubjectAwareManifestClaimProjection,
	CLAIM_MANIFEST_BUILDER_VERSION,
	CLAIM_MANIFEST_SCHEMA_VERSION,
	CLAIM_SUBJECT_CURRENT_FACT_LOCK_MANIFEST_INPUT_VERSION,
	CLAIM_SUBJECT_CURRENT_MANIFEST_BUILDER_VERSION,
	CLAIM_SUBJECT_CURRENT_MANIFEST_SCHEMA_VERSION,
	CLAIM_SUBJECT_CURRENT_REFRESH_INPUT_VERSION,
	CLAIM_SUBJECT_CURRENT_REFRESH_OUTPUT_SCHEMA_VERSION,
	CLAIM_SUBJECT_CURRENT_REFRESH_PROMPT_VERSION,
	CLAIM_SUBJECT_CURRENT_SCRIPT_INPUT_VERSION,
	CLAIM_SUBJECT_CURRENT_SCRIPT_OUTPUT_SCHEMA_VERSION,
	CLAIM_SUBJECT_CURRENT_SCRIPT_PROMPT_VERSION,
	CLAIM_SUBJECT_NEXT_FACT_LOCK_MANIFEST_INPUT_VERSION,
	CLAIM_SUBJECT_NEXT_MANIFEST_BUILDER_VERSION,
	CLAIM_SUBJECT_NEXT_REFRESH_OUTPUT_SCHEMA_VERSION,
	CLAIM_SUBJECT_NEXT_REFRESH_PROMPT_VERSION,
	CLAIM_SUBJECT_NEXT_SCRIPT_INPUT_VERSION,
	CLAIM_SUBJECT_NEXT_SCRIPT_OUTPUT_SCHEMA_VERSION,
	CLAIM_SUBJECT_NEXT_SCRIPT_PROMPT_VERSION,
	ClaimSubjectError,
	confirmClaimSubject,
	confirmStructuredClaimSubject,
	createNeedsConfirmationClaim,
	LEGACY_AFFILIATE_CLAIM_SUBJECT,
	organicCanonicalClaimSchema,
	parseScriptClaimByOutputVersion,
	parseSubjectAwareScriptClaim,
	resolveProductClaimBinding,
	type SubjectAwareScriptClaim,
	subjectAwareManifestClaimProjectionJson,
	subjectAwareScriptClaimJson,
	summarizeClaimInventory,
} from "@affichannel/core";

const voiceoverOccurrence = {
	section: "voiceover" as const,
	segmentKey: "segment-1",
};

const generalClaim: SubjectAwareScriptClaim = {
	text: "Ba cách giúp bạn tập trung khi học.",
	occurrence: voiceoverOccurrence,
	subject: { kind: "GENERAL" },
	subjectStatus: "CONFIRMED",
	subjectSource: "USER",
};

const productClaim: SubjectAwareScriptClaim = {
	text: "Sản phẩm có thiết kế nhỏ gọn.",
	occurrence: voiceoverOccurrence,
	subject: { kind: "PRODUCT", binding: "PROJECT_PRODUCT" },
	subjectStatus: "CONFIRMED",
	subjectSource: "USER",
};

const legacyClaim = {
	text: "Sản phẩm có thiết kế nhỏ gọn.",
	occurrence: voiceoverOccurrence,
};

const manifestClaimKey =
	"claim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const manifestSourceTextHash =
	"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function summary(
	claims: unknown,
	contentType = "ORGANIC",
	claimsStatus = "current",
) {
	return summarizeClaimInventory({
		contentType,
		creationPath: "SCRIPTED",
		claimsStatus,
		claims,
	});
}

function expectSubjectError(
	callback: () => unknown,
	code: ConstructorParameters<typeof ClaimSubjectError>[0],
) {
	assert.throws(callback, (error: unknown) => {
		return error instanceof ClaimSubjectError && error.code === code;
	});
}

const tests: readonly [string, () => void][] = [
	[
		"strict subject schema and confirmation invariants",
		() => {
			assert.deepEqual(
				parseSubjectAwareScriptClaim(generalClaim),
				generalClaim,
			);
			expectSubjectError(
				() =>
					parseSubjectAwareScriptClaim({
						...generalClaim,
						subjectSource: null,
					}),
				"CLAIM_SUBJECT_CONFIRMED_SOURCE_REQUIRED",
			);
			expectSubjectError(
				() =>
					parseSubjectAwareScriptClaim({
						...generalClaim,
						subjectStatus: "NEEDS_CONFIRMATION",
					}),
				"CLAIM_SUBJECT_UNCONFIRMED_SOURCE_FORBIDDEN",
			);
			expectSubjectError(
				() =>
					parseSubjectAwareScriptClaim({
						...generalClaim,
						subject: { kind: "PRODUCT", binding: "PROJECT_UNBOUND" },
					}),
				"CLAIM_SUBJECT_INVALID",
			);
		},
	],
	[
		"Organic v3 preserves provider evidence across user correction",
		() => {
			const corrected = organicCanonicalClaimSchema.safeParse({
				text: generalClaim.text,
				occurrence: generalClaim.occurrence,
				proposedSubject: "PRODUCT",
				subject: { kind: "GENERAL" },
				subjectStatus: "CONFIRMED",
				subjectSource: "USER",
			});
			assert.equal(corrected.success, true);
			const unresolvedMismatch = organicCanonicalClaimSchema.safeParse({
				text: generalClaim.text,
				occurrence: generalClaim.occurrence,
				proposedSubject: "PRODUCT",
				subject: { kind: "GENERAL" },
				subjectStatus: "NEEDS_CONFIRMATION",
				subjectSource: null,
			});
			assert.equal(unresolvedMismatch.success, false);
			const unresolvedWithoutProposal = organicCanonicalClaimSchema.safeParse({
				text: generalClaim.text,
				occurrence: generalClaim.occurrence,
				subject: { kind: "GENERAL" },
				subjectStatus: "NEEDS_CONFIRMATION",
				subjectSource: null,
			});
			assert.equal(unresolvedWithoutProposal.success, false);
		},
	],
	[
		"frozen subject-aware claim vectors are literal and deterministic",
		() => {
			assert.equal(
				subjectAwareScriptClaimJson(generalClaim),
				'{"occurrence":{"section":"voiceover","segmentKey":"segment-1"},"subject":{"kind":"GENERAL"},"subjectSource":"USER","subjectStatus":"CONFIRMED","text":"Ba cách giúp bạn tập trung khi học."}',
			);
			assert.equal(
				subjectAwareScriptClaimJson(productClaim),
				'{"occurrence":{"section":"voiceover","segmentKey":"segment-1"},"subject":{"binding":"PROJECT_PRODUCT","kind":"PRODUCT"},"subjectSource":"USER","subjectStatus":"CONFIRMED","text":"Sản phẩm có thiết kế nhỏ gọn."}',
			);
			const unresolvedProduct = createNeedsConfirmationClaim({
				text: productClaim.text,
				occurrence: productClaim.occurrence,
				proposedSubject: "PRODUCT",
			});
			assert.equal(
				subjectAwareScriptClaimJson(unresolvedProduct),
				'{"occurrence":{"section":"voiceover","segmentKey":"segment-1"},"proposedSubject":"PRODUCT","subject":{"binding":"PROJECT_PRODUCT","kind":"PRODUCT"},"subjectSource":null,"subjectStatus":"NEEDS_CONFIRMATION","text":"Sản phẩm có thiết kế nhỏ gọn."}',
			);
		},
	],
	[
		"version-aware parser keeps v2 legacy and v3 subject contracts separate",
		() => {
			assert.deepEqual(
				parseScriptClaimByOutputVersion({
					version: "script-draft.v2",
					claim: legacyClaim,
				}),
				legacyClaim,
			);
			assert.deepEqual(
				parseScriptClaimByOutputVersion({
					version: "script-draft.v3",
					claim: productClaim,
				}),
				productClaim,
			);
			expectSubjectError(
				() =>
					parseScriptClaimByOutputVersion({
						version: "script-draft.v3",
						claim: legacyClaim,
					}),
				"CLAIM_SUBJECT_INVALID",
			);
			expectSubjectError(
				() =>
					parseScriptClaimByOutputVersion({
						version: "script-draft.unknown",
						claim: legacyClaim,
					}),
				"CLAIM_SUBJECT_INVALID",
			);
		},
	],
	[
		"current claimless inventory",
		() => {
			assert.deepEqual(summary([]), {
				status: "CURRENT",
				subjectResolution: "CONFIRMED",
				productClaimState: "NONE",
				productClaimCount: 0,
				generalClaimCount: 0,
			});
		},
	],
	[
		"current general-only inventory",
		() => {
			assert.deepEqual(
				summary([
					generalClaim,
					{ ...generalClaim, text: "Ngủ đủ giúp cơ thể hồi phục." },
				]),
				{
					status: "CURRENT",
					subjectResolution: "CONFIRMED",
					productClaimState: "NONE",
					productClaimCount: 0,
					generalClaimCount: 2,
				},
			);
		},
	],
	[
		"current Product inventory",
		() => {
			assert.deepEqual(summary([productClaim]), {
				status: "CURRENT",
				subjectResolution: "CONFIRMED",
				productClaimState: "PRESENT",
				productClaimCount: 1,
				generalClaimCount: 0,
			});
		},
	],
	[
		"current mixed inventory counts exactly",
		() => {
			assert.deepEqual(summary([generalClaim, productClaim]), {
				status: "CURRENT",
				subjectResolution: "CONFIRMED",
				productClaimState: "PRESENT",
				productClaimCount: 1,
				generalClaimCount: 1,
			});
		},
	],
	[
		"provider proposal remains unresolved",
		() => {
			const proposedProduct = createNeedsConfirmationClaim({
				text: productClaim.text,
				occurrence: productClaim.occurrence,
				proposedSubject: "PRODUCT",
			});
			const proposedGeneral = createNeedsConfirmationClaim({
				text: generalClaim.text,
				occurrence: generalClaim.occurrence,
				proposedSubject: "GENERAL",
			});
			assert.equal(proposedProduct.subjectStatus, "NEEDS_CONFIRMATION");
			assert.equal(proposedProduct.subjectSource, null);
			assert.deepEqual(summary([proposedProduct]), {
				status: "CURRENT",
				subjectResolution: "NEEDS_CONFIRMATION",
				productClaimState: "UNKNOWN",
				productClaimCount: null,
				generalClaimCount: null,
			});
			assert.deepEqual(summary([proposedGeneral]), {
				status: "CURRENT",
				subjectResolution: "NEEDS_CONFIRMATION",
				productClaimState: "UNKNOWN",
				productClaimCount: null,
				generalClaimCount: null,
			});
		},
	],
	[
		"stale inventory fails closed",
		() => {
			assert.deepEqual(summary([productClaim], "ORGANIC", "stale"), {
				status: "STALE",
				subjectResolution: "UNKNOWN",
				productClaimState: "UNKNOWN",
				productClaimCount: null,
				generalClaimCount: null,
			});
		},
	],
	[
		"malformed inventory fails closed",
		() => {
			assert.deepEqual(
				summary([
					{ text: "bad", occurrence: voiceoverOccurrence, subject: {} },
				]),
				{
					status: "UNKNOWN",
					subjectResolution: "UNKNOWN",
					productClaimState: "UNKNOWN",
					productClaimCount: null,
					generalClaimCount: null,
				},
			);
			assert.deepEqual(summary({ not: "an array" }), {
				status: "UNKNOWN",
				subjectResolution: "UNKNOWN",
				productClaimState: "UNKNOWN",
				productClaimCount: null,
				generalClaimCount: null,
			});
		},
	],
	[
		"legacy Affiliate adapter is effective-only",
		() => {
			const adapted = summarizeClaimInventory({
				contentType: "AFFILIATE",
				creationPath: "SCRIPTED",
				claimsStatus: "current",
				claims: [legacyClaim],
			});
			assert.deepEqual(adapted, {
				status: "CURRENT",
				subjectResolution: "CONFIRMED",
				productClaimState: "PRESENT",
				productClaimCount: 1,
				generalClaimCount: 0,
			});
			assert.deepEqual(legacyClaim, {
				text: "Sản phẩm có thiết kế nhỏ gọn.",
				occurrence: voiceoverOccurrence,
			});
			assert.deepEqual(LEGACY_AFFILIATE_CLAIM_SUBJECT, {
				kind: "PRODUCT",
				binding: "PROJECT_PRODUCT",
			});
		},
	],
	[
		"subject-less Organic fails closed",
		() => {
			assert.deepEqual(summary([legacyClaim]), {
				status: "UNKNOWN",
				subjectResolution: "UNKNOWN",
				productClaimState: "UNKNOWN",
				productClaimCount: null,
				generalClaimCount: null,
			});
		},
	],
	[
		"legacy compatibility provenance is context-bound",
		() => {
			assert.deepEqual(
				summary([
					{
						...productClaim,
						subjectSource: "LEGACY_COMPATIBILITY" as const,
					},
				]),
				{
					status: "UNKNOWN",
					subjectResolution: "UNKNOWN",
					productClaimState: "UNKNOWN",
					productClaimCount: null,
					generalClaimCount: null,
				},
			);
		},
	],
	[
		"Product binding is deterministic and effective-only",
		() => {
			assert.equal(
				resolveProductClaimBinding({
					productClaimState: "NONE",
					projectProductId: null,
				}),
				"NONE",
			);
			assert.equal(
				resolveProductClaimBinding({
					productClaimState: "PRESENT",
					projectProductId: "product-1",
				}),
				"BOUND",
			);
			assert.equal(
				resolveProductClaimBinding({
					productClaimState: "PRESENT",
					projectProductId: null,
				}),
				"UNBOUND",
			);
			assert.equal(
				resolveProductClaimBinding({
					productClaimState: "UNKNOWN",
					projectProductId: "product-1",
				}),
				"UNKNOWN",
			);
		},
	],
	[
		"user confirmation and correction are pure transitions",
		() => {
			const proposed = createNeedsConfirmationClaim({
				text: generalClaim.text,
				occurrence: generalClaim.occurrence,
				proposedSubject: "PRODUCT",
			});
			const confirmedGeneral = confirmClaimSubject({
				claim: proposed,
				subject: { kind: "GENERAL" },
			});
			assert.deepEqual(confirmedGeneral, {
				text: generalClaim.text,
				occurrence: generalClaim.occurrence,
				subject: { kind: "GENERAL" },
				subjectStatus: "CONFIRMED",
				subjectSource: "USER",
				proposedSubject: "PRODUCT",
			});
			assert.deepEqual(summary([confirmedGeneral]), {
				status: "CURRENT",
				subjectResolution: "CONFIRMED",
				productClaimState: "NONE",
				productClaimCount: 0,
				generalClaimCount: 1,
			});
		},
	],
	[
		"explicit structured source confirmation only",
		() => {
			const proposed = createNeedsConfirmationClaim({
				text: productClaim.text,
				occurrence: productClaim.occurrence,
				proposedSubject: "PRODUCT",
			});
			const confirmed = confirmStructuredClaimSubject({
				claim: proposed,
				subject: { kind: "PRODUCT", binding: "PROJECT_PRODUCT" },
			});
			assert.equal(confirmed.subjectStatus, "CONFIRMED");
			assert.equal(confirmed.subjectSource, "STRUCTURED_SOURCE");
			assert.equal(summary([confirmed]).productClaimState, "PRESENT");
		},
	],
	[
		"subject-aware Manifest v2 projection is deterministic and separate from v1",
		() => {
			const projection = buildSubjectAwareManifestClaimProjection({
				claimKey: manifestClaimKey,
				claim: productClaim,
				locator: {
					sourceType: "SCRIPT_VERSION",
					occurrence: voiceoverOccurrence,
				},
				sourceTextHash: manifestSourceTextHash,
			});
			assert.equal(
				subjectAwareManifestClaimProjectionJson(projection),
				'{"claimKey":"claim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","claimText":"Sản phẩm có thiết kế nhỏ gọn.","locator":{"occurrence":{"section":"voiceover","segmentKey":"segment-1"},"sourceType":"SCRIPT_VERSION"},"sourceTextHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","subject":{"binding":"PROJECT_PRODUCT","kind":"PRODUCT"},"subjectSource":"USER","subjectStatus":"CONFIRMED"}',
			);
			assert.equal(CLAIM_MANIFEST_SCHEMA_VERSION, "claim-manifest.v1");
			assert.equal(CLAIM_MANIFEST_BUILDER_VERSION, "claim-manifest-builder.v1");
		},
	],
	[
		"version plan defines next versions without runtime cutover",
		() => {
			assert.equal(
				CLAIM_SUBJECT_CURRENT_SCRIPT_INPUT_VERSION,
				"script-input.v2",
			);
			assert.equal(CLAIM_SUBJECT_NEXT_SCRIPT_INPUT_VERSION, "script-input.v3");
			assert.equal(
				CLAIM_SUBJECT_CURRENT_SCRIPT_OUTPUT_SCHEMA_VERSION,
				"script-draft.v2",
			);
			assert.equal(
				CLAIM_SUBJECT_NEXT_SCRIPT_OUTPUT_SCHEMA_VERSION,
				"script-draft.v3",
			);
			assert.equal(
				CLAIM_SUBJECT_CURRENT_SCRIPT_PROMPT_VERSION,
				"script-prompt.v2",
			);
			assert.equal(
				CLAIM_SUBJECT_NEXT_SCRIPT_PROMPT_VERSION,
				"script-prompt.v3",
			);
			assert.equal(
				CLAIM_SUBJECT_CURRENT_REFRESH_INPUT_VERSION,
				"script-claim-refresh.v1",
			);
			assert.equal(
				CLAIM_SUBJECT_CURRENT_REFRESH_PROMPT_VERSION,
				"script-claim-refresh-prompt.v1",
			);
			assert.equal(
				CLAIM_SUBJECT_NEXT_REFRESH_PROMPT_VERSION,
				"script-claim-refresh-prompt.v2",
			);
			assert.equal(
				CLAIM_SUBJECT_CURRENT_REFRESH_OUTPUT_SCHEMA_VERSION,
				"script-claim-refresh-output.v1",
			);
			assert.equal(
				CLAIM_SUBJECT_NEXT_REFRESH_OUTPUT_SCHEMA_VERSION,
				"script-claim-refresh-output.v2",
			);
			assert.equal(
				CLAIM_SUBJECT_CURRENT_MANIFEST_SCHEMA_VERSION,
				"claim-manifest.v1",
			);
			assert.equal(
				CLAIM_SUBJECT_CURRENT_MANIFEST_BUILDER_VERSION,
				"claim-manifest-builder.v1",
			);
			assert.equal(
				CLAIM_SUBJECT_NEXT_MANIFEST_BUILDER_VERSION,
				"claim-manifest-builder.v2",
			);
			assert.equal(
				CLAIM_SUBJECT_CURRENT_FACT_LOCK_MANIFEST_INPUT_VERSION,
				"fact-lock.manifest.v1",
			);
			assert.equal(
				CLAIM_SUBJECT_NEXT_FACT_LOCK_MANIFEST_INPUT_VERSION,
				"fact-lock.manifest.v2",
			);
		},
	],
];

for (const [name, test] of tests) {
	test();
	console.log(`PASS ${name}`);
}

console.log(`Claim subject unit tests passed: ${tests.length}/${tests.length}`);
