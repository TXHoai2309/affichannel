import {
	type AdaptiveWorkflowReadModel,
	buildClaimManifestFromQuickImageSource,
	type ClaimInventorySummary,
	classifyLegacyProject,
	isQuickImageProjectIdentity,
	mapAdaptiveWorkflowReadModel,
	type ProjectApplicabilityInput,
	type ProjectApplicabilityResult,
	type QuickImageClaimSourceAuthority,
	resolveProjectApplicability,
	summarizeCurrentScriptVersionClaims,
	validateScriptVersionForFactLock,
} from "@affichannel/core";

import { FactLockGate } from "./fact-lock-gate-service";
import {
	getProjectWorkflowSubject,
	type ProjectDetails,
	type ProjectWorkflowSubject,
} from "./project-repository";
import { getQuickImageClaimSource } from "./quick-image-claim-source-service";
import { getScriptGenerationReadModel } from "./script-generation-service";
import { findCurrentScriptVersion } from "./script-version-repository";
import { getVoiceStepWorkflowReadSnapshot } from "./voice-step-workflow-service";
import type { WorkspaceActor } from "./workspace";

type ScriptReadModel = Awaited<ReturnType<typeof getScriptGenerationReadModel>>;

export type ProjectWorkflowSnapshot = {
	projectId: string;
	applicabilityInput: ProjectApplicabilityInput;
	applicabilityResult: ProjectApplicabilityResult;
	adaptiveWorkflow: AdaptiveWorkflowReadModel;
};

export type ProjectWorkflowReadDependencies = {
	findSubject: (
		workspaceId: string,
		projectId: string,
	) => Promise<ProjectWorkflowSubject | undefined>;
	readScript: typeof getScriptGenerationReadModel;
	readCurrentScriptVersion: typeof findCurrentScriptVersion;
	evaluateFactLock: typeof FactLockGate.evaluate;
	readVoice: typeof getVoiceStepWorkflowReadSnapshot;
	readQuickImageClaimSource?: typeof getQuickImageClaimSource;
};

const defaultDependencies: ProjectWorkflowReadDependencies = {
	findSubject: getProjectWorkflowSubject,
	readScript: getScriptGenerationReadModel,
	readCurrentScriptVersion: findCurrentScriptVersion,
	evaluateFactLock: FactLockGate.evaluate,
	readVoice: getVoiceStepWorkflowReadSnapshot,
	readQuickImageClaimSource: getQuickImageClaimSource,
};

export type ProjectWorkflowQuickImageClaimAuthority = Readonly<{
	projectId: string;
	source: QuickImageClaimSourceAuthority | null;
	summary: ClaimInventorySummary;
	invalid: boolean;
}>;

function quickImageUnknownClaimSummary(): ClaimInventorySummary {
	return {
		status: "UNKNOWN",
		subjectResolution: "UNKNOWN",
		productClaimState: "UNKNOWN",
		productClaimCount: null,
		generalClaimCount: null,
	};
}

function quickImageNoProductClaimSummary(): ClaimInventorySummary {
	return {
		status: "CURRENT",
		subjectResolution: "CONFIRMED",
		productClaimState: "NONE",
		productClaimCount: 0,
		generalClaimCount: 0,
	};
}

export function buildQuickImageClaimAuthorityWithoutSource(input: {
	projectId: string;
	productId: string | null;
}): ProjectWorkflowQuickImageClaimAuthority {
	return {
		projectId: input.projectId,
		source: null,
		summary:
			input.productId === null
				? quickImageNoProductClaimSummary()
				: quickImageUnknownClaimSummary(),
		invalid: false,
	};
}

/**
 * Reads the durable Quick Image source and derives the same claim-count
 * semantics as the accepted ClaimManifest builder without persisting either
 * the source or a manifest.
 */
export async function readQuickImageClaimAuthority(input: {
	workspaceId: string;
	projectId: string;
	productId: string | null;
	readSource?: typeof getQuickImageClaimSource;
}): Promise<ProjectWorkflowQuickImageClaimAuthority> {
	let source: QuickImageClaimSourceAuthority | null;
	try {
		source = await (input.readSource ?? getQuickImageClaimSource)({
			workspaceId: input.workspaceId,
			projectId: input.projectId,
		});
	} catch {
		return {
			projectId: input.projectId,
			source: null,
			summary: quickImageUnknownClaimSummary(),
			invalid: true,
		};
	}
	if (!source) {
		return buildQuickImageClaimAuthorityWithoutSource(input);
	}
	try {
		const manifest = await buildClaimManifestFromQuickImageSource({
			workspaceId: input.workspaceId,
			projectId: input.projectId,
			productId: input.productId,
			source: source.document,
			sourceRevision: source.revision,
			sourceContentHashSha256: source.sourceContentHashSha256,
		});
		return {
			projectId: input.projectId,
			source,
			summary: {
				status: "CURRENT",
				subjectResolution: "CONFIRMED",
				productClaimState: manifest.claimCount > 0 ? "PRESENT" : "NONE",
				productClaimCount: manifest.claimCount,
				generalClaimCount: 0,
			},
			invalid: false,
		};
	} catch {
		return {
			projectId: input.projectId,
			source: null,
			summary: quickImageUnknownClaimSummary(),
			invalid: true,
		};
	}
}

function generationStatus(
	readModel: ScriptReadModel,
): ProjectApplicabilityInput["script"]["generationStatus"] {
	const latest = readModel.latestRequest;
	if (!latest) return "NONE";
	if (latest.status === "pending") return "PENDING";
	if (latest.status === "failed") return "FAILED";
	if (latest.status === "indeterminate") return "INDETERMINATE";
	return readModel.latestUsableArtifact ? "USABLE" : "INDETERMINATE";
}

function isOrganicScriptedSubject(subject: ProjectWorkflowSubject) {
	return (
		subject.contentType === "ORGANIC" &&
		subject.creationPath === "SCRIPTED" &&
		subject.contentFormatKey === "SCRIPTED_STANDARD" &&
		subject.contentFormatVersion === 1
	);
}

function unevaluatedFactLockGate(
	currentScriptVersion: Awaited<ReturnType<typeof findCurrentScriptVersion>>,
): Awaited<ReturnType<typeof FactLockGate.evaluate>> {
	return {
		allowed: false,
		reason: currentScriptVersion ? "FACT_LOCK_NOT_RUN" : "NO_SCRIPT_VERSION",
		currentScriptVersionId: currentScriptVersion?.id ?? null,
		currentScriptRevision: currentScriptVersion?.revision ?? null,
		factLockRunId: null,
		blockingRunStatus: null,
	};
}

function emptyInput(
	subject: ProjectWorkflowSubject,
	productAccessible = false,
): ProjectApplicabilityInput {
	return {
		projectIdentity: {
			contentType: subject.contentType,
			creationPath: subject.creationPath,
			contentFormatKey: subject.contentFormatKey,
			contentFormatVersion: subject.contentFormatVersion,
			hasProduct: subject.productId !== null,
		},
		product: { accessible: productAccessible },
		script: {
			generationStatus: "NONE",
			usableGenerationPresent: false,
			sourceDependencyCurrent: false,
			currentVersionPresent: false,
			currentVersionFactLockReady: false,
			channelSettingsComplete: false,
			productFactsUsable: false,
		},
		claimSummary: {
			status: "UNKNOWN",
			subjectResolution: "UNKNOWN",
			productClaimState: "UNKNOWN",
			productClaimCount: null,
			generalClaimCount: null,
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

function quickImageInitialFactLockReason(
	subject: ProjectWorkflowSubject,
	authority: ProjectWorkflowQuickImageClaimAuthority,
): ProjectApplicabilityInput["factLock"]["gateReason"] {
	if (
		authority.source === null &&
		!authority.invalid &&
		subject.contentType === "ORGANIC" &&
		subject.productId === null
	)
		return "FACT_LOCK_NOT_RUN";
	return authority.source && !authority.invalid
		? "FACT_LOCK_NOT_RUN"
		: "FACT_LOCK_INDETERMINATE";
}

export function buildQuickImageWorkflowInput(
	subject: ProjectWorkflowSubject,
	authority: ProjectWorkflowQuickImageClaimAuthority,
): ProjectApplicabilityInput {
	const input = emptyInput(subject, subject.productAccessible);
	return {
		...input,
		claimSummary: authority.summary,
		script: { ...input.script, claimSummary: authority.summary },
		factLock: {
			gateReason: quickImageInitialFactLockReason(subject, authority),
		},
	};
}

export function projectDetailsToWorkflowSubject(
	project: ProjectDetails,
): ProjectWorkflowSubject {
	return {
		id: project.id,
		contentType: project.contentType,
		creationPath: project.creationPath,
		contentFormatKey: project.contentFormat?.ref.key ?? null,
		contentFormatVersion: project.contentFormat?.ref.version ?? null,
		productId: project.product.id.trim() || null,
		productAccessible: project.product.id.trim().length > 0,
	};
}

/** Gathers sanitized domain summaries without reconciliation, provider, or writes. */
export async function gatherProjectApplicabilityInput(
	actor: WorkspaceActor,
	subject: ProjectWorkflowSubject,
	dependencies: ProjectWorkflowReadDependencies = defaultDependencies,
): Promise<ProjectApplicabilityInput> {
	const organicScripted = isOrganicScriptedSubject(subject);
	const identityClassification = classifyLegacyProject({
		contentType: subject.contentType,
		creationPath: subject.creationPath,
		contentFormatKey: subject.contentFormatKey,
		contentFormatVersion: subject.contentFormatVersion,
		hasProduct: subject.productId !== null,
	});
	if (identityClassification.kind === "exception") return emptyInput(subject);
	const quickImage = isQuickImageProjectIdentity({
		contentType: subject.contentType,
		creationPath: subject.creationPath,
		contentFormatKey: subject.contentFormatKey,
		contentFormatVersion: subject.contentFormatVersion,
		hasProduct: subject.productId !== null,
	});
	if (quickImage) {
		const authority =
			subject.productId === null
				? buildQuickImageClaimAuthorityWithoutSource({
						projectId: subject.id,
						productId: null,
					})
				: await readQuickImageClaimAuthority({
						workspaceId: actor.workspaceId,
						projectId: subject.id,
						productId: subject.productId,
						readSource: dependencies.readQuickImageClaimSource,
					});
		const initialInput = buildQuickImageWorkflowInput(subject, authority);
		const preliminaryResult = resolveProjectApplicability(initialInput);
		const productApplicability = preliminaryResult.capabilities.find(
			(capability) => capability.capability === "PRODUCT",
		);
		const factLockApplicability = preliminaryResult.capabilities.find(
			(capability) => capability.capability === "FACT_LOCK",
		);
		let factLockReason = initialInput.factLock.gateReason;
		if (
			authority.source &&
			!authority.invalid &&
			productApplicability?.state !== "BLOCKED" &&
			factLockApplicability?.state === "REQUIRED"
		) {
			factLockReason = (await dependencies.evaluateFactLock(actor, subject.id))
				.reason;
		}
		return {
			...initialInput,
			factLock: { gateReason: factLockReason },
		};
	}
	if (!subject.productAccessible && !organicScripted)
		return emptyInput(subject);

	let scriptReadModel: Awaited<ReturnType<typeof getScriptGenerationReadModel>>;
	let currentScriptVersion: Awaited<
		ReturnType<typeof findCurrentScriptVersion>
	>;
	let initialFactLockGate:
		| Awaited<ReturnType<typeof FactLockGate.evaluate>>
		| undefined;
	if (organicScripted) {
		[scriptReadModel, currentScriptVersion] = await Promise.all([
			dependencies.readScript(actor, subject.id),
			dependencies.readCurrentScriptVersion(actor, subject.id),
		]);
	} else {
		[scriptReadModel, currentScriptVersion, initialFactLockGate] =
			await Promise.all([
				dependencies.readScript(actor, subject.id),
				dependencies.readCurrentScriptVersion(actor, subject.id),
				dependencies.evaluateFactLock(actor, subject.id),
			]);
	}
	const currentClaimSummary = summarizeCurrentScriptVersionClaims({
		contentType: subject.contentType,
		creationPath: subject.creationPath,
		currentScriptVersion,
	});
	const scriptInput: ProjectApplicabilityInput["script"] = {
		generationStatus: generationStatus(scriptReadModel),
		usableGenerationPresent: scriptReadModel.latestUsableArtifact !== null,
		sourceDependencyCurrent:
			scriptReadModel.dependencyState?.state !== "invalidated",
		currentVersionPresent: currentScriptVersion !== undefined,
		currentVersionFactLockReady: currentScriptVersion
			? validateScriptVersionForFactLock(currentScriptVersion.editableSnapshot)
					.success
			: false,
		channelSettingsComplete: scriptReadModel.context.channelSettings !== null,
		productFactsUsable: (scriptReadModel.context.facts ?? []).some(
			(fact) => fact.generationUsability !== "blocked",
		),
		claimSummary: currentClaimSummary,
	};
	const preliminaryResult = resolveProjectApplicability({
		projectIdentity: {
			contentType: subject.contentType,
			creationPath: subject.creationPath,
			contentFormatKey: subject.contentFormatKey,
			contentFormatVersion: subject.contentFormatVersion,
			hasProduct: subject.productId !== null,
		},
		product: { accessible: subject.productAccessible },
		script: scriptInput,
		claimSummary: currentClaimSummary,
		factLock: {
			gateReason: currentScriptVersion
				? "FACT_LOCK_NOT_RUN"
				: "NO_SCRIPT_VERSION",
		},
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
	});
	const factLockApplicability = preliminaryResult.capabilities.find(
		(capability) => capability.capability === "FACT_LOCK",
	);
	const factLockGate = organicScripted
		? factLockApplicability?.state === "READY" &&
			factLockApplicability.completion === "NOT_STARTED"
			? await dependencies.evaluateFactLock(actor, subject.id)
			: unevaluatedFactLockGate(currentScriptVersion)
		: (initialFactLockGate ?? unevaluatedFactLockGate(currentScriptVersion));
	const voice = await dependencies.readVoice(actor, subject.id, {
		factLockGate,
		currentScriptVersion,
		factLockNotRequired: factLockApplicability?.state === "NOT_REQUIRED",
	});
	const effectiveStatuses = voice.segments.map(
		(segment) => segment.readModel.effectiveStatus,
	);

	return {
		projectIdentity: {
			contentType: subject.contentType,
			creationPath: subject.creationPath,
			contentFormatKey: subject.contentFormatKey,
			contentFormatVersion: subject.contentFormatVersion,
			hasProduct: subject.productId !== null,
		},
		product: { accessible: subject.productAccessible },
		script: {
			generationStatus: generationStatus(scriptReadModel),
			usableGenerationPresent: scriptReadModel.latestUsableArtifact !== null,
			sourceDependencyCurrent:
				scriptReadModel.dependencyState?.state !== "invalidated",
			currentVersionPresent: currentScriptVersion !== undefined,
			currentVersionFactLockReady: currentScriptVersion
				? validateScriptVersionForFactLock(
						currentScriptVersion.editableSnapshot,
					).success
				: false,
			channelSettingsComplete: scriptReadModel.context.channelSettings !== null,
			productFactsUsable: (scriptReadModel.context.facts ?? []).some(
				(fact) => fact.generationUsability !== "blocked",
			),
			claimSummary: currentClaimSummary,
		},
		claimSummary: currentClaimSummary,
		factLock: { gateReason: factLockGate.reason },
		voice: {
			configPresent: voice.summary.voiceConfigPresent,
			// Preview audio remains ephemeral and is not workflow completion.
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

export async function gatherProjectWorkflowSnapshot(
	actor: WorkspaceActor,
	subject: ProjectWorkflowSubject,
	dependencies: ProjectWorkflowReadDependencies = defaultDependencies,
): Promise<ProjectWorkflowSnapshot> {
	const applicabilityInput = await gatherProjectApplicabilityInput(
		actor,
		subject,
		dependencies,
	);
	const identityClassification = classifyLegacyProject(
		applicabilityInput.projectIdentity,
	);
	const applicabilityResult = resolveProjectApplicability(applicabilityInput);
	return {
		projectId: subject.id,
		applicabilityInput,
		applicabilityResult,
		adaptiveWorkflow: mapAdaptiveWorkflowReadModel(applicabilityResult, {
			identityClassification,
		}),
	};
}

export async function getProjectWorkflowSnapshot(
	actor: WorkspaceActor,
	projectId: string,
	dependencies: ProjectWorkflowReadDependencies = defaultDependencies,
): Promise<ProjectWorkflowSnapshot | undefined> {
	const subject = await dependencies.findSubject(actor.workspaceId, projectId);
	return subject
		? gatherProjectWorkflowSnapshot(actor, subject, dependencies)
		: undefined;
}

/** Per-request reader. Construct once at the request boundary; never globally. */
export function createProjectWorkflowRequestReader(
	dependencies: ProjectWorkflowReadDependencies = defaultDependencies,
) {
	const reads = new Map<string, Promise<ProjectWorkflowSnapshot | undefined>>();
	return {
		get(actor: WorkspaceActor, projectId: string) {
			const key = `${actor.workspaceId}\u0000${actor.userId}\u0000${projectId}`;
			const existing = reads.get(key);
			if (existing) return existing;
			const pending = getProjectWorkflowSnapshot(
				actor,
				projectId,
				dependencies,
			);
			reads.set(key, pending);
			return pending;
		},
	};
}
