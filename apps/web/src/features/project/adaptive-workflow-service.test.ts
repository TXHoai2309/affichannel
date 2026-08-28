import type { ProjectWorkflowSubject } from "@affichannel/api/services/project-repository";
import {
	buildProjectWorkflowEntrySnapshots,
	type ProjectWorkflowEntryBatchRows,
} from "@affichannel/api/services/project-workflow-entry-service";
import {
	createProjectWorkflowRequestReader,
	gatherProjectWorkflowSnapshot,
	type ProjectWorkflowReadDependencies,
} from "@affichannel/api/services/project-workflow-read-service";
import type { ScriptVersionEditableSnapshot } from "@affichannel/core";
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
