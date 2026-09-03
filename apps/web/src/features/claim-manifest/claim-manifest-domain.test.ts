import type {
	BuildClaimManifestFromScriptVersionInput,
	BuiltClaimManifest,
	ClaimManifestClaim,
	ScriptVersionEditableSnapshot,
} from "@affichannel/core";
import {
	assignSameLocatorOrdinals,
	buildClaimManifestFromScriptVersion,
	buildSubjectAwareClaimManifestFromScriptVersion,
	CLAIM_MANIFEST_BUILDER_VERSION,
	CLAIM_MANIFEST_BUILDER_VERSION_V2,
	CLAIM_MANIFEST_SCHEMA_VERSION,
	canonicalClaimManifestLocator,
	canonicalClaimSourceText,
	claimManifestFingerprint,
	claimManifestFingerprintProjection,
	claimManifestSourceTextHash,
	parseBuiltClaimManifest,
	parseClaimManifestByBuilderVersion,
	scriptVersionClaimManifestLocator,
	scriptVersionSourceContentHash,
	selectConfirmedProductManifestClaims,
	sha256Hex,
	validateBuiltClaimManifest,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

function snapshot(): ScriptVersionEditableSnapshot {
	return {
		schemaVersion: "script-draft.v2",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook-a", text: "Pin dùng liên tục 20 giờ." },
			{ key: "hook-b", text: "Một lựa chọn âm thanh gọn nhẹ." },
			{ key: "hook-c", text: "Trải nghiệm nghe nhạc mỗi ngày." },
		],
		selectedHookKey: "hook-a",
		voiceoverSegments: [
			{ key: "voice-a", text: "Tai nghe hỗ trợ chống ồn chủ động." },
			{ key: "voice-b", text: "Thiết kế phù hợp sử dụng hằng ngày." },
		],
		scenes: [
			{
				order: 1,
				durationSeconds: 15,
				visualDirection: "Cận cảnh sản phẩm",
				onScreenText: "Bảo hành chính hãng 12 tháng.",
				voiceoverSegmentKeys: ["voice-a"],
			},
			{
				order: 2,
				durationSeconds: 15,
				visualDirection: "Người dùng đeo tai nghe",
				onScreenText: "Đổi trả trong 30 ngày.",
				voiceoverSegmentKeys: ["voice-b"],
			},
		],
		cta: { text: "Mua ngay hôm nay để nhận ưu đãi." },
		caption: "Giá niêm yết 990.000đ.",
		hashtags: ["#tainghe"],
		disclosure: "Nội dung có liên kết affiliate.",
		claims: [
			{
				text: "Pin dùng liên tục 20 giờ",
				occurrence: { section: "hook", hookKey: "hook-a" },
			},
			{
				text: "chống ồn chủ động",
				occurrence: { section: "voiceover", segmentKey: "voice-a" },
			},
			{
				text: "Bảo hành chính hãng 12 tháng",
				occurrence: { section: "scene", sceneOrder: 1 },
			},
		],
		claimsSourceRevision: 3,
		claimsStatus: "current",
	};
}

function buildInput(
	overrides: Partial<BuildClaimManifestFromScriptVersionInput> = {},
): BuildClaimManifestFromScriptVersionInput {
	return {
		workspaceId: "workspace-claim-manifest",
		projectId: "project-claim-manifest",
		productId: "product-claim-manifest",
		scriptVersionId: "script-version-claim-manifest",
		scriptVersionRevision: 7,
		snapshot: snapshot(),
		...overrides,
	};
}

type OrganicSnapshotFixture = {
	[key: string]: unknown;
	claims: Array<Record<string, unknown>>;
};

function organicSnapshot(): OrganicSnapshotFixture {
	return {
		...snapshot(),
		schemaVersion: "script-draft.v3",
		selectedHookKey: "hook-a",
		claims: [
			{
				text: "Pin dùng liên tục 20 giờ",
				occurrence: { section: "hook", hookKey: "hook-a" },
				subject: { kind: "PRODUCT", binding: "PROJECT_PRODUCT" },
				subjectStatus: "CONFIRMED",
				subjectSource: "USER",
			},
			{
				text: "chống ồn chủ động",
				occurrence: { section: "voiceover", segmentKey: "voice-a" },
				subject: { kind: "GENERAL" },
				subjectStatus: "CONFIRMED",
				subjectSource: "STRUCTURED_SOURCE",
			},
		],
		claimsSourceRevision: 7,
		claimsStatus: "current",
	};
}

function cloneSnapshot(): ScriptVersionEditableSnapshot {
	return structuredClone(snapshot());
}

function repeatedLocatorSnapshot(): ScriptVersionEditableSnapshot {
	const value = cloneSnapshot();
	value.caption = "Giá 990.000đ, bảo hành 12 tháng và đổi trả 30 ngày.";
	value.scenes[0] = {
		...value.scenes[0],
		onScreenText: "Bảo hành 12 tháng và đổi trả 30 ngày.",
	};
	value.claims = [
		{ text: "Giá 990.000đ", occurrence: { section: "caption" } },
		{
			text: "Bảo hành 12 tháng",
			occurrence: { section: "scene", sceneOrder: 1 },
		},
		{ text: "bảo hành 12 tháng", occurrence: { section: "caption" } },
		{ text: "đổi trả 30 ngày", occurrence: { section: "caption" } },
		{
			text: "đổi trả 30 ngày",
			occurrence: { section: "scene", sceneOrder: 1 },
		},
	];
	return value;
}

function unicodeSnapshot(): ScriptVersionEditableSnapshot {
	const value = cloneSnapshot();
	value.caption = "  Giá Café\r\n  giữ  hai khoảng trắng!  ";
	value.claims = [
		{
			text: "Giá Café",
			occurrence: { section: "caption" },
		},
	];
	return value;
}

async function noScriptManifest(): Promise<BuiltClaimManifest> {
	const source = {
		sourceType: "NO_SCRIPT" as const,
		sourceSchemaVersion: "composition.v1",
		sourceRevision: "revision-1",
		elements: [
			{
				kind: "CAPTION" as const,
				key: "caption-main",
				revision: "1",
				contentHash: "a".repeat(64),
			},
		],
		sourceContentHash: "b".repeat(64),
	};
	const claims: ClaimManifestClaim[] = [
		{
			claimKey: `claim_${"c".repeat(64)}`,
			claimText: "Giá 990.000đ",
			locator: {
				sourceType: "NO_SCRIPT",
				elementKind: "CAPTION",
				elementKey: "caption-main",
			},
			sourceTextHash: "d".repeat(64),
		},
	];
	return {
		workspaceId: "workspace-no-script",
		projectId: "project-no-script",
		source,
		productId: null,
		schemaVersion: CLAIM_MANIFEST_SCHEMA_VERSION,
		builderVersion: CLAIM_MANIFEST_BUILDER_VERSION,
		claims,
		claimCount: 1,
		isEmpty: false,
		fingerprint: await claimManifestFingerprint({
			workspaceId: "workspace-no-script",
			projectId: "project-no-script",
			source,
			productId: null,
			claims,
		}),
	};
}

describe("AFF-US-017 Phase 17A ClaimManifest domain", () => {
	it("builds a strict immutable ScriptVersion Manifest", async () => {
		const manifest = await buildClaimManifestFromScriptVersion(buildInput());

		expect(manifest.schemaVersion).toBe("claim-manifest.v1");
		expect(manifest.builderVersion).toBe("claim-manifest-builder.v1");
		expect(manifest.claimCount).toBe(3);
		expect(manifest.isEmpty).toBe(false);
		expect(manifest.productId).toBe("product-claim-manifest");
		expect(manifest.source.sourceType).toBe("SCRIPT_VERSION");
		expect(manifest.fingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(Object.isFrozen(manifest)).toBe(true);
		expect(Object.isFrozen(manifest.claims)).toBe(true);
		expect(Object.isFrozen(manifest.claims[0]?.locator)).toBe(true);
		expect((await validateBuiltClaimManifest(manifest)).success).toBe(true);
	});

	it("accepts a valid empty and productless deterministic Manifest", async () => {
		const empty = cloneSnapshot();
		empty.claims = [];
		const manifest = await buildClaimManifestFromScriptVersion(
			buildInput({ productId: null, snapshot: empty }),
		);

		expect(manifest.claims).toEqual([]);
		expect(manifest.claimCount).toBe(0);
		expect(manifest.isEmpty).toBe(true);
		expect(manifest.productId).toBeNull();
		expect((await validateBuiltClaimManifest(manifest)).success).toBe(true);
	});

	it("represents a strict no-script fixture without adding an adapter", async () => {
		const manifest = await noScriptManifest();
		expect((await parseBuiltClaimManifest(manifest)).source.sourceType).toBe(
			"NO_SCRIPT",
		);
		expect(
			(
				await validateBuiltClaimManifest({
					...manifest,
					claims: manifest.claims.map((claim) => ({
						...claim,
						locator: {
							...claim.locator,
							elementKey: "missing-element",
						},
					})),
				})
			).success,
		).toBe(false);
	});

	it("rejects unknown fields, unsupported versions, count/empty mismatch and duplicate keys", async () => {
		const base = await buildClaimManifestFromScriptVersion(buildInput());
		for (const invalid of [
			{ ...base, unexpected: true },
			{ ...base, schemaVersion: "claim-manifest.v2" },
			{ ...base, builderVersion: "claim-manifest-builder.v2" },
			{ ...base, claimCount: base.claimCount + 1 },
			{ ...base, isEmpty: true },
			{ ...base, claims: [base.claims[0], base.claims[0]], claimCount: 2 },
		]) {
			expect((await validateBuiltClaimManifest(invalid)).success).toBe(false);
		}
		const fingerprintMismatch = await validateBuiltClaimManifest({
			...base,
			fingerprint: "f".repeat(64),
		});
		expect(fingerprintMismatch).toMatchObject({
			success: false,
			error: { issueCodes: ["FINGERPRINT_MISMATCH"] },
		});
	});

	it("rejects stale/invalid sources and more than 64 claims without truncation", async () => {
		const stale = cloneSnapshot();
		stale.claimsStatus = "stale";
		await expect(
			buildClaimManifestFromScriptVersion(buildInput({ snapshot: stale })),
		).rejects.toMatchObject({ code: "CLAIM_MANIFEST_SOURCE_NOT_USABLE" });
		const futureClaims = cloneSnapshot();
		futureClaims.claimsSourceRevision = 8;
		await expect(
			buildClaimManifestFromScriptVersion(
				buildInput({
					scriptVersionRevision: 7,
					snapshot: futureClaims,
				}),
			),
		).rejects.toMatchObject({ issueCodes: ["INVALID_SOURCE"] });

		const unsupported = {
			...cloneSnapshot(),
			schemaVersion: "script-draft.v3",
		};
		await expect(
			buildClaimManifestFromScriptVersion(
				buildInput({ snapshot: unsupported }),
			),
		).rejects.toMatchObject({
			code: "CLAIM_MANIFEST_SOURCE_NOT_USABLE",
			issueCodes: ["UNSUPPORTED_SCHEMA_VERSION"],
		});

		const tooMany = cloneSnapshot();
		tooMany.caption = "Một claim hợp lệ.";
		tooMany.claims = Array.from({ length: 65 }, () => ({
			text: "Một claim hợp lệ",
			occurrence: { section: "caption" as const },
		}));
		await expect(
			buildClaimManifestFromScriptVersion(buildInput({ snapshot: tooMany })),
		).rejects.toMatchObject({ issueCodes: ["CLAIM_LIMIT_EXCEEDED"] });
	});

	it("implements the exact canonical source-text transform", async () => {
		expect(canonicalClaimSourceText("  A\u0301\r\nB\rC  ")).toBe("Á\nB\nC");
		expect(canonicalClaimSourceText("A  B\n  C")).toBe("A  B\n  C");
		expect(canonicalClaimSourceText("Claim!")).toBe("Claim!");
		expect(canonicalClaimSourceText("Claim!")).not.toBe(
			canonicalClaimSourceText("claim!"),
		);

		expect(await claimManifestSourceTextHash("  A\u0301\r\nB  ")).toBe(
			await claimManifestSourceTextHash("Á\nB"),
		);
		expect(await claimManifestSourceTextHash("A  B")).not.toBe(
			await claimManifestSourceTextHash("A B"),
		);
		expect(await claimManifestSourceTextHash("Claim!")).not.toBe(
			await claimManifestSourceTextHash("claim!"),
		);
		expect(await claimManifestSourceTextHash("Claim!")).not.toBe(
			await claimManifestSourceTextHash("Claim?"),
		);
	});

	it("canonicalizes all existing structured locator variants without collisions", () => {
		const locators = [
			scriptVersionClaimManifestLocator({
				section: "hook",
				hookKey: "hook-a",
			}),
			scriptVersionClaimManifestLocator({
				section: "voiceover",
				segmentKey: "voice-a",
			}),
			scriptVersionClaimManifestLocator({ section: "scene", sceneOrder: 1 }),
			scriptVersionClaimManifestLocator({ section: "cta" }),
			scriptVersionClaimManifestLocator({ section: "caption" }),
		];
		const identities = locators.map(canonicalClaimManifestLocator);
		expect(new Set(identities).size).toBe(5);
		expect(identities[0]).not.toBe(
			canonicalClaimManifestLocator(
				scriptVersionClaimManifestLocator({
					section: "hook",
					hookKey: "hook-b",
				}),
			),
		);
	});

	it("builds source text and hashes for all five current locator categories", async () => {
		const value = cloneSnapshot();
		value.claims = [
			{
				text: "Pin dùng liên tục 20 giờ",
				occurrence: { section: "hook", hookKey: "hook-a" },
			},
			{
				text: "chống ồn chủ động",
				occurrence: { section: "voiceover", segmentKey: "voice-a" },
			},
			{
				text: "Bảo hành chính hãng 12 tháng",
				occurrence: { section: "scene", sceneOrder: 1 },
			},
			{ text: "Mua ngay hôm nay", occurrence: { section: "cta" } },
			{ text: "Giá niêm yết 990.000đ", occurrence: { section: "caption" } },
		];
		const manifest = await buildClaimManifestFromScriptVersion(
			buildInput({ snapshot: value }),
		);
		expect(manifest.claims).toHaveLength(5);
		expect(
			manifest.claims.every((claim) =>
				/^[a-f0-9]{64}$/.test(claim.sourceTextHash),
			),
		).toBe(true);
	});

	it("assigns zero-based locator-scoped ordinals in original array order", () => {
		const caption = scriptVersionClaimManifestLocator({ section: "caption" });
		const scene = scriptVersionClaimManifestLocator({
			section: "scene",
			sceneOrder: 1,
		});
		expect(
			assignSameLocatorOrdinals([caption, scene, caption, caption, scene]),
		).toEqual([0, 0, 1, 2, 1]);
	});

	it("changes sourceContentHash for every included source projection field", async () => {
		const base = cloneSnapshot();
		const mutations: ScriptVersionEditableSnapshot[] = [];
		const selectedHook = cloneSnapshot();
		selectedHook.hookVariants[0] = {
			...selectedHook.hookVariants[0],
			text: "Pin dùng liên tục 21 giờ.",
		};
		mutations.push(selectedHook);
		const voiceover = cloneSnapshot();
		voiceover.voiceoverSegments[0] = {
			...voiceover.voiceoverSegments[0],
			text: "Tai nghe hỗ trợ chống ồn thích ứng.",
		};
		mutations.push(voiceover);
		const scene = cloneSnapshot();
		scene.scenes[0] = {
			...scene.scenes[0],
			onScreenText: "Bảo hành chính hãng 24 tháng.",
		};
		mutations.push(scene);
		const cta = cloneSnapshot();
		cta.cta = { text: "Mua ngay ngày mai." };
		mutations.push(cta);
		const caption = cloneSnapshot();
		caption.caption = "Giá niêm yết 880.000đ.";
		mutations.push(caption);
		const claims = cloneSnapshot();
		claims.claims = [...claims.claims].reverse();
		mutations.push(claims);

		for (const included of mutations) {
			expect(await scriptVersionSourceContentHash(included)).not.toBe(
				await scriptVersionSourceContentHash(base),
			);
		}
	});

	it("excludes metadata and non-claim Script surfaces from sourceContentHash", async () => {
		const base = cloneSnapshot();
		const excluded = cloneSnapshot();
		excluded.language = "en-US";
		excluded.hashtags = ["#different"];
		excluded.disclosure = "Different disclosure";
		excluded.claimsSourceRevision = 99;
		excluded.claimsStatus = "stale";
		excluded.scenes[0] = {
			...excluded.scenes[0],
			durationSeconds: 99,
			visualDirection: "Different visual",
			voiceoverSegmentKeys: ["voice-b"],
		};

		expect(await scriptVersionSourceContentHash(excluded)).toBe(
			await scriptVersionSourceContentHash(base),
		);
	});

	it("keeps claim keys stable and separates repeated same-locator claims", async () => {
		const first = await buildClaimManifestFromScriptVersion(
			buildInput({ snapshot: repeatedLocatorSnapshot() }),
		);
		const second = await buildClaimManifestFromScriptVersion(
			buildInput({ snapshot: repeatedLocatorSnapshot() }),
		);
		expect(first.claims.map((claim) => claim.claimKey)).toEqual(
			second.claims.map((claim) => claim.claimKey),
		);
		expect(new Set(first.claims.map((claim) => claim.claimKey)).size).toBe(5);
		expect(first.claims.map((claim) => claim.claimText)).toEqual([
			"Giá 990.000đ",
			"Bảo hành 12 tháng",
			"bảo hành 12 tháng",
			"đổi trả 30 ngày",
			"đổi trả 30 ngày",
		]);
	});

	it("fingerprints every semantic field and ignores incidental caller metadata", async () => {
		const base = await buildClaimManifestFromScriptVersion(buildInput());
		const intent = {
			workspaceId: base.workspaceId,
			projectId: base.projectId,
			source: base.source,
			productId: base.productId,
			claims: base.claims,
		};
		const sameWithIncidentalFields = await claimManifestFingerprint({
			...intent,
			id: "random-id",
			createdAt: new Date("2099-01-01T00:00:00Z"),
		} as typeof intent);
		expect(sameWithIncidentalFields).toBe(base.fingerprint);

		for (const changed of [
			{ ...intent, workspaceId: "workspace-other" },
			{ ...intent, projectId: "project-other" },
			{ ...intent, productId: "product-other" },
			{
				...intent,
				source: { ...base.source, scriptVersionRevision: 8 },
			},
			{
				...intent,
				source: { ...base.source, sourceContentHash: "f".repeat(64) },
			},
			{ ...intent, claims: [...base.claims].reverse() },
		]) {
			expect(await claimManifestFingerprint(changed)).not.toBe(
				base.fingerprint,
			);
		}

		const projection = claimManifestFingerprintProjection(intent);
		expect(
			await sha256Hex({
				...projection,
				builderVersion: "claim-manifest-builder.v2",
			}),
		).not.toBe(base.fingerprint);
		expect(
			await sha256Hex({ ...projection, domain: "claim-manifest.v2" }),
		).not.toBe(base.fingerprint);
	});

	it("fails invalid selected-hook and source-text references instead of returning empty", async () => {
		const wrongHook = cloneSnapshot();
		wrongHook.claims[0] = {
			text: "Một lựa chọn âm thanh",
			occurrence: { section: "hook", hookKey: "hook-b" },
		};
		await expect(
			buildClaimManifestFromScriptVersion(buildInput({ snapshot: wrongHook })),
		).rejects.toMatchObject({ issueCodes: ["CLAIM_REFERENCE_INVALID"] });

		const missingText = cloneSnapshot();
		missingText.scenes[0] = { ...missingText.scenes[0], onScreenText: null };
		await expect(
			buildClaimManifestFromScriptVersion(
				buildInput({ snapshot: missingText }),
			),
		).rejects.toMatchObject({ issueCodes: ["CLAIM_REFERENCE_INVALID"] });

		const malformedV2 = { ...cloneSnapshot(), selectedHookKey: 42 };
		await expect(
			buildClaimManifestFromScriptVersion(
				buildInput({ snapshot: malformedV2 }),
			),
		).rejects.toMatchObject({ issueCodes: ["INVALID_SOURCE"] });
	});

	it("matches frozen deterministic identity vectors", async () => {
		const vectors = await Promise.all([
			["multi", snapshot()],
			["repeated", repeatedLocatorSnapshot()],
			["unicode", unicodeSnapshot()],
		] as const).then(async (entries) =>
			Promise.all(
				entries.map(async ([name, value]) => {
					const manifest = await buildClaimManifestFromScriptVersion(
						buildInput({ snapshot: value }),
					);
					return {
						name,
						sourceContentHash: manifest.source.sourceContentHash,
						sourceTextHash: manifest.claims[0]?.sourceTextHash,
						claimKey: manifest.claims[0]?.claimKey,
						fingerprint: manifest.fingerprint,
					};
				}),
			),
		);

		expect(vectors).toEqual([
			{
				name: "multi",
				sourceContentHash:
					"94f53c988df395387f1cacc90a596d2a2ea416710526564ce30101d88f0f4677",
				sourceTextHash:
					"5c2b64544fb655e2eaee35ba832044c29f46ee4e4ed0b623ec9442f414cf93b3",
				claimKey:
					"claim_8cdca7340791f2a3490612b98c78eec2773f9d318fec33ca0b58a04a0463ebaa",
				fingerprint:
					"e60e6d50af656f782e1f0698d3f3048477ce76b97e6ec0ed3d8ea91cfb635f35",
			},
			{
				name: "repeated",
				sourceContentHash:
					"54404139820f9c665769e939f98a7100a5188b9e6b34167e5dfc822a6b4c3cd4",
				sourceTextHash:
					"c20da28304f3df6252ebf361c1d8e89d28dec2748856d74baa600c9c01e9e6f1",
				claimKey:
					"claim_cb7977c672c024cf6f5ca378273cf915d3cdd01e32bb28e4b7d12aec0c3fd70f",
				fingerprint:
					"dc3938df695c83c6400085040f5e1c0dd6806d41f9ffd04a35880bd00654ddc2",
			},
			{
				name: "unicode",
				sourceContentHash:
					"a8e656d4e8091c1f3bdece4d727b7a4a7006159ef144c3d4a7ca53d07f079d45",
				sourceTextHash:
					"310847557cbb5b1fc1813220692cf5e8652d77344b478c72950bf6b6e13a8d7a",
				claimKey:
					"claim_d2d523f8a100a074abf19e2873c418e60769536a1ea32fd021cac2a33cfcbb57",
				fingerprint:
					"e5ed0bfdd1495b709fe56e5df3048b3c7eed9ef2dd88e5e07c97149db4cecd21",
			},
		]);
	});
});

describe("AFF-US-019 Phase 19C.3A subject-aware Manifest v2", () => {
	it("builds the full Organic inventory and selects Product claims purely", async () => {
		const manifest = await buildSubjectAwareClaimManifestFromScriptVersion({
			...buildInput({ snapshot: organicSnapshot() }),
			scriptVersionRevision: 7,
		});
		expect(manifest.schemaVersion).toBe("claim-manifest.v1");
		expect(manifest.builderVersion).toBe(CLAIM_MANIFEST_BUILDER_VERSION_V2);
		expect(manifest.claims).toHaveLength(2);
		expect(manifest.claims[0]).not.toHaveProperty("proposedSubject");
		expect(selectConfirmedProductManifestClaims(manifest)).toHaveLength(1);
		expect(
			(await parseClaimManifestByBuilderVersion(manifest)).builderVersion,
		).toBe(CLAIM_MANIFEST_BUILDER_VERSION_V2);
	});

	it("keeps claim identity/source hashes stable while subject changes alter authority fingerprint", async () => {
		const base = await buildSubjectAwareClaimManifestFromScriptVersion({
			...buildInput({ snapshot: organicSnapshot() }),
			scriptVersionRevision: 7,
		});
		const changedSnapshot = organicSnapshot();
		changedSnapshot.claims[0] = {
			...changedSnapshot.claims[0],
			subject: { kind: "GENERAL" },
			subjectSource: "STRUCTURED_SOURCE",
		};
		const changed = await buildSubjectAwareClaimManifestFromScriptVersion({
			...buildInput({ snapshot: changedSnapshot }),
			scriptVersionRevision: 7,
		});
		expect(changed.claims[0]?.claimKey).toBe(base.claims[0]?.claimKey);
		expect(changed.claims[0]?.sourceTextHash).toBe(
			base.claims[0]?.sourceTextHash,
		);
		expect(changed.source.sourceContentHash).toBe(
			base.source.sourceContentHash,
		);
		expect(changed.fingerprint).not.toBe(base.fingerprint);

		const proposalOnly = organicSnapshot();
		proposalOnly.claims[0] = {
			...proposalOnly.claims[0],
			proposedSubject: "GENERAL",
		};
		const proposalManifest =
			await buildSubjectAwareClaimManifestFromScriptVersion({
				...buildInput({ snapshot: proposalOnly }),
				scriptVersionRevision: 7,
			});
		expect(proposalManifest.fingerprint).toBe(base.fingerprint);
	});

	it("rejects stale, unresolved, legacy and malformed v2 inputs without v1 fallback", async () => {
		for (const mutation of [
			{ claimsStatus: "stale" },
			{ claimsSourceRevision: 6 },
			{
				claims: [
					{
						...organicSnapshot().claims[0],
						subjectStatus: "NEEDS_CONFIRMATION",
						subjectSource: null,
						proposedSubject: "PRODUCT",
					},
				],
			},
			{
				claims: [
					{
						...organicSnapshot().claims[0],
						subjectSource: "LEGACY_COMPATIBILITY",
					},
				],
			},
		] as const) {
			const value = { ...organicSnapshot(), ...mutation };
			await expect(
				buildSubjectAwareClaimManifestFromScriptVersion({
					...buildInput({ snapshot: value }),
					scriptVersionRevision: 7,
				}),
			).rejects.toMatchObject({ code: "CLAIM_MANIFEST_SOURCE_NOT_USABLE" });
		}
		const valid = await buildSubjectAwareClaimManifestFromScriptVersion({
			...buildInput({ snapshot: organicSnapshot() }),
			scriptVersionRevision: 7,
		});
		await expect(
			parseClaimManifestByBuilderVersion({
				...valid,
				builderVersion: CLAIM_MANIFEST_BUILDER_VERSION_V2,
				fingerprint: "f".repeat(64),
			}),
		).rejects.toMatchObject({ issueCodes: ["FINGERPRINT_MISMATCH"] });
		await expect(
			parseClaimManifestByBuilderVersion({
				...valid,
				builderVersion: "claim-manifest-builder.v99",
			}),
		).rejects.toMatchObject({ issueCodes: ["UNSUPPORTED_SCHEMA_VERSION"] });
	});

	it("matches the frozen v2 deterministic vector", async () => {
		const manifest = await buildSubjectAwareClaimManifestFromScriptVersion({
			...buildInput({ snapshot: organicSnapshot() }),
			scriptVersionRevision: 7,
		});
		expect({
			sourceContentHash: manifest.source.sourceContentHash,
			firstClaimKey: manifest.claims[0]?.claimKey,
			firstSourceTextHash: manifest.claims[0]?.sourceTextHash,
			fingerprint: manifest.fingerprint,
		}).toEqual({
			sourceContentHash:
				"76c8512be054dffbe658131d0bc2c488dcaff3b7d460d31bec6ff3d5f7624cff",
			firstClaimKey:
				"claim_8cdca7340791f2a3490612b98c78eec2773f9d318fec33ca0b58a04a0463ebaa",
			firstSourceTextHash:
				"5c2b64544fb655e2eaee35ba832044c29f46ee4e4ed0b623ec9442f414cf93b3",
			fingerprint:
				"6e35e6bcbf59ca8fbefb6c0bd902ec09bd6e11114f436c9ffeeca894504364a2",
		});
	});
});
