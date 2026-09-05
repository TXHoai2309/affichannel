import {
	type ApplicabilityCapabilityResult,
	FactLockError,
	type ProjectApplicabilityInput,
	resolveProjectApplicability,
	summarizeCurrentScriptVersionClaims,
	validateScriptVersionForFactLock,
} from "@affichannel/core";

import { FactLockGate } from "./fact-lock-gate-service";
import { getProjectWorkflowSubject } from "./project-repository";
import { findCurrentScriptVersion } from "./script-version-repository";
import type { WorkspaceActor } from "./workspace";

export type VoicePaidExecutionAuthorization =
	| {
			allowed: true;
			factLockRequirement: "NOT_REQUIRED" | "SATISFIED";
			reasonCode: ApplicabilityCapabilityResult["reasonCode"];
	  }
	| {
			allowed: false;
			factLockRequirement: "REQUIRED";
			reasonCode: ApplicabilityCapabilityResult["reasonCode"];
			state: ApplicabilityCapabilityResult["state"];
	  };

function factLockCapability(
	capabilities: readonly ApplicabilityCapabilityResult[],
) {
	return capabilities.find(
		(capability) => capability.capability === "FACT_LOCK",
	);
}

function buildApplicabilityInput(
	subject: NonNullable<Awaited<ReturnType<typeof getProjectWorkflowSubject>>>,
	currentScriptVersion: Awaited<ReturnType<typeof findCurrentScriptVersion>>,
	factLockReason: ProjectApplicabilityInput["factLock"]["gateReason"],
): ProjectApplicabilityInput {
	const claimSummary = summarizeCurrentScriptVersionClaims({
		contentType: subject.contentType,
		creationPath: subject.creationPath,
		currentScriptVersion,
	});
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
			generationStatus: currentScriptVersion
				? ("USABLE" as const)
				: ("NONE" as const),
			usableGenerationPresent: currentScriptVersion !== undefined,
			sourceDependencyCurrent: true,
			currentVersionPresent: currentScriptVersion !== undefined,
			currentVersionFactLockReady: currentScriptVersion
				? validateScriptVersionForFactLock(
						currentScriptVersion.editableSnapshot,
					).success
				: false,
			channelSettingsComplete: true,
			productFactsUsable: true,
			claimSummary,
		},
		claimSummary,
		factLock: { gateReason: factLockReason },
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

export function resolveVoiceFactLockApplicability(
	subject: NonNullable<Awaited<ReturnType<typeof getProjectWorkflowSubject>>>,
	currentScriptVersion: Awaited<ReturnType<typeof findCurrentScriptVersion>>,
	factLockReason: ProjectApplicabilityInput["factLock"]["gateReason"],
) {
	const input = buildApplicabilityInput(
		subject,
		currentScriptVersion,
		factLockReason,
	);
	return factLockCapability(resolveProjectApplicability(input).capabilities);
}

/**
 * Canonical server-side policy boundary for every paid Voice provider call.
 * All identity, current ScriptVersion, claim summary, and Fact Lock inputs are
 * re-read from the authenticated workspace before this decision is returned.
 */
export async function resolveVoicePaidExecutionAuthorization(
	actor: WorkspaceActor,
	projectId: string,
): Promise<VoicePaidExecutionAuthorization> {
	const subject = await getProjectWorkflowSubject(actor.workspaceId, projectId);
	if (!subject) {
		throw new FactLockError(
			"FACT_LOCK_NOT_FOUND",
			"Project không tồn tại hoặc không thuộc workspace hiện tại.",
		);
	}

	const currentScriptVersion = await findCurrentScriptVersion(actor, projectId);
	// Resolver authority is evaluated before reading Fact Lock history. A stale
	// or malformed historical run must not turn an Organic claimless/general-only
	// project into a paid-action Fact Lock lock.
	const preliminaryFactLock = resolveVoiceFactLockApplicability(
		subject,
		currentScriptVersion,
		currentScriptVersion ? "FACT_LOCK_NOT_RUN" : "NO_SCRIPT_VERSION",
	);
	if (!preliminaryFactLock) {
		throw new FactLockError(
			"FACT_LOCK_REQUIRED",
			"Không xác định được trạng thái Fact Lock hiện tại.",
		);
	}
	if (preliminaryFactLock.state === "NOT_REQUIRED") {
		return {
			allowed: true,
			factLockRequirement: "NOT_REQUIRED",
			reasonCode: preliminaryFactLock.reasonCode,
		};
	}
	if (
		preliminaryFactLock.state !== "READY" ||
		preliminaryFactLock.completion !== "NOT_STARTED"
	) {
		// Affiliate keeps its established gate-first contract. Organic states
		// already classified as stale/blocked by the Resolver do not need a
		// historical Fact Lock read to explain their canonical remediation.
		if (subject.contentType === "AFFILIATE") {
			const factLockGate = await FactLockGate.evaluate(actor, projectId);
			const factLock = resolveVoiceFactLockApplicability(
				subject,
				currentScriptVersion,
				factLockGate.reason,
			);
			if (factLock?.state === "READY" && factLock.completion === "COMPLETE") {
				return {
					allowed: true,
					factLockRequirement: "SATISFIED",
					reasonCode: factLock.reasonCode,
				};
			}
			if (factLock) {
				return {
					allowed: false,
					factLockRequirement: "REQUIRED",
					reasonCode: factLock.reasonCode,
					state: factLock.state,
				};
			}
		}
		return {
			allowed: false,
			factLockRequirement: "REQUIRED",
			reasonCode: preliminaryFactLock.reasonCode,
			state: preliminaryFactLock.state,
		};
	}

	const factLockGate = await FactLockGate.evaluate(actor, projectId);
	const factLock = resolveVoiceFactLockApplicability(
		subject,
		currentScriptVersion,
		factLockGate.reason,
	);
	if (!factLock) {
		throw new FactLockError(
			"FACT_LOCK_REQUIRED",
			"Không xác định được trạng thái Fact Lock hiện tại.",
		);
	}

	if (factLock.state === "NOT_REQUIRED") {
		return {
			allowed: true,
			factLockRequirement: "NOT_REQUIRED",
			reasonCode: factLock.reasonCode,
		};
	}
	if (factLock.state === "READY" && factLock.completion === "COMPLETE") {
		return {
			allowed: true,
			factLockRequirement: "SATISFIED",
			reasonCode: factLock.reasonCode,
		};
	}
	return {
		allowed: false,
		factLockRequirement: "REQUIRED",
		reasonCode: factLock.reasonCode,
		state: factLock.state,
	};
}

export async function assertVoicePaidExecutionAuthorized(
	actor: WorkspaceActor,
	projectId: string,
) {
	const authorization = await resolveVoicePaidExecutionAuthorization(
		actor,
		projectId,
	);
	if (!authorization.allowed) {
		throw new FactLockError(
			"FACT_LOCK_REQUIRED",
			"Voice trả phí bị chặn bởi trạng thái Applicability/Fact Lock hiện tại.",
			{
				reason: authorization.reasonCode,
				applicabilityState: authorization.state,
				factLockRequirement: authorization.factLockRequirement,
			},
		);
	}
	return authorization;
}
