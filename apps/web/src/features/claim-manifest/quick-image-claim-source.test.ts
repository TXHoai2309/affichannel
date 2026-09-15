import {
	buildClaimManifestFromQuickImageSource,
	buildManifestFactLockInputSnapshot,
	canonicalizeQuickImageClaimSourceDocument,
	canonicalQuickImageClaimSourceJson,
	manifestFactLockInputSnapshotSchema,
	type QuickImageClaimSourceDocument,
	quickImageClaimSourceContentHash,
	validateBuiltClaimManifest,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const source: QuickImageClaimSourceDocument = {
	version: "quick-image-claim-source.v1",
	elements: [
		{ id: "caption-main", kind: "CAPTION", text: "  Pin 20 giờ.\r\n" },
		{ id: "cta-main", kind: "CTA", text: "Mua ngay." },
		{ id: "empty-overlay", kind: "OVERLAY", text: "   " },
	],
};

describe("Quick Image durable claim-source authority", () => {
	it("canonicalizes semantic JSON and hashes equivalent documents identically", async () => {
		const equivalent: QuickImageClaimSourceDocument = {
			version: "quick-image-claim-source.v1",
			elements: [
				{ id: "cta-main", kind: "CTA", text: "Mua ngay." },
				{ id: "caption-main", kind: "CAPTION", text: "Pin 20 giờ." },
				{ id: "empty-overlay", kind: "OVERLAY", text: "" },
			],
		};
		expect(canonicalQuickImageClaimSourceJson(source)).toBe(
			canonicalQuickImageClaimSourceJson(equivalent),
		);
		expect(await quickImageClaimSourceContentHash(source)).toBe(
			await quickImageClaimSourceContentHash(equivalent),
		);
	});

	it("rejects unsupported schema versions and duplicate element identities", () => {
		expect(() =>
			canonicalizeQuickImageClaimSourceDocument({
				version: "quick-image-claim-source.v2",
				elements: [],
			}),
		).toThrow();
		expect(() =>
			canonicalizeQuickImageClaimSourceDocument({
				version: "quick-image-claim-source.v1",
				elements: [
					{ id: "same ", kind: "CAPTION", text: "A" },
					{ id: " same", kind: "CTA", text: "B" },
				],
			}),
		).toThrow("QUICK_IMAGE_CLAIM_SOURCE_DUPLICATE_ELEMENT_ID");
	});

	it("uses locale-independent ordinal ordering for Unicode IDs", async () => {
		const sourceA: QuickImageClaimSourceDocument = {
			version: "quick-image-claim-source.v1",
			elements: [
				{ id: "é", kind: "CAPTION", text: "é" },
				{ id: "Å", kind: "CAPTION", text: "Å" },
				{ id: "z", kind: "CAPTION", text: "z" },
				{ id: "ä", kind: "CAPTION", text: "ä" },
				{ id: "a", kind: "CAPTION", text: "a" },
			],
		};
		const sourceB: QuickImageClaimSourceDocument = {
			...sourceA,
			elements: [
				sourceA.elements[2],
				sourceA.elements[4],
				sourceA.elements[0],
				sourceA.elements[3],
				sourceA.elements[1],
			],
		};
		const sourceC: QuickImageClaimSourceDocument = {
			...sourceA,
			elements: [...sourceA.elements].reverse(),
		};

		const expectedJson =
			'{"elements":[{"id":"a","kind":"CAPTION","text":"a"},{"id":"z","kind":"CAPTION","text":"z"},{"id":"Å","kind":"CAPTION","text":"Å"},{"id":"ä","kind":"CAPTION","text":"ä"},{"id":"é","kind":"CAPTION","text":"é"}],"version":"quick-image-claim-source.v1"}';
		const canonicalJson = canonicalQuickImageClaimSourceJson(sourceA);
		expect(
			canonicalizeQuickImageClaimSourceDocument(sourceA).elements.map(
				(element) => element.id,
			),
		).toEqual(["a", "z", "Å", "ä", "é"]);
		expect(canonicalJson).toBe(expectedJson);
		expect(canonicalQuickImageClaimSourceJson(sourceB)).toBe(expectedJson);
		expect(canonicalQuickImageClaimSourceJson(sourceC)).toBe(expectedJson);

		const expectedHash = await quickImageClaimSourceContentHash(sourceA);
		expect(expectedHash).toBe(
			"44e0208564d2d29a7a3f0230d0f352af4ac9067f98107b584ebeb65cbeb5025f",
		);
		expect(expectedHash).toBe(await quickImageClaimSourceContentHash(sourceB));
		expect(expectedHash).toBe(await quickImageClaimSourceContentHash(sourceC));
		expect(expectedHash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("derives deterministic NO_SCRIPT manifest provenance and claims from non-empty text", async () => {
		const sourceHash = await quickImageClaimSourceContentHash(source);
		const [first, second] = await Promise.all([
			buildClaimManifestFromQuickImageSource({
				workspaceId: "workspace-quick-image",
				projectId: "project-quick-image",
				productId: "product-quick-image",
				source,
				sourceRevision: 3,
				sourceContentHashSha256: sourceHash,
			}),
			buildClaimManifestFromQuickImageSource({
				workspaceId: "workspace-quick-image",
				projectId: "project-quick-image",
				productId: "product-quick-image",
				source,
				sourceRevision: 3,
				sourceContentHashSha256: sourceHash,
			}),
		]);

		expect(first).toEqual(second);
		expect(first.source).toMatchObject({
			sourceType: "NO_SCRIPT",
			sourceSchemaVersion: "quick-image-claim-source.v1",
			sourceRevision: "3",
			sourceContentHash: sourceHash,
		});
		expect(first.claimCount).toBe(2);
		expect(first.claims.map((claim) => claim.locator)).toEqual([
			{
				sourceType: "NO_SCRIPT",
				elementKind: "CAPTION",
				elementKey: "caption-main",
			},
			{ sourceType: "NO_SCRIPT", elementKind: "CTA", elementKey: "cta-main" },
		]);
		expect((await validateBuiltClaimManifest(first)).success).toBe(true);
	});

	it("supports the claim-free Organic path without a ScriptVersion", async () => {
		const emptySource: QuickImageClaimSourceDocument = {
			version: "quick-image-claim-source.v1",
			elements: [{ id: "overlay-main", kind: "OVERLAY", text: "   " }],
		};
		const hash = await quickImageClaimSourceContentHash(emptySource);
		const manifest = await buildClaimManifestFromQuickImageSource({
			workspaceId: "workspace-organic-quick-image",
			projectId: "project-organic-quick-image",
			productId: "product-organic-quick-image",
			source: emptySource,
			sourceRevision: 1,
			sourceContentHashSha256: hash,
		});
		expect(manifest.isEmpty).toBe(true);
		expect(manifest.claimCount).toBe(0);
		expect(manifest.source.sourceType).toBe("NO_SCRIPT");
		const snapshot = buildManifestFactLockInputSnapshot({
			manifest: {
				id: "manifest-organic-quick-image",
				...manifest,
			},
			productFacts: [],
			policy: null,
			outputRules: null,
		});
		expect(
			manifestFactLockInputSnapshotSchema.safeParse(snapshot).success,
		).toBe(true);
	});
});
