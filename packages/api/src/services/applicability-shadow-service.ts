import {
	type ApplicabilityCapability,
	type ApplicabilityCapabilityResult,
	type ApplicabilityCompletion,
	type ApplicabilityReasonCode,
	type ApplicabilityState,
	type ProjectApplicabilityInput,
	type ProjectApplicabilityResult,
	resolveProjectApplicability,
	validateScriptVersionForFactLockRun,
} from "@affichannel/core";
import { FactLockGate } from "./fact-lock-gate-service";
import { findProduct } from "./product-repository";
import type { ProjectDetails } from "./project-repository";
import { getScriptGenerationReadModel } from "./script-generation-service";
import { findCurrentScriptVersion } from "./script-version-repository";
import { getVoiceStepWorkflowReadSnapshot } from "./voice-step-workflow-service";
import type { WorkspaceActor } from "./workspace";

export const APPLICABILITY_MISMATCH_TYPES = [
	"STATE_MISMATCH",
	"COMPLETION_MISMATCH",
	"REASON_MISMATCH",
	"NEXT_STEP_MISMATCH",
	"LEGACY_UNMAPPED",
	"RESOLVER_EXCEPTION",
] as const;

export type ApplicabilityMismatchType =
	(typeof APPLICABILITY_MISMATCH_TYPES)[number];

export type ApplicabilityMismatch = {
	type: ApplicabilityMismatchType;
	capability?: ApplicabilityCapability;
	legacyState?: ApplicabilityState;
	resolverState?: ApplicabilityState;
	legacyCompletion?: ApplicabilityCompletion;
	resolverCompletion?: ApplicabilityCompletion;
	legacyReasonCode?: ApplicabilityReasonCode;
	resolverReasonCode?: ApplicabilityReasonCode;
	legacyNextStep?: ApplicabilityCapability | null;
	resolverNextStep?: ApplicabilityCapability | null;
};

export type ApplicabilityShadowDiagnostic = ApplicabilityMismatch & {
	projectId: string;
	workspaceId: string;
};

export type ApplicabilityShadowObservation =
	| { status: "skipped" }
	| {
			status: "compared";
			mismatches: readonly ApplicabilityMismatch[];
	  }
	| { status: "isolated_failure"; mismatch: ApplicabilityMismatch };

type ShadowDependencies = {
	gatherInput: (
		actor: WorkspaceActor,
		project: ProjectDetails,
	) => Promise<ProjectApplicabilityInput>;
	resolve: (input: ProjectApplicabilityInput) => ProjectApplicabilityResult;
	normalizeLegacy: (
		input: ProjectApplicabilityInput,
	) => ProjectApplicabilityResult | null;
	emitDiagnostic: (diagnostic: ApplicabilityShadowDiagnostic) => void;
};

function legacyCapability(
	capability: ApplicabilityCapability,
	state: ApplicabilityState,
	completion: ApplicabilityCompletion,
	reasonCode: ApplicabilityReasonCode,
): ApplicabilityCapabilityResult {
	return { capability, state, completion, reasonCode, dependencies: [] };
}

function legacyNextStep(
	capabilities: readonly ApplicabilityCapabilityResult[],
) {
	return (
		capabilities.find(
			(item) =>
				item.state !== "NOT_REQUIRED" &&
				item.state !== "OPTIONAL" &&
				!(item.state === "READY" && item.completion === "COMPLETE"),
		)?.capability ?? null
	);
}

/**
 * Normalizes the currently distributed Affiliate authorities into the M4
 * comparison domain. It remains an observer and intentionally ignores
 * currentStepKey because that persisted cursor is not applicability truth.
 */
export function normalizeLegacyApplicability(
	input: ProjectApplicabilityInput,
): ProjectApplicabilityResult | null {
	const identity = input.projectIdentity;
	const baseline =
		identity.contentType === "AFFILIATE" &&
		identity.creationPath === "SCRIPTED" &&
		identity.contentFormatKey === "SCRIPTED_STANDARD" &&
		identity.contentFormatVersion === 1 &&
		identity.hasProduct;
	if (!baseline) return null;

	const product = input.product.accessible
		? legacyCapability("PRODUCT", "READY", "COMPLETE", "PRODUCT_READY")
		: legacyCapability(
				"PRODUCT",
				"BLOCKED",
				"IN_PROGRESS",
				"PRODUCT_NOT_ACCESSIBLE",
			);

	let script: ApplicabilityCapabilityResult;
	if (!input.product.accessible) {
		script = legacyCapability(
			"SCRIPT",
			"REQUIRED",
			"NOT_STARTED",
			"SCRIPT_REQUIRES_ACCESSIBLE_PRODUCT",
		);
	} else if (!input.script.channelSettingsComplete) {
		script = legacyCapability(
			"SCRIPT",
			"BLOCKED",
			"NOT_STARTED",
			"SCRIPT_CHANNEL_SETTINGS_INCOMPLETE",
		);
	} else if (!input.script.productFactsUsable) {
		script = legacyCapability(
			"SCRIPT",
			"BLOCKED",
			"NOT_STARTED",
			"SCRIPT_PRODUCT_FACTS_UNUSABLE",
		);
	} else if (input.script.currentVersionPresent) {
		script = input.script.currentVersionFactLockReady
			? legacyCapability("SCRIPT", "READY", "COMPLETE", "SCRIPT_READY")
			: legacyCapability(
					"SCRIPT",
					"BLOCKED",
					"IN_PROGRESS",
					"SCRIPT_VERSION_NOT_FACT_LOCK_READY",
				);
	} else if (
		input.script.usableGenerationPresent &&
		!input.script.sourceDependencyCurrent
	) {
		script = legacyCapability(
			"SCRIPT",
			"STALE",
			"IN_PROGRESS",
			"SCRIPT_SOURCE_DEPENDENCY_STALE",
		);
	} else if (input.script.generationStatus === "PENDING") {
		script = legacyCapability(
			"SCRIPT",
			"REQUIRED",
			"IN_PROGRESS",
			"SCRIPT_GENERATION_PENDING",
		);
	} else if (input.script.generationStatus === "FAILED") {
		script = legacyCapability(
			"SCRIPT",
			"BLOCKED",
			"IN_PROGRESS",
			"SCRIPT_GENERATION_FAILED",
		);
	} else if (input.script.generationStatus === "INDETERMINATE") {
		script = legacyCapability(
			"SCRIPT",
			"BLOCKED",
			"IN_PROGRESS",
			"SCRIPT_GENERATION_INDETERMINATE",
		);
	} else if (input.script.usableGenerationPresent) {
		script = legacyCapability(
			"SCRIPT",
			"READY",
			"IN_PROGRESS",
			"CURRENT_SCRIPT_VERSION_REQUIRED",
		);
	} else {
		script = legacyCapability(
			"SCRIPT",
			"READY",
			"NOT_STARTED",
			"SCRIPT_GENERATION_REQUIRED",
		);
	}

	const factLockMap = {
		NO_SCRIPT_VERSION: [
			"REQUIRED",
			"NOT_STARTED",
			"FACT_LOCK_REQUIRES_CURRENT_SCRIPT",
		],
		SCRIPT_NOT_READY: ["REQUIRED", "NOT_STARTED", "FACT_LOCK_SCRIPT_NOT_READY"],
		FACT_LOCK_NOT_RUN: ["READY", "NOT_STARTED", "FACT_LOCK_RUN_REQUIRED"],
		FACT_LOCK_PENDING: ["REQUIRED", "IN_PROGRESS", "FACT_LOCK_PENDING"],
		FACT_LOCK_REVIEW_REQUIRED: [
			"BLOCKED",
			"IN_PROGRESS",
			"FACT_LOCK_REVIEW_REQUIRED",
		],
		FACT_LOCK_STALE_SCRIPT: ["STALE", "IN_PROGRESS", "FACT_LOCK_STALE_SCRIPT"],
		FACT_LOCK_STALE_FACTS: ["STALE", "IN_PROGRESS", "FACT_LOCK_STALE_FACTS"],
		FACT_LOCK_FAILED: ["BLOCKED", "IN_PROGRESS", "FACT_LOCK_FAILED"],
		FACT_LOCK_INDETERMINATE: [
			"BLOCKED",
			"IN_PROGRESS",
			"FACT_LOCK_INDETERMINATE",
		],
		FACT_LOCK_PASSED: ["READY", "COMPLETE", "FACT_LOCK_PASSED"],
	} as const satisfies Record<
		ProjectApplicabilityInput["factLock"]["gateReason"],
		readonly [
			ApplicabilityState,
			ApplicabilityCompletion,
			ApplicabilityReasonCode,
		]
	>;
	const [factLockState, factLockCompletion, factLockReason] =
		factLockMap[input.factLock.gateReason];
	const factLock = legacyCapability(
		"FACT_LOCK",
		factLockState,
		factLockCompletion,
		factLockReason,
	);

	let voice: ApplicabilityCapabilityResult;
	if (input.voice.staleSegments > 0) {
		voice = legacyCapability(
			"VOICE",
			"STALE",
			"IN_PROGRESS",
			"VOICE_ARTIFACTS_STALE",
		);
	} else if (factLock.completion !== "COMPLETE") {
		const blocked = factLock.state === "BLOCKED" || factLock.state === "STALE";
		voice = legacyCapability(
			"VOICE",
			blocked ? "BLOCKED" : "REQUIRED",
			input.voice.attemptedSegments > 0 ? "IN_PROGRESS" : "NOT_STARTED",
			blocked ? "VOICE_BLOCKED_BY_FACT_LOCK" : "VOICE_REQUIRES_FACT_LOCK_PASS",
		);
	} else if (!input.voice.configPresent) {
		voice = legacyCapability(
			"VOICE",
			"READY",
			"NOT_STARTED",
			"VOICE_CONFIG_REQUIRED",
		);
	} else if (input.voice.failedSegments > 0) {
		voice = legacyCapability(
			"VOICE",
			"BLOCKED",
			"IN_PROGRESS",
			"VOICE_SEGMENTS_FAILED",
		);
	} else if (input.voice.indeterminateSegments > 0) {
		voice = legacyCapability(
			"VOICE",
			"BLOCKED",
			"IN_PROGRESS",
			"VOICE_SEGMENTS_INDETERMINATE",
		);
	} else if (input.voice.pendingSegments > 0) {
		voice = legacyCapability(
			"VOICE",
			"REQUIRED",
			"IN_PROGRESS",
			"VOICE_SEGMENTS_PENDING",
		);
	} else if (input.voice.attemptedSegments === 0) {
		voice = legacyCapability(
			"VOICE",
			"READY",
			"IN_PROGRESS",
			"VOICE_SEGMENTS_REQUIRED",
		);
	} else if (
		input.voice.totalSegments === 0 ||
		input.voice.usableSegments < input.voice.totalSegments
	) {
		voice = legacyCapability(
			"VOICE",
			"READY",
			"IN_PROGRESS",
			"VOICE_SEGMENTS_INCOMPLETE",
		);
	} else {
		voice = legacyCapability("VOICE", "READY", "COMPLETE", "VOICE_READY");
	}

	const upstreamReady = [product, script, factLock, voice].every(
		(item) => item.state === "READY" && item.completion === "COMPLETE",
	);
	const render = !upstreamReady
		? legacyCapability(
				"RENDER",
				"REQUIRED",
				"NOT_STARTED",
				"RENDER_REQUIRES_UPSTREAM_CAPABILITIES",
			)
		: input.render.inputsStale
			? legacyCapability(
					"RENDER",
					"STALE",
					"IN_PROGRESS",
					"RENDER_INPUTS_STALE",
				)
			: legacyCapability(
					"RENDER",
					"BLOCKED",
					"NOT_STARTED",
					"RENDER_FEATURE_NOT_IMPLEMENTED",
				);

	const capabilities = [product, script, factLock, voice, render];
	return { capabilities, nextApplicableStep: legacyNextStep(capabilities) };
}

export function compareApplicabilityResults(
	legacy: ProjectApplicabilityResult | null,
	resolver: ProjectApplicabilityResult,
): ApplicabilityMismatch[] {
	if (!legacy) return [{ type: "LEGACY_UNMAPPED" }];

	const mismatches: ApplicabilityMismatch[] = [];
	for (const resolverCapability of resolver.capabilities) {
		const legacyCapabilityResult = legacy.capabilities.find(
			(item) => item.capability === resolverCapability.capability,
		);
		if (!legacyCapabilityResult) {
			mismatches.push({
				type: "LEGACY_UNMAPPED",
				capability: resolverCapability.capability,
			});
			continue;
		}
		if (legacyCapabilityResult.state !== resolverCapability.state) {
			mismatches.push({
				type: "STATE_MISMATCH",
				capability: resolverCapability.capability,
				legacyState: legacyCapabilityResult.state,
				resolverState: resolverCapability.state,
			});
		}
		if (legacyCapabilityResult.completion !== resolverCapability.completion) {
			mismatches.push({
				type: "COMPLETION_MISMATCH",
				capability: resolverCapability.capability,
				legacyCompletion: legacyCapabilityResult.completion,
				resolverCompletion: resolverCapability.completion,
			});
		}
		if (legacyCapabilityResult.reasonCode !== resolverCapability.reasonCode) {
			mismatches.push({
				type: "REASON_MISMATCH",
				capability: resolverCapability.capability,
				legacyReasonCode: legacyCapabilityResult.reasonCode,
				resolverReasonCode: resolverCapability.reasonCode,
			});
		}
	}
	if (legacy.nextApplicableStep !== resolver.nextApplicableStep) {
		mismatches.push({
			type: "NEXT_STEP_MISMATCH",
			legacyNextStep: legacy.nextApplicableStep,
			resolverNextStep: resolver.nextApplicableStep,
		});
	}
	return mismatches;
}

function generationStatus(
	readModel: Awaited<ReturnType<typeof getScriptGenerationReadModel>>,
): ProjectApplicabilityInput["script"]["generationStatus"] {
	const latest = readModel.latestRequest;
	if (!latest) return "NONE";
	if (latest.status === "pending") return "PENDING";
	if (latest.status === "failed") return "FAILED";
	if (latest.status === "indeterminate") return "INDETERMINATE";
	return readModel.latestUsableArtifact ? "USABLE" : "INDETERMINATE";
}

export async function gatherProjectApplicabilityInput(
	actor: WorkspaceActor,
	project: ProjectDetails,
): Promise<ProjectApplicabilityInput> {
	const accessibleProduct = await findProduct(actor, project.product.id);
	if (!accessibleProduct) {
		return {
			projectIdentity: {
				contentType: project.contentType,
				creationPath: project.creationPath,
				contentFormatKey: project.contentFormat?.ref.key ?? null,
				contentFormatVersion: project.contentFormat?.ref.version ?? null,
				hasProduct: true,
			},
			product: { accessible: false },
			script: {
				generationStatus: "NONE",
				usableGenerationPresent: false,
				sourceDependencyCurrent: false,
				currentVersionPresent: false,
				currentVersionFactLockReady: false,
				channelSettingsComplete: false,
				productFactsUsable: false,
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
	const [scriptReadModel, currentScriptVersion, factLockGate] =
		await Promise.all([
			getScriptGenerationReadModel(actor, project.id),
			findCurrentScriptVersion(actor, project.id),
			FactLockGate.evaluate(actor, project.id),
		]);
	const voice = await getVoiceStepWorkflowReadSnapshot(actor, project.id, {
		factLockGate,
		currentScriptVersion,
	});
	const effectiveStatuses = voice.segments.map(
		(segment) => segment.readModel.effectiveStatus,
	);

	return {
		projectIdentity: {
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormat?.ref.key ?? null,
			contentFormatVersion: project.contentFormat?.ref.version ?? null,
			hasProduct: true,
		},
		product: { accessible: true },
		script: {
			generationStatus: generationStatus(scriptReadModel),
			usableGenerationPresent: scriptReadModel.latestUsableArtifact !== null,
			sourceDependencyCurrent:
				scriptReadModel.dependencyState?.state !== "invalidated",
			currentVersionPresent: currentScriptVersion !== undefined,
			currentVersionFactLockReady: currentScriptVersion
				? validateScriptVersionForFactLockRun(
						currentScriptVersion.editableSnapshot,
					).success
				: false,
			channelSettingsComplete: scriptReadModel.context.channelSettings !== null,
			productFactsUsable: scriptReadModel.context.facts.some(
				(fact) => fact.generationUsability !== "blocked",
			),
		},
		factLock: { gateReason: factLockGate.reason },
		voice: {
			configPresent: voice.summary.voiceConfigPresent,
			// Preview audio is ephemeral in the current repository and is not completion.
			previewPresent: false,
			totalSegments: voice.summary.totalSegments,
			attemptedSegments: effectiveStatuses.filter(
				(status) => status !== "not_generated",
			).length,
			usableSegments: voice.summary.completedSegments,
			pendingSegments: voice.summary.pendingSegments,
			failedSegments: effectiveStatuses.filter((status) => status === "failed")
				.length,
			indeterminateSegments: effectiveStatuses.filter(
				(status) => status === "indeterminate",
			).length,
			staleSegments: voice.summary.staleSegments,
		},
		render: { featureImplemented: false, inputsStale: false },
	};
}

export function isM4ShadowBaselineProject(project: ProjectDetails) {
	return (
		project.contentType === "AFFILIATE" &&
		project.creationPath === "SCRIPTED" &&
		project.contentFormat?.ref.key === "SCRIPTED_STANDARD" &&
		project.contentFormat.ref.version === 1 &&
		project.contentFormat.resolution !== "unsupported"
	);
}

function emitApplicabilityShadowDiagnostic(
	diagnostic: ApplicabilityShadowDiagnostic,
) {
	console.warn("applicability_shadow_mismatch", diagnostic);
}

const defaultDependencies: ShadowDependencies = {
	gatherInput: gatherProjectApplicabilityInput,
	resolve: resolveProjectApplicability,
	normalizeLegacy: normalizeLegacyApplicability,
	emitDiagnostic: emitApplicabilityShadowDiagnostic,
};

function emitDiagnosticBestEffort(
	dependencies: ShadowDependencies,
	diagnostic: ApplicabilityShadowDiagnostic,
) {
	try {
		dependencies.emitDiagnostic(diagnostic);
	} catch {
		// Observability must never gain authority over the legacy request path.
	}
}

/** Shadow failures and mismatches are diagnostics only; legacy remains authority. */
export async function observeProjectApplicabilityShadow(
	actor: WorkspaceActor,
	project: ProjectDetails,
	dependencies: ShadowDependencies = defaultDependencies,
): Promise<ApplicabilityShadowObservation> {
	if (!isM4ShadowBaselineProject(project)) return { status: "skipped" };

	try {
		const input = await dependencies.gatherInput(actor, project);
		const legacy = dependencies.normalizeLegacy(input);
		const resolver = dependencies.resolve(input);
		const mismatches = compareApplicabilityResults(legacy, resolver);
		for (const mismatch of mismatches) {
			emitDiagnosticBestEffort(dependencies, {
				projectId: project.id,
				workspaceId: actor.workspaceId,
				...mismatch,
			});
		}
		return { status: "compared", mismatches };
	} catch {
		const mismatch = { type: "RESOLVER_EXCEPTION" as const };
		emitDiagnosticBestEffort(dependencies, {
			projectId: project.id,
			workspaceId: actor.workspaceId,
			...mismatch,
		});
		return { status: "isolated_failure", mismatch };
	}
}
