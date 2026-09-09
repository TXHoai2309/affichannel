import type {
	ApplicabilityCapabilityResult,
	CompositionCurrentness,
	FactLockGateResult,
} from "@affichannel/core";
import {
	CompositionError,
	evaluateCompositionCurrentness,
	resolveProjectApplicability,
	summarizeCurrentScriptVersionClaims,
	validateScriptVersionForFactLock,
} from "@affichannel/core";
import { db, mediaAsset, mediaAssetLink } from "@affichannel/db";
import { and, eq } from "drizzle-orm";
import { findCompositionVersionRecord } from "./composition-version-repository";
import { FactLockGate } from "./fact-lock-gate-service";
import { getProjectWorkflowSubject } from "./project-repository";
import { findCurrentScriptVersion } from "./script-version-repository";
import { findVoiceConfig } from "./voice-config-service";
import { listVoiceSegmentArtifacts } from "./voice-segment-repository";
import type { WorkspaceActor } from "./workspace";

export type CompositionExecutionAuthorization =
	| {
			allowed: true;
			reasonCode: string;
			factLockRequirement: "NOT_REQUIRED" | "REQUIRED";
			factLockOutcome: "NOT_EVALUATED" | "SATISFIED";
	  }
	| {
			allowed: false;
			reasonCode: string;
			factLockRequirement: "NOT_REQUIRED" | "REQUIRED";
			factLockOutcome: "NOT_EVALUATED" | "SATISFIED" | "BLOCKED";
	  };

export type CompositionFactLockTruth = {
	requirement: "NOT_REQUIRED" | "REQUIRED";
	outcome: "NOT_EVALUATED" | "SATISFIED" | "BLOCKED";
	evidence: FactLockGateResult | null;
};

export type CompositionBusinessPreflight = {
	currentness: CompositionCurrentness;
	authorization: CompositionExecutionAuthorization;
	applicability: ApplicabilityCapabilityResult | null;
	factLock: CompositionFactLockTruth;
	compositionVersionId: string;
};

export type CompositionMediaEligibilityAsset = {
	workspaceId: string;
	projectId: string;
	status: string;
	usageRights: string;
	checksumSha256: string | null;
};

const BUSINESS_PREFLIGHT_UPSTREAM_CAPABILITIES: ReadonlySet<
	ApplicabilityCapabilityResult["capability"]
> = new Set(["PRODUCT", "SCRIPT", "FACT_LOCK", "VOICE"] as const);

/** US020 media reuse policy: Organic has no rights restriction; Affiliate is owned/licensed only. */
export function isCompositionMediaEligible(input: {
	contentType: string | null;
	workspaceId: string;
	projectId: string;
	asset: CompositionMediaEligibilityAsset | undefined;
	checksumSha256: string;
}) {
	const { asset } = input;
	return (
		asset?.workspaceId === input.workspaceId &&
		asset.projectId === input.projectId &&
		asset.status === "ready" &&
		(input.contentType === "ORGANIC" ||
			asset.usageRights === "owned" ||
			asset.usageRights === "licensed") &&
		asset.checksumSha256 === input.checksumSha256
	);
}

/**
 * Pure, server-owned result combiner. Technical object/byte checks are
 * intentionally absent; those belong to Phase 21B.
 */
export function evaluateCompositionBusinessPreflight(input: {
	compositionVersionId: string;
	currentness: CompositionCurrentness;
	applicability: ApplicabilityCapabilityResult | null;
	applicabilityCapabilities?: readonly ApplicabilityCapabilityResult[];
	factLock: FactLockGateResult | null;
	mediaEligible: boolean;
	voiceEligible: boolean;
}): CompositionBusinessPreflight {
	const applicabilityCapabilities =
		input.applicabilityCapabilities ??
		(input.applicability ? [input.applicability] : []);
	const factLockApplicability =
		(input.applicability?.capability === "FACT_LOCK"
			? input.applicability
			: applicabilityCapabilities.find(
					(capability) => capability.capability === "FACT_LOCK",
				)) ?? null;
	const factLockRequirement =
		factLockApplicability?.state === "NOT_REQUIRED"
			? "NOT_REQUIRED"
			: "REQUIRED";
	const resolverFactLockSatisfied =
		factLockApplicability?.state === "READY" &&
		factLockApplicability.completion === "COMPLETE";
	const factLock: CompositionFactLockTruth = {
		requirement: factLockRequirement,
		outcome:
			factLockRequirement === "NOT_REQUIRED"
				? "NOT_EVALUATED"
				: input.factLock?.allowed
					? "SATISFIED"
					: resolverFactLockSatisfied
						? "SATISFIED"
						: input.factLock
							? "BLOCKED"
							: "NOT_EVALUATED",
		evidence: input.factLock,
	};
	if (input.currentness.state === "UNKNOWN")
		throw new CompositionError("COMPOSITION_CURRENTNESS_UNKNOWN");
	if (input.currentness.state === "STALE") {
		return {
			compositionVersionId: input.compositionVersionId,
			currentness: input.currentness,
			authorization: {
				allowed: false,
				reasonCode: "COMPOSITION_STALE",
				factLockRequirement,
				factLockOutcome: factLock.outcome,
			},
			applicability: input.applicability,
			factLock,
		};
	}
	const blockedCapability = applicabilityCapabilities.find(
		(capability): capability is ApplicabilityCapabilityResult =>
			capability !== null &&
			BUSINESS_PREFLIGHT_UPSTREAM_CAPABILITIES.has(capability.capability) &&
			(capability.state === "BLOCKED" || capability.state === "STALE"),
	);
	if (blockedCapability) {
		return {
			compositionVersionId: input.compositionVersionId,
			currentness: input.currentness,
			authorization: {
				allowed: false,
				reasonCode: blockedCapability.reasonCode,
				factLockRequirement,
				factLockOutcome: factLock.outcome,
			},
			applicability: input.applicability,
			factLock,
		};
	}
	if (
		factLock.requirement === "REQUIRED" &&
		factLock.outcome === "NOT_EVALUATED"
	)
		return {
			compositionVersionId: input.compositionVersionId,
			currentness: input.currentness,
			authorization: {
				allowed: false,
				reasonCode: "FACT_LOCK_NOT_EVALUATED",
				factLockRequirement,
				factLockOutcome: factLock.outcome,
			},
			applicability: input.applicability,
			factLock,
		};
	if (!input.mediaEligible)
		return {
			compositionVersionId: input.compositionVersionId,
			currentness: input.currentness,
			authorization: {
				allowed: false,
				reasonCode: "MEDIA_NOT_ELIGIBLE",
				factLockRequirement,
				factLockOutcome: factLock.outcome,
			},
			applicability: input.applicability,
			factLock,
		};
	if (!input.voiceEligible)
		return {
			compositionVersionId: input.compositionVersionId,
			currentness: input.currentness,
			authorization: {
				allowed: false,
				reasonCode: "VOICE_NOT_ELIGIBLE",
				factLockRequirement,
				factLockOutcome: factLock.outcome,
			},
			applicability: input.applicability,
			factLock,
		};
	if (
		factLock.requirement === "REQUIRED" &&
		input.factLock &&
		!input.factLock.allowed
	)
		return {
			compositionVersionId: input.compositionVersionId,
			currentness: input.currentness,
			authorization: {
				allowed: false,
				reasonCode: input.factLock.reason,
				factLockRequirement,
				factLockOutcome: factLock.outcome,
			},
			applicability: input.applicability,
			factLock,
		};
	return {
		compositionVersionId: input.compositionVersionId,
		currentness: input.currentness,
		authorization: {
			allowed: true,
			reasonCode: input.factLock
				? "FACT_LOCK_PASSED"
				: "FACT_LOCK_NOT_REQUIRED",
			factLockRequirement,
			factLockOutcome:
				factLock.outcome === "SATISFIED" ? "SATISFIED" : "NOT_EVALUATED",
		},
		applicability: input.applicability,
		factLock,
	};
}

/** Read-only boundary for future startRender. It re-reads scope and script before authorization. */
export async function preflightCompositionVersion(
	actor: WorkspaceActor,
	compositionVersionId: string,
) {
	const version = await findCompositionVersionRecord(
		actor,
		compositionVersionId,
	);
	if (!version) throw new CompositionError("COMPOSITION_VERSION_NOT_FOUND");
	const subject = await getProjectWorkflowSubject(
		actor.workspaceId,
		version.projectId,
	);
	const script = await findCurrentScriptVersion(actor, version.projectId);
	if (!subject || !script)
		throw new CompositionError(
			"COMPOSITION_EXECUTION_BLOCKED",
			"Project hoặc Script hiện tại không khả dụng.",
		);
	const input = version.compositionInput;
	const linkedMedia = await db
		.select({
			id: mediaAsset.id,
			status: mediaAsset.status,
			usageRights: mediaAsset.usageRights,
			checksumSha256: mediaAsset.checksumSha256,
			workspaceId: mediaAsset.workspaceId,
			projectId: mediaAssetLink.projectId,
		})
		.from(mediaAsset)
		.innerJoin(mediaAssetLink, eq(mediaAssetLink.mediaAssetId, mediaAsset.id))
		.where(
			and(
				eq(mediaAsset.workspaceId, actor.workspaceId),
				eq(mediaAssetLink.workspaceId, actor.workspaceId),
				eq(mediaAssetLink.projectId, version.projectId),
			),
		);
	const mediaEligible = input.media.every((dependency) => {
		const asset = linkedMedia.find(
			(candidate) => candidate.id === dependency.provenance.mediaAssetId,
		);
		return isCompositionMediaEligible({
			contentType: subject.contentType,
			workspaceId: actor.workspaceId,
			projectId: version.projectId,
			asset,
			checksumSha256: dependency.semantic.checksumSha256,
		});
	});
	const voiceConfig = await findVoiceConfig(actor, version.projectId);
	const voiceArtifacts = await listVoiceSegmentArtifacts(
		actor,
		version.projectId,
	);
	const voiceSegments = input.voice.segments;
	const voiceConfigProvenance = voiceSegments[0]?.provenance;
	const currentness = evaluateCompositionCurrentness(input, {
		scriptVersionId: script.id,
		scriptRevision: script.revision,
		voiceConfigRevision: voiceConfig?.revision ?? 0,
		voiceArtifactIds: voiceArtifacts.map((artifact) => artifact.id),
		voiceArtifactRefs: voiceSegments.map((segment) => ({
			segmentKey: segment.segmentKey,
			artifactId: segment.provenance.artifactId,
			checksum: segment.semantic.checksum,
		})),
		voiceArtifactChecksums: voiceSegments.map(
			(segment) => segment.semantic.checksum,
		),
		mediaChecksums: input.media.map(
			(dependency) =>
				linkedMedia.find(
					(asset) => asset.id === dependency.provenance.mediaAssetId,
				)?.checksumSha256 ?? "",
		),
		mediaDependencyRefs: input.media.map((dependency) => ({
			dependencyKey: dependency.dependencyKey,
			checksumSha256:
				linkedMedia.find(
					(asset) => asset.id === dependency.provenance.mediaAssetId,
				)?.checksumSha256 ?? "",
		})),
		compositionProfileId: input.profile.id,
	});
	const voiceEligible =
		voiceConfig !== null &&
		voiceConfigProvenance !== undefined &&
		voiceConfig.id === voiceConfigProvenance.configId &&
		voiceConfig.revision === voiceConfigProvenance.configRevision &&
		voiceConfig.provider === voiceConfigProvenance.provider &&
		voiceConfig.voiceId === voiceConfigProvenance.voiceId &&
		voiceConfig.language === voiceConfigProvenance.language &&
		voiceConfig.speed === voiceConfigProvenance.speed &&
		voiceSegments.every((dependency) => {
			const artifact = voiceArtifacts.find(
				(candidate) => candidate.id === dependency.provenance.artifactId,
			);
			return (
				artifact?.status === "completed" &&
				artifact.segmentKey === dependency.segmentKey &&
				artifact.sourceScriptVersionId === script.id &&
				artifact.sourceScriptRevision === script.revision &&
				artifact.voiceConfigRevision === dependency.provenance.configRevision &&
				artifact.provider === dependency.provenance.provider &&
				artifact.voiceId === dependency.provenance.voiceId &&
				artifact.language === dependency.provenance.language &&
				artifact.speed === dependency.provenance.speed &&
				artifact.segmentTextSnapshot === dependency.provenance.textSnapshot &&
				artifact.textHash === dependency.provenance.textHash &&
				artifact.checksum === dependency.semantic.checksum
			);
		});
	const claimSummary = summarizeCurrentScriptVersionClaims({
		contentType: subject.contentType,
		creationPath: subject.creationPath,
		currentScriptVersion: script,
	});
	const buildApplicabilityResult = (
		factLockReason: Parameters<
			typeof resolveProjectApplicability
		>[0]["factLock"]["gateReason"],
	) =>
		resolveProjectApplicability({
			projectIdentity: {
				contentType: subject.contentType,
				creationPath: subject.creationPath,
				contentFormatKey: subject.contentFormatKey,
				contentFormatVersion: subject.contentFormatVersion,
				hasProduct: subject.productId !== null,
			},
			product: { accessible: subject.productAccessible },
			script: {
				generationStatus: "USABLE",
				usableGenerationPresent: true,
				sourceDependencyCurrent: true,
				currentVersionPresent: true,
				currentVersionFactLockReady: validateScriptVersionForFactLock(
					script.editableSnapshot,
				).success,
				channelSettingsComplete: true,
				productFactsUsable: true,
				claimSummary,
			},
			claimSummary,
			factLock: { gateReason: factLockReason },
			voice: {
				configPresent: voiceConfig !== null,
				previewPresent: false,
				totalSegments: voiceSegments.length,
				attemptedSegments: voiceArtifacts.length,
				usableSegments: voiceEligible ? voiceSegments.length : 0,
				pendingSegments: 0,
				failedSegments: 0,
				indeterminateSegments: 0,
				staleSegments: voiceEligible ? 0 : voiceSegments.length,
			},
			render: {
				featureImplemented: false,
				inputsStale: currentness.state !== "CURRENT",
			},
		});
	let applicabilityResult = buildApplicabilityResult("FACT_LOCK_NOT_RUN");
	const applicability =
		applicabilityResult.capabilities.find(
			(capability) => capability.capability === "FACT_LOCK",
		) ?? null;
	// Resolver decides whether FactLockGate is required; no Organic bypass flag is accepted.
	let factLock: FactLockGateResult | null = null;
	if (
		applicability &&
		applicability.state === "READY" &&
		applicability.completion === "NOT_STARTED"
	) {
		factLock = await FactLockGate.evaluate(actor, version.projectId);
		applicabilityResult = buildApplicabilityResult(factLock.reason);
	}
	const finalApplicability =
		applicabilityResult.capabilities.find(
			(capability) => capability.capability === "FACT_LOCK",
		) ?? null;
	return evaluateCompositionBusinessPreflight({
		compositionVersionId,
		currentness,
		applicability: finalApplicability,
		applicabilityCapabilities: applicabilityResult.capabilities,
		factLock,
		mediaEligible,
		voiceEligible,
	});
}
