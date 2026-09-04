import {
	compareApplicabilityResults,
	normalizeLegacyApplicability,
} from "@affichannel/api/services/applicability-shadow-service";
import type { ProjectWorkflowSubject } from "@affichannel/api/services/project-repository";
import {
	buildProjectWorkflowEntrySnapshots,
	type ProjectWorkflowEntryBatchRows,
} from "@affichannel/api/services/project-workflow-entry-service";
import {
	gatherProjectApplicabilityInput,
	type ProjectWorkflowReadDependencies,
} from "@affichannel/api/services/project-workflow-read-service";
import {
	type ClaimInventorySummary,
	type ProjectApplicabilityInput,
	resolveProjectApplicability,
	summarizeClaimInventory,
} from "@affichannel/core";
import { describe, expect, it, vi } from "vitest";

function summary(
	patch: Partial<ClaimInventorySummary> = {},
): ClaimInventorySummary {
	return {
		status: "CURRENT",
		subjectResolution: "CONFIRMED",
		productClaimState: "NONE",
		productClaimCount: 0,
		generalClaimCount: 0,
		...patch,
	};
}

function organicInput(
	hasProduct = false,
	claimSummary = summary(),
): ProjectApplicabilityInput {
	return {
		projectIdentity: {
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
			hasProduct,
		},
		product: { accessible: hasProduct },
		script: {
			generationStatus: "USABLE",
			usableGenerationPresent: true,
			sourceDependencyCurrent: true,
			currentVersionPresent: true,
			currentVersionFactLockReady: false,
			channelSettingsComplete: true,
			productFactsUsable: false,
			claimSummary,
		},
		claimSummary,
		factLock: { gateReason: "FACT_LOCK_NOT_RUN" },
		voice: {
			configPresent: false,
			previewPresent: false,
			totalSegments: 0,
			attemptedSegments: 0,
			usableSegments: 0,
			pendingSegments: 0,
			failedSegments: 0,
			indeterminateSegments: 0,
			staleSegments: 0,
		},
		render: { featureImplemented: false, inputsStale: false },
	};
}

function capability(
	input: ProjectApplicabilityInput,
	name: "PRODUCT" | "FACT_LOCK" | "SCRIPT",
) {
	const found = resolveProjectApplicability(input).capabilities.find(
		(item) => item.capability === name,
	);
	if (!found) throw new Error(`Missing ${name}`);
	return found;
}

function organicSnapshot(claims: unknown[], claimsStatus: "current" | "stale") {
	return {
		schemaVersion: "script-draft.v3",
		language: "vi-VN",
		hookVariants: [{ key: "hook-1", text: "Hook" }],
		selectedHookKey: "hook-1",
		voiceoverSegments: [{ key: "voice-1", text: "Voice" }],
		scenes: [
			{
				order: 1,
				durationSeconds: 5,
				visualDirection: "Visual",
				onScreenText: null,
				voiceoverSegmentKeys: ["voice-1"],
			},
		],
		cta: { text: "CTA" },
		caption: "Caption",
		hashtags: [],
		disclosure: "Disclosure",
		claims,
		claimsSourceRevision: 1,
		claimsStatus,
	};
}

function readSubject(overrides: Partial<ProjectWorkflowSubject> = {}) {
	return {
		id: "organic-read",
		contentType: "ORGANIC",
		creationPath: "SCRIPTED",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
		productId: null,
		productAccessible: false,
		...overrides,
	};
}

function readDeps(snapshot: unknown): ProjectWorkflowReadDependencies {
	return {
		findSubject: vi.fn(async () => readSubject()),
		readScript: vi.fn(
			async () =>
				({
					latestRequest: null,
					latestUsableArtifact: null,
					dependencyState: null,
					context: { channelSettings: {}, facts: [] },
				}) as never,
		),
		readCurrentScriptVersion: vi.fn(
			async () => ({ editableSnapshot: snapshot }) as never,
		),
		evaluateFactLock: vi.fn(
			async () => ({ allowed: false, reason: "NO_SCRIPT_VERSION" }) as never,
		),
		readVoice: vi.fn(
			async () =>
				({
					segments: [],
					summary: {
						voiceConfigPresent: false,
						totalSegments: 0,
						completedSegments: 0,
						pendingSegments: 0,
						staleSegments: 0,
					},
				}) as never,
		),
	};
}

describe("AFF-US-019 Organic claim applicability", () => {
	it("keeps Product and Fact Lock out of the initial Organic creation route", () => {
		const input = organicInput(false, {
			status: "UNKNOWN",
			subjectResolution: "UNKNOWN",
			productClaimState: "UNKNOWN",
			productClaimCount: null,
			generalClaimCount: null,
		});
		input.script.currentVersionPresent = false;
		input.script.generationStatus = "NONE";
		input.script.usableGenerationPresent = false;
		expect(capability(input, "PRODUCT").state).toBe("NOT_REQUIRED");
		expect(capability(input, "FACT_LOCK").state).toBe("NOT_REQUIRED");
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe(
			"SCRIPT",
		);
	});

	it("derives the canonical zero-claim summary and skips Product/Fact Lock", () => {
		const input = organicInput();
		expect(input.claimSummary).toEqual(summary());
		expect(capability(input, "PRODUCT")).toMatchObject({
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
		});
		expect(capability(input, "FACT_LOCK")).toMatchObject({
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
		});
		expect(capability(input, "SCRIPT")).toMatchObject({
			state: "READY",
			completion: "COMPLETE",
			reasonCode: "SCRIPT_READY",
		});
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe("VOICE");
	});

	it("does not activate Product Fact Lock for confirmed GENERAL claims", () => {
		const input = organicInput(false, summary({ generalClaimCount: 2 }));
		expect(capability(input, "PRODUCT").state).toBe("NOT_REQUIRED");
		expect(capability(input, "FACT_LOCK").state).toBe("NOT_REQUIRED");
	});

	it("requires Product and blocks Fact Lock for an unbound Product claim", () => {
		const input = organicInput(
			false,
			summary({
				productClaimState: "PRESENT",
				productClaimCount: 1,
			}),
		);
		expect(capability(input, "PRODUCT")).toMatchObject({
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "PRODUCT_REQUIRED_FOR_PRODUCT_CLAIMS",
		});
		expect(capability(input, "FACT_LOCK")).toMatchObject({
			state: "BLOCKED",
			completion: "NOT_STARTED",
			reasonCode: "PRODUCT_REQUIRED_FOR_PRODUCT_CLAIMS",
		});
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe(
			"PRODUCT",
		);
	});

	it("requires Fact Lock when a confirmed Product claim has a linked Product", () => {
		const input = organicInput(
			true,
			summary({
				productClaimState: "PRESENT",
				productClaimCount: 1,
			}),
		);
		expect(capability(input, "PRODUCT")).toMatchObject({
			state: "READY",
			completion: "COMPLETE",
		});
		expect(capability(input, "FACT_LOCK")).toMatchObject({
			state: "READY",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_RUN_REQUIRED",
		});
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe(
			"FACT_LOCK",
		);
	});

	it.each([
		["NEEDS_CONFIRMATION", "CLAIM_SUBJECT_CONFIRMATION_REQUIRED"],
		["STALE", "SCRIPT_CLAIMS_NOT_CURRENT"],
		["UNKNOWN", "CLAIM_SUBJECT_INVALID"],
	] as const)("fails closed for %s claim state", (status, reasonCode) => {
		const input = organicInput(
			false,
			summary({
				status: status === "NEEDS_CONFIRMATION" ? "CURRENT" : status,
				subjectResolution: status === "NEEDS_CONFIRMATION" ? status : "UNKNOWN",
				productClaimState: "UNKNOWN",
				productClaimCount: null,
				generalClaimCount: null,
			}),
		);
		expect(capability(input, "PRODUCT").reasonCode).toBe(reasonCode);
		expect(capability(input, "FACT_LOCK").reasonCode).toBe(reasonCode);
		expect(capability(input, "FACT_LOCK").state).not.toBe("NOT_REQUIRED");
	});

	it("does not let a linked Product alone activate Fact Lock", () => {
		const input = organicInput(true);
		input.factLock.gateReason = "FACT_LOCK_PASSED";
		expect(capability(input, "PRODUCT").state).toBe("NOT_REQUIRED");
		expect(capability(input, "FACT_LOCK")).toMatchObject({
			state: "NOT_REQUIRED",
			reasonCode: "FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
		});
	});

	it("keeps historical Fact Lock results from overriding current claim state", () => {
		const input = organicInput(true);
		input.factLock.gateReason = "FACT_LOCK_PASSED";
		expect(capability(input, "FACT_LOCK").state).toBe("NOT_REQUIRED");
	});

	it("observes Organic vectors through the shadow comparison without divergence", () => {
		for (const input of [
			organicInput(),
			organicInput(
				false,
				summary({ productClaimState: "PRESENT", productClaimCount: 1 }),
			),
			organicInput(
				true,
				summary({ productClaimState: "PRESENT", productClaimCount: 1 }),
			),
			organicInput(
				false,
				summary({
					status: "STALE",
					productClaimState: "UNKNOWN",
					productClaimCount: null,
					generalClaimCount: null,
				}),
			),
		]) {
			const canonical = resolveProjectApplicability(input);
			const shadow = normalizeLegacyApplicability(input);
			expect(compareApplicabilityResults(shadow, canonical)).toEqual([]);
		}
	});
});

describe("AFF-US-019 claim summary validation", () => {
	it("adapts legacy claims only for Affiliate Scripted", () => {
		const affiliate = summarizeClaimInventory({
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			claimsStatus: "current",
			claims: [{ text: "claim", occurrence: { section: "caption" } }],
		});
		expect(affiliate).toMatchObject({
			status: "CURRENT",
			subjectResolution: "CONFIRMED",
			productClaimState: "PRESENT",
		});

		const organic = summarizeClaimInventory({
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			claimsStatus: "current",
			claims: [{ text: "claim", occurrence: { section: "caption" } }],
		});
		expect(organic.status).toBe("UNKNOWN");
	});

	it("does not downgrade malformed subject-aware claims to legacy", () => {
		const summary = summarizeClaimInventory({
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			claimsStatus: "current",
			claims: [
				{
					text: "claim",
					occurrence: { section: "caption" },
					subject: { kind: "PRODUCT", binding: "INVALID" },
				},
			],
		});
		expect(summary).toMatchObject({
			status: "UNKNOWN",
			productClaimState: "UNKNOWN",
		});
	});

	it("derives 19B Organic v3 claims from the current ScriptVersion read", async () => {
		const needsConfirmation = {
			text: "A proposal",
			occurrence: { section: "caption" },
			proposedSubject: "GENERAL",
			subject: { kind: "GENERAL" },
			subjectStatus: "NEEDS_CONFIRMATION",
			subjectSource: null,
		};
		const input = await gatherProjectApplicabilityInput(
			{ workspaceId: "w", userId: "u" },
			readSubject(),
			readDeps(organicSnapshot([needsConfirmation], "current")),
		);
		expect(input.claimSummary?.subjectResolution).toBe("NEEDS_CONFIRMATION");
		expect(input.claimSummary?.productClaimState).toBe("UNKNOWN");
		expect(resolveProjectApplicability(input).capabilities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capability: "FACT_LOCK",
					reasonCode: "CLAIM_SUBJECT_CONFIRMATION_REQUIRED",
				}),
			]),
		);
	});

	it("derives 19B Organic zero-claim read state without Product reads", async () => {
		const input = await gatherProjectApplicabilityInput(
			{ workspaceId: "w", userId: "u" },
			readSubject(),
			readDeps(organicSnapshot([], "current")),
		);
		const result = resolveProjectApplicability(input);
		expect(input.claimSummary).toMatchObject({
			status: "CURRENT",
			subjectResolution: "CONFIRMED",
			productClaimState: "NONE",
		});
		expect(result.capabilities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capability: "PRODUCT",
					state: "NOT_REQUIRED",
				}),
				expect.objectContaining({
					capability: "FACT_LOCK",
					state: "NOT_REQUIRED",
				}),
			]),
		);
	});

	it("keeps single-read and batch entry policy on the same current ScriptVersion", () => {
		const snapshot = organicSnapshot([], "current");
		const rows: ProjectWorkflowEntryBatchRows = {
			subjects: [readSubject()],
			scriptGenerations: [],
			scriptVersions: [
				{
					id: "version-1",
					workspaceId: "w",
					projectId: "organic-read",
					sourceGenerationId: "generation-1",
					status: "draft",
					versionNumber: 1,
					editableSnapshotJson: snapshot,
					revision: 1,
					restoredFromVersionId: null,
					createdByUserId: "u",
					createdAt: new Date(0),
					updatedAt: new Date(0),
					savedAt: null,
				} as never,
			],
			factLockRuns: [],
			claimManifests: [],
			dependencies: [],
			productFacts: [],
			channelSettings: {
				id: "settings",
				workspaceId: "w",
				niche: "Niche",
				targetAudience: "Audience",
				tone: "Tone",
				contentPillar: "Pillar",
				defaultCta: "CTA",
				affiliateDisclosure: "Disclosure",
				avoidWords: [],
				createdByUserId: "u",
				updatedByUserId: "u",
				createdAt: new Date(0),
				updatedAt: new Date(0),
			} as never,
			voiceConfigs: [],
			voiceArtifacts: [],
		};
		const [entry] = buildProjectWorkflowEntrySnapshots(
			{ workspaceId: "w", userId: "u" },
			rows,
		);
		expect(entry.applicabilityInput.claimSummary).toMatchObject({
			status: "CURRENT",
			productClaimState: "NONE",
		});
		expect(
			entry.applicabilityResult.capabilities.find(
				(item) => item.capability === "FACT_LOCK",
			)?.state,
		).toBe("NOT_REQUIRED");
	});
});
