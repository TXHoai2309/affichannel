import {
	compareApplicabilityResults,
	normalizeLegacyApplicability,
	observeProjectApplicabilityShadow,
	observeProjectApplicabilityShadowFromSnapshot,
} from "@affichannel/api/services/applicability-shadow-service";
import type { ProjectDetails } from "@affichannel/api/services/project-repository";
import type { ProjectWorkflowSnapshot } from "@affichannel/api/services/project-workflow-read-service";
import type {
	ApplicabilityCapabilityResult,
	ProjectApplicabilityInput,
	ProjectApplicabilityResult,
} from "@affichannel/core";
import { resolveProjectApplicability } from "@affichannel/core";
import { describe, expect, it, vi } from "vitest";

function input(): ProjectApplicabilityInput {
	return {
		projectIdentity: {
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
			hasProduct: true,
		},
		product: { accessible: true },
		script: {
			generationStatus: "NONE",
			usableGenerationPresent: false,
			sourceDependencyCurrent: true,
			currentVersionPresent: false,
			currentVersionFactLockReady: false,
			channelSettingsComplete: true,
			productFactsUsable: true,
		},
		factLock: { gateReason: "NO_SCRIPT_VERSION" },
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

function project(): ProjectDetails {
	return {
		id: "project-shadow",
		name: "Shadow fixture",
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
		contentFormat: {
			ref: { key: "SCRIPTED_STANDARD", version: 1 },
			resolution: "resolved",
			definition: {
				ref: { key: "SCRIPTED_STANDARD", version: 1 },
				label: "Scripted Standard",
				supportedCreationPaths: ["SCRIPTED"],
				availability: "active",
			},
		},
		isLegacyProjection: false,
		product: { id: "product-shadow", name: "Fixture" },
		currentStepKey: "product",
		brief: {
			platform: "tiktok",
			goal: "Fixture",
			durationSeconds: 30,
			angle: "Fixture",
			description: null,
		},
		stepStatuses: [],
		archivedAt: null,
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	};
}

function cloneResult(result: ProjectApplicabilityResult) {
	return structuredClone(result);
}

function mutableCapability(
	result: ProjectApplicabilityResult,
	index = 0,
): ApplicabilityCapabilityResult {
	return result.capabilities[index] as ApplicabilityCapabilityResult;
}

function snapshot(): ProjectWorkflowSnapshot {
	const applicabilityInput = input();
	return {
		projectId: "project-shadow",
		applicabilityInput,
		applicabilityResult: resolveProjectApplicability(applicabilityInput),
		adaptiveWorkflow: {} as ProjectWorkflowSnapshot["adaptiveWorkflow"],
	};
}

describe("AFF-US-014 legacy oracle and comparison", () => {
	it("has zero mismatches across canonical matrix A-J inputs", () => {
		const cases = Array.from({ length: 10 }, () => input());
		Object.assign(cases[1].script, {
			generationStatus: "USABLE",
			usableGenerationPresent: true,
		});
		for (const value of cases.slice(2)) {
			Object.assign(value.script, {
				generationStatus: "USABLE",
				usableGenerationPresent: true,
				currentVersionPresent: true,
				currentVersionFactLockReady: true,
			});
		}
		cases[2].factLock.gateReason = "FACT_LOCK_NOT_RUN";
		cases[3].factLock.gateReason = "FACT_LOCK_REVIEW_REQUIRED";
		for (const value of cases.slice(4, 8)) {
			value.factLock.gateReason = "FACT_LOCK_PASSED";
		}
		Object.assign(cases[5].voice, { configPresent: true, totalSegments: 2 });
		Object.assign(cases[6].voice, {
			configPresent: true,
			totalSegments: 2,
			attemptedSegments: 1,
			usableSegments: 1,
		});
		Object.assign(cases[7].voice, {
			configPresent: true,
			totalSegments: 2,
			attemptedSegments: 2,
			usableSegments: 2,
		});
		cases[8].factLock.gateReason = "FACT_LOCK_STALE_SCRIPT";
		Object.assign(cases[8].voice, {
			attemptedSegments: 1,
			staleSegments: 1,
		});
		cases[9].factLock.gateReason = "FACT_LOCK_STALE_FACTS";
		cases[9].script.sourceDependencyCurrent = false;
		Object.assign(cases[9].voice, {
			configPresent: true,
			totalSegments: 2,
			attemptedSegments: 2,
			usableSegments: 2,
		});

		for (const value of cases) {
			const resolver = resolveProjectApplicability(value);
			expect(
				compareApplicabilityResults(
					normalizeLegacyApplicability(value),
					resolver,
				),
			).toEqual([]);
		}
	});

	it("keeps shadow parity when current Script claims are stale", () => {
		const value = input();
		Object.assign(value.script, {
			generationStatus: "USABLE",
			usableGenerationPresent: true,
			currentVersionPresent: true,
			currentVersionFactLockReady: false,
		});
		value.factLock.gateReason = "FACT_LOCK_NOT_RUN";

		const resolver = resolveProjectApplicability(value);
		const factLock = resolver.capabilities.find(
			(item) => item.capability === "FACT_LOCK",
		);
		expect(factLock).toMatchObject({
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_SCRIPT_NOT_READY",
		});
		expect(
			compareApplicabilityResults(
				normalizeLegacyApplicability(value),
				resolver,
			),
		).toEqual([]);
	});

	it("classifies every canonical mismatch category", () => {
		const resolver = resolveProjectApplicability(input());
		const state = cloneResult(resolver);
		mutableCapability(state).state = "BLOCKED";
		expect(compareApplicabilityResults(state, resolver)).toContainEqual(
			expect.objectContaining({ type: "STATE_MISMATCH" }),
		);

		const completion = cloneResult(resolver);
		mutableCapability(completion).completion = "IN_PROGRESS";
		expect(compareApplicabilityResults(completion, resolver)).toContainEqual(
			expect.objectContaining({ type: "COMPLETION_MISMATCH" }),
		);

		const reason = cloneResult(resolver);
		mutableCapability(reason).reasonCode = "PRODUCT_NOT_ACCESSIBLE";
		expect(compareApplicabilityResults(reason, resolver)).toContainEqual(
			expect.objectContaining({ type: "REASON_MISMATCH" }),
		);

		const next = cloneResult(resolver);
		next.nextApplicableStep = "VOICE";
		expect(compareApplicabilityResults(next, resolver)).toContainEqual(
			expect.objectContaining({ type: "NEXT_STEP_MISMATCH" }),
		);
		expect(compareApplicabilityResults(null, resolver)).toEqual([
			{ type: "LEGACY_UNMAPPED" },
		]);
	});
});

describe("AFF-US-014 shadow boundary", () => {
	it("isolates snapshot-oracle exceptions without failing the read request", () => {
		const emitDiagnostic = vi.fn(() => {
			throw new Error("telemetry unavailable");
		});
		const observation = observeProjectApplicabilityShadowFromSnapshot(
			{ workspaceId: "workspace-shadow", userId: "user-shadow" },
			snapshot(),
			{
				normalizeLegacy: () => {
					throw new Error("secret-bearing programmer detail");
				},
				emitDiagnostic,
			},
		);

		expect(observation).toEqual({
			status: "isolated_failure",
			mismatch: { type: "RESOLVER_EXCEPTION" },
		});
		expect(emitDiagnostic).toHaveBeenCalledWith({
			projectId: "project-shadow",
			workspaceId: "workspace-shadow",
			type: "RESOLVER_EXCEPTION",
		});
		expect(JSON.stringify(emitDiagnostic.mock.calls)).not.toContain(
			"secret-bearing",
		);
	});

	it("observes parity without mutating Project state", async () => {
		const actor = { workspaceId: "workspace-shadow", userId: "user-shadow" };
		const projectValue = Object.freeze(project());
		const before = structuredClone(projectValue);
		const gathered = Object.freeze(input());
		const emitDiagnostic = vi.fn();

		const observation = await observeProjectApplicabilityShadow(
			actor,
			projectValue,
			{
				gatherInput: async () => gathered,
				resolve: resolveProjectApplicability,
				normalizeLegacy: normalizeLegacyApplicability,
				emitDiagnostic,
			},
		);

		expect(observation).toEqual({ status: "compared", mismatches: [] });
		expect(projectValue).toEqual(before);
		expect(emitDiagnostic).not.toHaveBeenCalled();
	});

	it("isolates resolver exceptions and emits only sanitized identifiers", async () => {
		const emitDiagnostic = vi.fn();
		const observation = await observeProjectApplicabilityShadow(
			{ workspaceId: "workspace-shadow", userId: "user-shadow" },
			project(),
			{
				gatherInput: async () => input(),
				resolve: () => {
					throw new Error("secret-bearing programmer detail");
				},
				normalizeLegacy: normalizeLegacyApplicability,
				emitDiagnostic,
			},
		);

		expect(observation).toEqual({
			status: "isolated_failure",
			mismatch: { type: "RESOLVER_EXCEPTION" },
		});
		expect(emitDiagnostic).toHaveBeenCalledWith({
			projectId: "project-shadow",
			workspaceId: "workspace-shadow",
			type: "RESOLVER_EXCEPTION",
		});
		expect(JSON.stringify(emitDiagnostic.mock.calls)).not.toContain(
			"secret-bearing",
		);
	});

	it("does not let a diagnostic sink failure affect the legacy request", async () => {
		const observation = await observeProjectApplicabilityShadow(
			{ workspaceId: "workspace-shadow", userId: "user-shadow" },
			project(),
			{
				gatherInput: async () => input(),
				resolve: (value) => {
					const result = resolveProjectApplicability(value);
					result.capabilities[0].state = "BLOCKED";
					return result;
				},
				normalizeLegacy: normalizeLegacyApplicability,
				emitDiagnostic: () => {
					throw new Error("telemetry unavailable");
				},
			},
		);
		expect(observation.status).toBe("compared");
	});

	it("skips future identities before gathering state", async () => {
		const future = project();
		future.contentType = "ORGANIC";
		future.creationPath = "QUICK_IMAGE";
		future.contentFormat = {
			ref: { key: "QUICK_IMAGE_STANDARD", version: 1 },
			resolution: "resolved",
			definition: null,
		};
		const gatherInput = vi.fn(async () => input());
		const observation = await observeProjectApplicabilityShadow(
			{ workspaceId: "workspace-shadow", userId: "user-shadow" },
			future,
			{
				gatherInput,
				resolve: resolveProjectApplicability,
				normalizeLegacy: normalizeLegacyApplicability,
				emitDiagnostic: vi.fn(),
			},
		);
		expect(observation).toEqual({ status: "skipped" });
		expect(gatherInput).not.toHaveBeenCalled();
	});
});
