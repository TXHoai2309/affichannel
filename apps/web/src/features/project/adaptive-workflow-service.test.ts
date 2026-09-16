import type { ProjectWorkflowSubject } from "@affichannel/api/services/project-repository";
import {
	buildProjectWorkflowEntrySnapshots,
	type ProjectWorkflowEntryBatchRows,
} from "@affichannel/api/services/project-workflow-entry-service";
import {
	createProjectWorkflowRequestReader,
	gatherProjectWorkflowSnapshot,
	type ProjectWorkflowQuickImageClaimAuthority,
	type ProjectWorkflowReadDependencies,
} from "@affichannel/api/services/project-workflow-read-service";
import {
	quickImageClaimSourceContentHash,
	type ScriptVersionEditableSnapshot,
} from "@affichannel/core";
import { describe, expect, it, vi } from "vitest";

const actor = { workspaceId: "workspace-15a", userId: "user-15a" };

function subject(
	overrides: Partial<ProjectWorkflowSubject> = {},
): ProjectWorkflowSubject {
	return {
		id: "project-15a",
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
		productId: "product-15a",
		productAccessible: true,
		...overrides,
	};
}

function scriptSnapshot(claimsStatus: "current" | "stale") {
	return {
		schemaVersion: "script-draft.v2",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook-1", text: "Hook" },
			{ key: "hook-2", text: "Hook 2" },
			{ key: "hook-3", text: "Hook 3" },
		],
		selectedHookKey: "hook-1",
		voiceoverSegments: [{ key: "voice-1", text: "Voiceover" }],
		scenes: [
			{
				order: 1,
				durationSeconds: 5,
				visualDirection: "Visual",
				onScreenText: "Text",
				voiceoverSegmentKeys: ["voice-1"],
			},
		],
		cta: { text: "CTA" },
		caption: "Caption",
		hashtags: [],
		disclosure: "Disclosure",
		claims: [],
		claimsSourceRevision: 1,
		claimsStatus,
	} satisfies ScriptVersionEditableSnapshot;
}

async function quickImageSource(projectId: string, text: string) {
	const document = {
		version: "quick-image-claim-source.v1" as const,
		elements: [{ id: "element-1", kind: "DECLARED_CLAIM" as const, text }],
	};
	return {
		id: "source-15a",
		workspaceId: actor.workspaceId,
		projectId,
		revision: 1,
		sourceSchemaVersion: document.version,
		document,
		sourceContentHashSha256: await quickImageClaimSourceContentHash(document),
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	};
}

function quickImageAuthority(
	source: Awaited<ReturnType<typeof quickImageSource>>,
	productClaimState: "NONE" | "PRESENT",
): ProjectWorkflowQuickImageClaimAuthority {
	const claimCount = productClaimState === "PRESENT" ? 1 : 0;
	return {
		projectId: source.projectId,
		source,
		invalid: false,
		summary: {
			status: "CURRENT",
			subjectResolution: "CONFIRMED",
			productClaimState,
			productClaimCount: claimCount,
			generalClaimCount: 0,
		},
	};
}

function zeroClaimManifest(
	projectId: string,
	sourceRevision: string,
	sourceHash: string,
) {
	const fingerprint = "b".repeat(64);
	return {
		id: "manifest-15a",
		workspaceId: actor.workspaceId,
		projectId,
		productId: "product-15a",
		schemaVersion: "claim-manifest.v1",
		builderVersion: "claim-manifest-builder.v1",
		source: {
			sourceType: "NO_SCRIPT" as const,
			sourceSchemaVersion: "quick-image-claim-source.v1",
			sourceRevision,
			elements: [],
			sourceContentHash: sourceHash,
		},
		claims: [],
		claimCount: 0,
		isEmpty: true,
		fingerprint,
		createdByUserId: actor.userId,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
	};
}

function zeroClaimFactLockRun(
	projectId: string,
	manifest: ReturnType<typeof zeroClaimManifest>,
	status: "passed" | "failed",
) {
	const now = new Date("2026-01-01T00:00:00.000Z");
	return {
		id: `run-${status}`,
		workspaceId: actor.workspaceId,
		projectId,
		scriptVersionId: null,
		sourceScriptRevision: null,
		inputMode: "MANIFEST_V1",
		claimManifestId: manifest.id,
		claimManifestFingerprint: manifest.fingerprint,
		idempotencyKey: `idempotency-${status}`,
		requestHash: "c".repeat(64),
		inputSnapshotJson: {
			inputMode: "MANIFEST_V1",
			inputVersion: "fact-lock.manifest.v1",
			claimManifest: { id: manifest.id, fingerprint: manifest.fingerprint },
			source: manifest.source,
			productFacts: [],
			policy: null,
			outputRules: null,
			zeroClaim: {
				status: "passed",
				providerRequired: false,
				dependenciesRequired: false,
			},
		},
		inputHash: "d".repeat(64),
		promptHash: "e".repeat(64),
		provider: "internal",
		model: "deterministic-zero-claim",
		promptVersion: "fact-lock-zero-claim.v1",
		outputSchemaVersion: "fact-lock-output.v1",
		status,
		providerRequestId: null,
		inputTokens: null,
		outputTokens: null,
		estimatedCostMicros: null,
		actualCostMicros: null,
		currency: null,
		errorCode: status === "failed" ? "FAILED" : null,
		errorMessage: null,
		executionClaimedAt: null,
		createdByUserId: actor.userId,
		createdAt: now,
		finishedAt: now,
	};
}

function readDependencies(
	overrides: Partial<ProjectWorkflowReadDependencies> = {},
): ProjectWorkflowReadDependencies {
	return {
		findSubject: vi.fn(async () => subject()),
		readScript: vi.fn(
			async () =>
				({
					latestRequest: null,
					latestUsableArtifact: null,
					dependencyState: null,
					context: {
						channelSettings: {},
						facts: [{ generationUsability: "allowed" }],
					},
				}) as never,
		),
		readCurrentScriptVersion: vi.fn(async () => undefined),
		evaluateFactLock: vi.fn(
			async () => ({ allowed: false, reason: "NO_SCRIPT_VERSION" }) as never,
		),
		readQuickImageClaimSource: vi.fn(async () => null),
		readVoice: vi.fn(
			async () =>
				({
					segments: [],
					summary: {
						factLockPassed: false,
						voiceConfigPresent: false,
						currentScriptVersionPresent: false,
						totalSegments: 0,
						completedSegments: 0,
						pendingSegments: 0,
						staleSegments: 0,
						ready: false,
					},
				}) as never,
		),
		...overrides,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

describe("AFF-US-015 request-owned workflow aggregation", () => {
	it("reads Quick Image applicability without Script, Fact Lock, or Voice state", async () => {
		const dependencies = readDependencies();
		const result = await gatherProjectWorkflowSnapshot(
			actor,
			subject({
				contentType: "ORGANIC",
				creationPath: "QUICK_IMAGE",
				contentFormatKey: "QUICK_IMAGE_STANDARD",
				productId: null,
				productAccessible: false,
			}),
			dependencies,
		);

		expect(dependencies.readScript).not.toHaveBeenCalled();
		expect(dependencies.readCurrentScriptVersion).not.toHaveBeenCalled();
		expect(dependencies.evaluateFactLock).not.toHaveBeenCalled();
		expect(dependencies.readQuickImageClaimSource).not.toHaveBeenCalled();
		expect(dependencies.readVoice).not.toHaveBeenCalled();
		expect(result.applicabilityResult.capabilities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capability: "SCRIPT",
					state: "NOT_REQUIRED",
				}),
				expect.objectContaining({
					capability: "VOICE",
					state: "NOT_REQUIRED",
				}),
				expect.objectContaining({
					capability: "RENDER",
					state: "REQUIRED",
				}),
			]),
		);
	});

	it("preserves Affiliate Product and Fact Lock policy at the read boundary", async () => {
		const source = await quickImageSource("project-15a", "Product claim");
		const dependencies = readDependencies({
			readQuickImageClaimSource: vi.fn(async () => source),
			evaluateFactLock: vi.fn(
				async () => ({ allowed: false, reason: "FACT_LOCK_NOT_RUN" }) as never,
			),
		});
		const result = await gatherProjectWorkflowSnapshot(
			actor,
			subject({
				creationPath: "QUICK_IMAGE",
				contentFormatKey: "QUICK_IMAGE_STANDARD",
				productId: "product-15a",
				productAccessible: true,
			}),
			dependencies,
		);
		const capability = (name: "PRODUCT" | "FACT_LOCK" | "SCRIPT" | "VOICE") =>
			result.applicabilityResult.capabilities.find(
				(item) => item.capability === name,
			);

		expect(capability("PRODUCT")).toMatchObject({
			state: "READY",
			reasonCode: "PRODUCT_READY",
		});
		expect(capability("FACT_LOCK")).toMatchObject({
			state: "REQUIRED",
			reasonCode: "FACT_LOCK_RUN_REQUIRED",
		});
		expect(capability("SCRIPT")).toMatchObject({
			state: "NOT_REQUIRED",
		});
		expect(capability("VOICE")).toMatchObject({
			state: "NOT_REQUIRED",
		});
	});

	it("reads Quick Image Fact Lock only for claim-bearing Organic Product", async () => {
		const source = await quickImageSource("project-15a", "Product claim");
		const dependencies = readDependencies({
			readQuickImageClaimSource: vi.fn(async () => source),
			evaluateFactLock: vi.fn(
				async () => ({ allowed: true, reason: "FACT_LOCK_PASSED" }) as never,
			),
		});
		const result = await gatherProjectWorkflowSnapshot(
			actor,
			subject({
				contentType: "ORGANIC",
				creationPath: "QUICK_IMAGE",
				contentFormatKey: "QUICK_IMAGE_STANDARD",
				productId: "product-15a",
				productAccessible: true,
			}),
			dependencies,
		);

		expect(dependencies.readScript).not.toHaveBeenCalled();
		expect(dependencies.readCurrentScriptVersion).not.toHaveBeenCalled();
		expect(dependencies.readVoice).not.toHaveBeenCalled();
		expect(dependencies.evaluateFactLock).toHaveBeenCalledOnce();
		expect(
			result.applicabilityResult.capabilities.find(
				(item) => item.capability === "FACT_LOCK",
			),
		).toMatchObject({ state: "READY", completion: "COMPLETE" });
	});

	it("keeps Organic claim-free Quick Image out of Fact Lock lifecycle reads", async () => {
		const source = await quickImageSource("project-15a", "   ");
		const dependencies = readDependencies({
			readQuickImageClaimSource: vi.fn(async () => source),
		});
		const result = await gatherProjectWorkflowSnapshot(
			actor,
			subject({
				contentType: "ORGANIC",
				creationPath: "QUICK_IMAGE",
				contentFormatKey: "QUICK_IMAGE_STANDARD",
				productId: "product-15a",
				productAccessible: true,
			}),
			dependencies,
		);

		expect(dependencies.evaluateFactLock).not.toHaveBeenCalled();
		expect(
			result.applicabilityResult.capabilities.find(
				(item) => item.capability === "FACT_LOCK",
			),
		).toMatchObject({ state: "NOT_REQUIRED" });
	});

	it("fails closed when a Product Quick Image claim source is missing", async () => {
		const result = await gatherProjectWorkflowSnapshot(
			actor,
			subject({
				contentType: "ORGANIC",
				creationPath: "QUICK_IMAGE",
				contentFormatKey: "QUICK_IMAGE_STANDARD",
				productId: "product-15a",
				productAccessible: true,
			}),
			readDependencies(),
		);

		expect(
			result.applicabilityResult.capabilities.find(
				(item) => item.capability === "PRODUCT",
			),
		).toMatchObject({ state: "BLOCKED", reasonCode: "CLAIM_SUBJECT_INVALID" });
		expect(
			result.applicabilityResult.capabilities.find(
				(item) => item.capability === "FACT_LOCK",
			),
		).toMatchObject({ state: "BLOCKED" });
	});

	it("keeps singleton and batch Quick Image no-run applicability in parity", async () => {
		const source = await quickImageSource("project-15a", "Product claim");
		const authority = quickImageAuthority(source, "PRESENT");
		const dependencies = readDependencies({
			readQuickImageClaimSource: vi.fn(async () => source),
			evaluateFactLock: vi.fn(
				async () => ({ allowed: false, reason: "FACT_LOCK_NOT_RUN" }) as never,
			),
		});
		const subjectValue = subject({
			creationPath: "QUICK_IMAGE",
			contentFormatKey: "QUICK_IMAGE_STANDARD",
		});
		const singleton = await gatherProjectWorkflowSnapshot(
			actor,
			subjectValue,
			dependencies,
		);
		const [batch] = buildProjectWorkflowEntrySnapshots(actor, {
			subjects: [subjectValue],
			scriptGenerations: [],
			scriptVersions: [],
			factLockRuns: [],
			claimManifests: [],
			dependencies: [],
			productFacts: [],
			channelSettings: null,
			voiceConfigs: [],
			voiceArtifacts: [],
			quickImageClaimAuthorities: [authority],
		});

		expect(batch?.applicabilityResult).toEqual(singleton.applicabilityResult);
		expect(batch?.applicabilityInput.script.currentVersionPresent).toBe(false);
		expect(batch?.applicabilityResult.capabilities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capability: "FACT_LOCK",
					state: "REQUIRED",
				}),
			]),
		);
	});

	it("maps batch Quick Image Fact Lock READY and STALE from NO_SCRIPT provenance", async () => {
		const source = await quickImageSource("project-15a", "");
		const authority = quickImageAuthority(source, "NONE");
		const manifest = zeroClaimManifest(
			"project-15a",
			String(source.revision),
			source.sourceContentHashSha256,
		);
		const readyRows: ProjectWorkflowEntryBatchRows = {
			subjects: [
				subject({
					creationPath: "QUICK_IMAGE",
					contentFormatKey: "QUICK_IMAGE_STANDARD",
				}),
			],
			scriptGenerations: [],
			scriptVersions: [],
			factLockRuns: [
				zeroClaimFactLockRun("project-15a", manifest, "passed") as never,
			],
			claimManifests: [manifest as never],
			dependencies: [],
			productFacts: [],
			channelSettings: null,
			voiceConfigs: [],
			voiceArtifacts: [],
			quickImageClaimAuthorities: [authority],
		};
		const [ready] = buildProjectWorkflowEntrySnapshots(actor, readyRows);
		expect(ready?.applicabilityResult.capabilities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capability: "FACT_LOCK",
					state: "READY",
					completion: "COMPLETE",
				}),
			]),
		);

		const staleAuthority: ProjectWorkflowQuickImageClaimAuthority = {
			...quickImageAuthority(source, "NONE"),
			source: { ...source, revision: 2 },
		};
		const [stale] = buildProjectWorkflowEntrySnapshots(actor, {
			...readyRows,
			quickImageClaimAuthorities: [staleAuthority],
		});
		expect(stale?.applicabilityResult.capabilities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capability: "FACT_LOCK",
					state: "STALE",
				}),
			]),
		);
	});

	it("keeps Quick Image applicability consistent in the batch read model", () => {
		const [result] = buildProjectWorkflowEntrySnapshots(
			actor,
			{
				subjects: [
					subject({
						contentType: "ORGANIC",
						creationPath: "QUICK_IMAGE",
						contentFormatKey: "QUICK_IMAGE_STANDARD",
						productId: null,
						productAccessible: false,
					}),
				],
				scriptGenerations: [],
				scriptVersions: [],
				factLockRuns: [],
				claimManifests: [],
				dependencies: [],
				productFacts: [],
				channelSettings: null,
				voiceConfigs: [],
				voiceArtifacts: [],
			},
			{ now: new Date("2026-01-01T00:00:00.000Z"), pendingLeaseMs: 60_000 },
		);

		expect(result?.applicabilityResult.capabilities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capability: "SCRIPT",
					state: "NOT_REQUIRED",
				}),
				expect.objectContaining({ capability: "VOICE", state: "NOT_REQUIRED" }),
				expect.objectContaining({
					capability: "RENDER",
					state: "REQUIRED",
				}),
			]),
		);
	});

	it("starts independent Script, ScriptVersion, and Fact Lock reads in parallel", async () => {
		const script = deferred<never>();
		const version = deferred<undefined>();
		const factLock = deferred<never>();
		const dependencies = readDependencies({
			readScript: vi.fn(() => script.promise),
			readCurrentScriptVersion: vi.fn(() => version.promise),
			evaluateFactLock: vi.fn(() => factLock.promise),
		});

		const pending = gatherProjectWorkflowSnapshot(
			actor,
			subject(),
			dependencies,
		);
		await Promise.resolve();
		expect(dependencies.readScript).toHaveBeenCalledOnce();
		expect(dependencies.readCurrentScriptVersion).toHaveBeenCalledOnce();
		expect(dependencies.evaluateFactLock).toHaveBeenCalledOnce();
		expect(dependencies.readVoice).not.toHaveBeenCalled();

		script.resolve({
			latestRequest: null,
			latestUsableArtifact: null,
			dependencyState: null,
			context: {
				channelSettings: {},
				facts: [{ generationUsability: "allowed" }],
			},
		} as never);
		version.resolve(undefined);
		factLock.resolve({ allowed: false, reason: "NO_SCRIPT_VERSION" } as never);

		const snapshot = await pending;
		expect(dependencies.readVoice).toHaveBeenCalledOnce();
		expect(snapshot.adaptiveWorkflow.nextRouteKey).toBe("content");
	});

	it("deduplicates a workspace/user/project key within one request reader", async () => {
		const dependencies = readDependencies();
		const reader = createProjectWorkflowRequestReader(dependencies);
		const [first, second] = await Promise.all([
			reader.get(actor, "project-15a"),
			reader.get(actor, "project-15a"),
		]);

		expect(first).toBe(second);
		expect(dependencies.findSubject).toHaveBeenCalledOnce();
		expect(dependencies.readScript).toHaveBeenCalledOnce();
		expect(dependencies.readCurrentScriptVersion).toHaveBeenCalledOnce();
		expect(dependencies.evaluateFactLock).toHaveBeenCalledOnce();
		expect(dependencies.readVoice).toHaveBeenCalledOnce();
		expect(dependencies.findSubject).toHaveBeenCalledWith(
			"workspace-15a",
			"project-15a",
		);
	});

	it("does not share request cache across actor identities", async () => {
		const dependencies = readDependencies();
		const reader = createProjectWorkflowRequestReader(dependencies);
		await reader.get(actor, "project-15a");
		await reader.get(
			{ workspaceId: "workspace-15a", userId: "other-user" },
			"project-15a",
		);
		expect(dependencies.findSubject).toHaveBeenCalledTimes(2);
	});

	it("fails unsupported/missing Product closed without downstream reads", async () => {
		const dependencies = readDependencies({
			findSubject: vi.fn(async () =>
				subject({ productId: null, productAccessible: false }),
			),
		});
		const result = await createProjectWorkflowRequestReader(dependencies).get(
			actor,
			"project-15a",
		);

		expect(result?.adaptiveWorkflow.unsupportedState).toEqual({
			isUnsupported: true,
			reasonCode: "AFFILIATE_PRODUCT_MISSING",
		});
		expect(dependencies.readScript).not.toHaveBeenCalled();
		expect(dependencies.readCurrentScriptVersion).not.toHaveBeenCalled();
		expect(dependencies.evaluateFactLock).not.toHaveBeenCalled();
		expect(dependencies.readVoice).not.toHaveBeenCalled();
	});

	it.each(["stale", "current"] as const)(
		"uses claims-%s as the strict current Script readiness state",
		async (claimsStatus) => {
			const dependencies = readDependencies({
				readCurrentScriptVersion: vi.fn(
					async () =>
						({
							editableSnapshot: scriptSnapshot(claimsStatus),
						}) as never,
				),
			});
			const result = await gatherProjectWorkflowSnapshot(
				actor,
				subject(),
				dependencies,
			);

			expect(result.applicabilityInput.script.currentVersionFactLockReady).toBe(
				claimsStatus === "current",
			);
		},
	);

	it("applies strict claims-current readiness to the batched entry path", () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		const row = {
			id: "draft-1",
			workspaceId: actor.workspaceId,
			projectId: subject().id,
			sourceGenerationId: "generation-1",
			status: "draft",
			versionNumber: null,
			editableSnapshotJson: scriptSnapshot("stale"),
			revision: 1,
			restoredFromVersionId: null,
			createdByUserId: actor.userId,
			createdAt: now,
			updatedAt: now,
			savedAt: null,
		} as never;
		const rows: ProjectWorkflowEntryBatchRows = {
			subjects: [subject()],
			scriptGenerations: [],
			scriptVersions: [row],
			factLockRuns: [],
			claimManifests: [],
			dependencies: [],
			productFacts: [],
			channelSettings: null,
			voiceConfigs: [],
			voiceArtifacts: [],
		};

		const [result] = buildProjectWorkflowEntrySnapshots(actor, rows, {
			now,
			pendingLeaseMs: 60_000,
		});
		expect(result?.applicabilityInput.script.currentVersionFactLockReady).toBe(
			false,
		);
	});
});
