import {
	type AdaptiveWorkflowReadModel,
	classifyLegacyProject,
	mapAdaptiveWorkflowReadModel,
	type ProjectApplicabilityInput,
	type ProjectApplicabilityResult,
	resolveProjectApplicability,
	validateScriptVersionForFactLock,
} from "@affichannel/core";

import { FactLockGate } from "./fact-lock-gate-service";
import {
	getProjectWorkflowSubject,
	type ProjectDetails,
	type ProjectWorkflowSubject,
} from "./project-repository";
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
};

const defaultDependencies: ProjectWorkflowReadDependencies = {
	findSubject: getProjectWorkflowSubject,
	readScript: getScriptGenerationReadModel,
	readCurrentScriptVersion: findCurrentScriptVersion,
	evaluateFactLock: FactLockGate.evaluate,
	readVoice: getVoiceStepWorkflowReadSnapshot,
};

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

function emptyInput(
	subject: ProjectWorkflowSubject,
): ProjectApplicabilityInput {
	return {
		projectIdentity: {
			contentType: subject.contentType,
			creationPath: subject.creationPath,
			contentFormatKey: subject.contentFormatKey,
			contentFormatVersion: subject.contentFormatVersion,
			hasProduct: subject.productId !== null,
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

export function projectDetailsToWorkflowSubject(
	project: ProjectDetails,
): ProjectWorkflowSubject {
	return {
		id: project.id,
		contentType: project.contentType,
		creationPath: project.creationPath,
		contentFormatKey: project.contentFormat?.ref.key ?? null,
		contentFormatVersion: project.contentFormat?.ref.version ?? null,
		productId: project.product.id,
		productAccessible: true,
	};
}

/** Gathers sanitized domain summaries without reconciliation, provider, or writes. */
export async function gatherProjectApplicabilityInput(
	actor: WorkspaceActor,
	subject: ProjectWorkflowSubject,
	dependencies: ProjectWorkflowReadDependencies = defaultDependencies,
): Promise<ProjectApplicabilityInput> {
	if (!subject.productAccessible) return emptyInput(subject);

	const [scriptReadModel, currentScriptVersion, factLockGate] =
		await Promise.all([
			dependencies.readScript(actor, subject.id),
			dependencies.readCurrentScriptVersion(actor, subject.id),
			dependencies.evaluateFactLock(actor, subject.id),
		]);
	const voice = await dependencies.readVoice(actor, subject.id, {
		factLockGate,
		currentScriptVersion,
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
		product: { accessible: true },
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
		},
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
