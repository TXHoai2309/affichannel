import type { ClaimInventorySummary } from "../claim-subject/types";
import {
	classifyLegacyProject,
	LEGACY_AFFILIATE_IDENTITY,
} from "../project/legacy-affiliate-compatibility";
import type {
	ApplicabilityCapability,
	ApplicabilityCapabilityResult,
	ApplicabilityCompletion,
	ApplicabilityReasonCode,
	ApplicabilityState,
	ProjectApplicabilityInput,
	ProjectApplicabilityResult,
} from "./types";

function result(
	capability: ApplicabilityCapability,
	state: ApplicabilityState,
	completion: ApplicabilityCompletion,
	reasonCode: ApplicabilityReasonCode,
	dependencies: ApplicabilityCapabilityResult["dependencies"],
): ApplicabilityCapabilityResult {
	return { capability, state, completion, reasonCode, dependencies };
}

function invalidIdentityResult(
	input: ProjectApplicabilityInput,
	reasonCode: ApplicabilityReasonCode,
): ProjectApplicabilityResult {
	const identityDependency = [
		{ dependency: "PROJECT_IDENTITY" as const, status: "UNSUPPORTED" as const },
	];
	const capabilities = [
		result("PRODUCT", "BLOCKED", "NOT_STARTED", reasonCode, [
			...identityDependency,
			{
				dependency: "PRODUCT_LINK",
				status: input.projectIdentity.hasProduct ? "CURRENT" : "MISSING",
			},
		]),
		result(
			"SCRIPT",
			"BLOCKED",
			"NOT_STARTED",
			"PROJECT_IDENTITY_UNSUPPORTED",
			identityDependency,
		),
		result(
			"FACT_LOCK",
			"BLOCKED",
			"NOT_STARTED",
			"PROJECT_IDENTITY_UNSUPPORTED",
			identityDependency,
		),
		result(
			"VOICE",
			"BLOCKED",
			"NOT_STARTED",
			"PROJECT_IDENTITY_UNSUPPORTED",
			identityDependency,
		),
		result(
			"RENDER",
			"BLOCKED",
			"NOT_STARTED",
			"PROJECT_IDENTITY_UNSUPPORTED",
			identityDependency,
		),
	];
	return { capabilities, nextApplicableStep: "PRODUCT" };
}

function isCurrentAffiliateIdentity(input: ProjectApplicabilityInput) {
	const classification = classifyLegacyProject(input.projectIdentity);
	if (classification.kind === "candidate") return true;
	if (classification.kind === "exception") return false;
	return (
		input.projectIdentity.contentType ===
			LEGACY_AFFILIATE_IDENTITY.contentType &&
		input.projectIdentity.creationPath ===
			LEGACY_AFFILIATE_IDENTITY.creationPath &&
		input.projectIdentity.contentFormatKey ===
			LEGACY_AFFILIATE_IDENTITY.contentFormat.key &&
		input.projectIdentity.contentFormatVersion ===
			LEGACY_AFFILIATE_IDENTITY.contentFormat.version
	);
}

function isOrganicScriptedIdentity(input: ProjectApplicabilityInput) {
	return (
		input.projectIdentity.contentType === "ORGANIC" &&
		input.projectIdentity.creationPath === "SCRIPTED" &&
		input.projectIdentity.contentFormatKey === "SCRIPTED_STANDARD" &&
		input.projectIdentity.contentFormatVersion === 1
	);
}

function claimSummary(input: ProjectApplicabilityInput): ClaimInventorySummary {
	return (
		input.claimSummary ??
		input.script.claimSummary ?? {
			status: "UNKNOWN",
			subjectResolution: "UNKNOWN",
			productClaimState: "UNKNOWN",
			productClaimCount: null,
			generalClaimCount: null,
		}
	);
}

function deriveAffiliateProduct(
	input: ProjectApplicabilityInput,
): ApplicabilityCapabilityResult {
	if (!input.projectIdentity.hasProduct) {
		return result(
			"PRODUCT",
			"BLOCKED",
			"NOT_STARTED",
			"AFFILIATE_PRODUCT_NOT_LINKED",
			[{ dependency: "PRODUCT_LINK", status: "MISSING" }],
		);
	}
	if (!input.product.accessible) {
		return result(
			"PRODUCT",
			"BLOCKED",
			"IN_PROGRESS",
			"PRODUCT_NOT_ACCESSIBLE",
			[{ dependency: "PRODUCT_LINK", status: "INACCESSIBLE" }],
		);
	}
	return result("PRODUCT", "READY", "COMPLETE", "PRODUCT_READY", [
		{ dependency: "PRODUCT_LINK", status: "CURRENT" },
	]);
}

function deriveOrganicProduct(
	input: ProjectApplicabilityInput,
): ApplicabilityCapabilityResult {
	const summary = claimSummary(input);
	if (!input.script.currentVersionPresent) {
		return result(
			"PRODUCT",
			"NOT_REQUIRED",
			"NOT_STARTED",
			"PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
			[{ dependency: "PRODUCT_LINK", status: "NOT_STARTED" }],
		);
	}
	if (summary.status === "STALE") {
		return result(
			"PRODUCT",
			"BLOCKED",
			"IN_PROGRESS",
			"SCRIPT_CLAIMS_NOT_CURRENT",
			[{ dependency: "SCRIPT_VERSION", status: "CURRENT" }],
		);
	}
	if (summary.status === "UNKNOWN") {
		return result(
			"PRODUCT",
			"BLOCKED",
			"IN_PROGRESS",
			"CLAIM_SUBJECT_INVALID",
			[{ dependency: "SCRIPT_VERSION", status: "CURRENT" }],
		);
	}
	if (summary.subjectResolution === "NEEDS_CONFIRMATION") {
		return result(
			"PRODUCT",
			"BLOCKED",
			"IN_PROGRESS",
			"CLAIM_SUBJECT_CONFIRMATION_REQUIRED",
			[{ dependency: "SCRIPT_VERSION", status: "CURRENT" }],
		);
	}
	if (summary.productClaimState === "NONE") {
		return result(
			"PRODUCT",
			"NOT_REQUIRED",
			"NOT_STARTED",
			"PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
			[{ dependency: "PRODUCT_LINK", status: "NOT_STARTED" }],
		);
	}
	if (summary.productClaimState !== "PRESENT") {
		return result(
			"PRODUCT",
			"BLOCKED",
			"IN_PROGRESS",
			"CLAIM_SUBJECT_INVALID",
			[{ dependency: "SCRIPT_VERSION", status: "CURRENT" }],
		);
	}
	if (!input.projectIdentity.hasProduct) {
		return result(
			"PRODUCT",
			"REQUIRED",
			"NOT_STARTED",
			"PRODUCT_REQUIRED_FOR_PRODUCT_CLAIMS",
			[{ dependency: "PRODUCT_LINK", status: "MISSING" }],
		);
	}
	if (!input.product.accessible) {
		return result(
			"PRODUCT",
			"BLOCKED",
			"IN_PROGRESS",
			"PRODUCT_NOT_ACCESSIBLE",
			[{ dependency: "PRODUCT_LINK", status: "INACCESSIBLE" }],
		);
	}
	return result("PRODUCT", "READY", "COMPLETE", "PRODUCT_READY", [
		{ dependency: "PRODUCT_LINK", status: "CURRENT" },
	]);
}

function deriveAffiliateScript(
	input: ProjectApplicabilityInput,
	productResult: ApplicabilityCapabilityResult,
): ApplicabilityCapabilityResult {
	const dependencies: ApplicabilityCapabilityResult["dependencies"] = [
		{
			dependency: "PRODUCT_LINK",
			status: productResult.completion === "COMPLETE" ? "CURRENT" : "MISSING",
		},
		{
			dependency: "SCRIPT_GENERATION",
			status:
				input.script.generationStatus === "NONE"
					? "NOT_STARTED"
					: input.script.generationStatus === "USABLE"
						? "READY"
						: input.script.generationStatus,
		},
		{
			dependency: "SCRIPT_VERSION",
			status: input.script.currentVersionPresent ? "CURRENT" : "MISSING",
		},
	];

	if (productResult.completion !== "COMPLETE") {
		return result(
			"SCRIPT",
			"REQUIRED",
			"NOT_STARTED",
			"SCRIPT_REQUIRES_ACCESSIBLE_PRODUCT",
			dependencies,
		);
	}
	if (!input.script.channelSettingsComplete) {
		return result(
			"SCRIPT",
			"BLOCKED",
			"NOT_STARTED",
			"SCRIPT_CHANNEL_SETTINGS_INCOMPLETE",
			dependencies,
		);
	}
	if (!input.script.productFactsUsable) {
		return result(
			"SCRIPT",
			"BLOCKED",
			"NOT_STARTED",
			"SCRIPT_PRODUCT_FACTS_UNUSABLE",
			dependencies,
		);
	}
	if (input.script.currentVersionPresent) {
		return input.script.currentVersionFactLockReady
			? result("SCRIPT", "READY", "COMPLETE", "SCRIPT_READY", dependencies)
			: result(
					"SCRIPT",
					"BLOCKED",
					"IN_PROGRESS",
					"SCRIPT_VERSION_NOT_FACT_LOCK_READY",
					dependencies,
				);
	}
	if (
		input.script.usableGenerationPresent &&
		!input.script.sourceDependencyCurrent
	) {
		return result(
			"SCRIPT",
			"STALE",
			"IN_PROGRESS",
			"SCRIPT_SOURCE_DEPENDENCY_STALE",
			dependencies,
		);
	}
	if (input.script.generationStatus === "PENDING") {
		return result(
			"SCRIPT",
			"REQUIRED",
			"IN_PROGRESS",
			"SCRIPT_GENERATION_PENDING",
			dependencies,
		);
	}
	if (input.script.generationStatus === "FAILED") {
		return result(
			"SCRIPT",
			"BLOCKED",
			"IN_PROGRESS",
			"SCRIPT_GENERATION_FAILED",
			dependencies,
		);
	}
	if (input.script.generationStatus === "INDETERMINATE") {
		return result(
			"SCRIPT",
			"BLOCKED",
			"IN_PROGRESS",
			"SCRIPT_GENERATION_INDETERMINATE",
			dependencies,
		);
	}
	if (input.script.usableGenerationPresent) {
		return result(
			"SCRIPT",
			"READY",
			"IN_PROGRESS",
			"CURRENT_SCRIPT_VERSION_REQUIRED",
			dependencies,
		);
	}
	return result(
		"SCRIPT",
		"READY",
		"NOT_STARTED",
		"SCRIPT_GENERATION_REQUIRED",
		dependencies,
	);
}

/** Organic Scripted content has no Product/Facts prerequisite for generation. */
function deriveOrganicScript(
	input: ProjectApplicabilityInput,
): ApplicabilityCapabilityResult {
	const dependencies: ApplicabilityCapabilityResult["dependencies"] = [
		{
			dependency: "SCRIPT_GENERATION",
			status:
				input.script.generationStatus === "NONE"
					? "NOT_STARTED"
					: input.script.generationStatus === "USABLE"
						? "READY"
						: input.script.generationStatus,
		},
		{
			dependency: "SCRIPT_VERSION",
			status: input.script.currentVersionPresent ? "CURRENT" : "MISSING",
		},
	];
	if (!input.script.channelSettingsComplete) {
		return result(
			"SCRIPT",
			"BLOCKED",
			"NOT_STARTED",
			"SCRIPT_CHANNEL_SETTINGS_INCOMPLETE",
			dependencies,
		);
	}
	// Claim subject resolution is downstream policy metadata. A current script
	// remains complete while Product/Fact Lock can independently block.
	if (input.script.currentVersionPresent) {
		return result("SCRIPT", "READY", "COMPLETE", "SCRIPT_READY", dependencies);
	}
	if (
		input.script.usableGenerationPresent &&
		!input.script.sourceDependencyCurrent
	) {
		return result(
			"SCRIPT",
			"STALE",
			"IN_PROGRESS",
			"SCRIPT_SOURCE_DEPENDENCY_STALE",
			dependencies,
		);
	}
	if (input.script.generationStatus === "PENDING") {
		return result(
			"SCRIPT",
			"REQUIRED",
			"IN_PROGRESS",
			"SCRIPT_GENERATION_PENDING",
			dependencies,
		);
	}
	if (input.script.generationStatus === "FAILED") {
		return result(
			"SCRIPT",
			"BLOCKED",
			"IN_PROGRESS",
			"SCRIPT_GENERATION_FAILED",
			dependencies,
		);
	}
	if (input.script.generationStatus === "INDETERMINATE") {
		return result(
			"SCRIPT",
			"BLOCKED",
			"IN_PROGRESS",
			"SCRIPT_GENERATION_INDETERMINATE",
			dependencies,
		);
	}
	if (input.script.usableGenerationPresent) {
		return result(
			"SCRIPT",
			"READY",
			"IN_PROGRESS",
			"CURRENT_SCRIPT_VERSION_REQUIRED",
			dependencies,
		);
	}
	return result(
		"SCRIPT",
		"READY",
		"NOT_STARTED",
		"SCRIPT_GENERATION_REQUIRED",
		dependencies,
	);
}

function deriveAffiliateFactLock(
	input: ProjectApplicabilityInput,
): ApplicabilityCapabilityResult {
	const mapped = {
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
	const gateReason =
		input.factLock.gateReason === "FACT_LOCK_NOT_RUN" &&
		input.script.currentVersionPresent &&
		!input.script.currentVersionFactLockReady
			? "SCRIPT_NOT_READY"
			: input.factLock.gateReason;
	const [state, completion, reasonCode] = mapped[gateReason];
	const dependencies = [
		{
			dependency: "SCRIPT_VERSION",
			status: input.script.currentVersionPresent ? "CURRENT" : "MISSING",
		},
		{
			dependency: "FACT_LOCK_GATE",
			status:
				state === "READY" && completion === "COMPLETE"
					? "COMPLETE"
					: state === "STALE"
						? "STALE"
						: state === "BLOCKED"
							? "FAILED"
							: state === "REQUIRED" && completion === "IN_PROGRESS"
								? "PENDING"
								: "NOT_STARTED",
		},
	] as const satisfies ApplicabilityCapabilityResult["dependencies"];
	return result("FACT_LOCK", state, completion, reasonCode, dependencies);
}

function deriveOrganicFactLock(
	input: ProjectApplicabilityInput,
): ApplicabilityCapabilityResult {
	const summary = claimSummary(input);
	if (!input.script.currentVersionPresent) {
		return result(
			"FACT_LOCK",
			"NOT_REQUIRED",
			"NOT_STARTED",
			"FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
			[{ dependency: "FACT_LOCK_GATE", status: "NOT_STARTED" }],
		);
	}
	if (summary.status === "STALE") {
		return result(
			"FACT_LOCK",
			"STALE",
			"IN_PROGRESS",
			"SCRIPT_CLAIMS_NOT_CURRENT",
			[
				{ dependency: "SCRIPT_VERSION", status: "CURRENT" },
				{ dependency: "FACT_LOCK_GATE", status: "STALE" },
			],
		);
	}
	if (summary.status === "UNKNOWN") {
		return result(
			"FACT_LOCK",
			"BLOCKED",
			"IN_PROGRESS",
			"CLAIM_SUBJECT_INVALID",
			[
				{ dependency: "SCRIPT_VERSION", status: "CURRENT" },
				{ dependency: "FACT_LOCK_GATE", status: "FAILED" },
			],
		);
	}
	if (summary.subjectResolution === "NEEDS_CONFIRMATION") {
		return result(
			"FACT_LOCK",
			"BLOCKED",
			"IN_PROGRESS",
			"CLAIM_SUBJECT_CONFIRMATION_REQUIRED",
			[
				{ dependency: "SCRIPT_VERSION", status: "CURRENT" },
				{ dependency: "FACT_LOCK_GATE", status: "FAILED" },
			],
		);
	}
	if (summary.productClaimState === "NONE") {
		return result(
			"FACT_LOCK",
			"NOT_REQUIRED",
			"NOT_STARTED",
			"FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
			[{ dependency: "FACT_LOCK_GATE", status: "NOT_STARTED" }],
		);
	}
	if (summary.productClaimState !== "PRESENT") {
		return result(
			"FACT_LOCK",
			"BLOCKED",
			"IN_PROGRESS",
			"CLAIM_SUBJECT_INVALID",
			[
				{ dependency: "SCRIPT_VERSION", status: "CURRENT" },
				{ dependency: "FACT_LOCK_GATE", status: "FAILED" },
			],
		);
	}
	if (!input.projectIdentity.hasProduct) {
		return result(
			"FACT_LOCK",
			"BLOCKED",
			"NOT_STARTED",
			"PRODUCT_REQUIRED_FOR_PRODUCT_CLAIMS",
			[
				{ dependency: "PRODUCT_LINK", status: "MISSING" },
				{ dependency: "SCRIPT_VERSION", status: "CURRENT" },
			],
		);
	}
	if (!input.product.accessible) {
		return result(
			"FACT_LOCK",
			"BLOCKED",
			"IN_PROGRESS",
			"PRODUCT_NOT_ACCESSIBLE",
			[
				{ dependency: "PRODUCT_LINK", status: "INACCESSIBLE" },
				{ dependency: "SCRIPT_VERSION", status: "CURRENT" },
			],
		);
	}
	// Organic v3 Fact Lock execution is intentionally not cut over in 19C.1.
	// Reuse the established lifecycle mapping for the policy/read model while
	// treating the current ScriptVersion as structurally ready for this branch.
	return deriveAffiliateFactLock({
		...input,
		script: {
			...input.script,
			currentVersionFactLockReady: true,
		},
	});
}

function deriveVoice(
	input: ProjectApplicabilityInput,
	factLockResult: ApplicabilityCapabilityResult,
): ApplicabilityCapabilityResult {
	const dependencies: ApplicabilityCapabilityResult["dependencies"] = [
		{
			dependency: "FACT_LOCK_GATE",
			status:
				factLockResult.state === "NOT_REQUIRED"
					? "NOT_STARTED"
					: factLockResult.completion === "COMPLETE"
						? "COMPLETE"
						: factLockResult.state === "STALE"
							? "STALE"
							: "INCOMPLETE",
		},
		{
			dependency: "VOICE_CONFIG",
			status: input.voice.configPresent ? "CURRENT" : "MISSING",
		},
		{
			dependency: "VOICE_SEGMENTS",
			status:
				input.voice.usableSegments === input.voice.totalSegments &&
				input.voice.totalSegments > 0
					? "COMPLETE"
					: "INCOMPLETE",
			total: input.voice.totalSegments,
			current: input.voice.usableSegments,
		},
	];

	if (input.voice.staleSegments > 0) {
		return result(
			"VOICE",
			"STALE",
			"IN_PROGRESS",
			"VOICE_ARTIFACTS_STALE",
			dependencies,
		);
	}
	if (
		factLockResult.state !== "NOT_REQUIRED" &&
		factLockResult.completion !== "COMPLETE"
	) {
		const concreteBlock =
			factLockResult.state === "BLOCKED" || factLockResult.state === "STALE";
		return result(
			"VOICE",
			concreteBlock ? "BLOCKED" : "REQUIRED",
			input.voice.attemptedSegments > 0 ? "IN_PROGRESS" : "NOT_STARTED",
			concreteBlock
				? "VOICE_BLOCKED_BY_FACT_LOCK"
				: "VOICE_REQUIRES_FACT_LOCK_PASS",
			dependencies,
		);
	}
	if (!input.voice.configPresent) {
		return result(
			"VOICE",
			"READY",
			"NOT_STARTED",
			"VOICE_CONFIG_REQUIRED",
			dependencies,
		);
	}
	if (input.voice.failedSegments > 0) {
		return result(
			"VOICE",
			"BLOCKED",
			"IN_PROGRESS",
			"VOICE_SEGMENTS_FAILED",
			dependencies,
		);
	}
	if (input.voice.indeterminateSegments > 0) {
		return result(
			"VOICE",
			"BLOCKED",
			"IN_PROGRESS",
			"VOICE_SEGMENTS_INDETERMINATE",
			dependencies,
		);
	}
	if (input.voice.pendingSegments > 0) {
		return result(
			"VOICE",
			"REQUIRED",
			"IN_PROGRESS",
			"VOICE_SEGMENTS_PENDING",
			dependencies,
		);
	}
	if (input.voice.attemptedSegments === 0) {
		return result(
			"VOICE",
			"READY",
			"IN_PROGRESS",
			"VOICE_SEGMENTS_REQUIRED",
			dependencies,
		);
	}
	if (
		input.voice.totalSegments === 0 ||
		input.voice.usableSegments < input.voice.totalSegments
	) {
		return result(
			"VOICE",
			"READY",
			"IN_PROGRESS",
			"VOICE_SEGMENTS_INCOMPLETE",
			dependencies,
		);
	}
	return result("VOICE", "READY", "COMPLETE", "VOICE_READY", dependencies);
}

function deriveRender(
	input: ProjectApplicabilityInput,
	upstream: readonly ApplicabilityCapabilityResult[],
): ApplicabilityCapabilityResult {
	const upstreamReady = upstream.every(
		(item) => item.state === "READY" && item.completion === "COMPLETE",
	);
	const dependencies: ApplicabilityCapabilityResult["dependencies"] = [
		{
			dependency: "VOICE_SEGMENTS",
			status: upstreamReady ? "COMPLETE" : "INCOMPLETE",
		},
		{ dependency: "RENDER_IMPLEMENTATION", status: "NOT_IMPLEMENTED" },
	];
	if (!upstreamReady) {
		return result(
			"RENDER",
			"REQUIRED",
			"NOT_STARTED",
			"RENDER_REQUIRES_UPSTREAM_CAPABILITIES",
			dependencies,
		);
	}
	if (input.render.inputsStale) {
		return result(
			"RENDER",
			"STALE",
			"IN_PROGRESS",
			"RENDER_INPUTS_STALE",
			dependencies,
		);
	}
	// The route exists, but no Render capability exists in the current repository.
	return result(
		"RENDER",
		"BLOCKED",
		"NOT_STARTED",
		"RENDER_FEATURE_NOT_IMPLEMENTED",
		dependencies,
	);
}

export function deriveNextApplicableStep(
	capabilities: readonly ApplicabilityCapabilityResult[],
): ApplicabilityCapability | null {
	for (const capability of capabilities) {
		if (capability.state === "NOT_REQUIRED") continue;
		if (capability.state === "OPTIONAL") continue;
		if (capability.state === "READY" && capability.completion === "COMPLETE") {
			continue;
		}
		return capability.capability;
	}
	return null;
}

/** Pure M4 policy. Mandatory policy is not inferred from state === REQUIRED. */
export function resolveProjectApplicability(
	input: ProjectApplicabilityInput,
): ProjectApplicabilityResult {
	const classification = classifyLegacyProject(input.projectIdentity);
	if (classification.kind === "exception") {
		const productReason =
			classification.reasonCode === "AFFILIATE_PRODUCT_MISSING" ||
			classification.reasonCode === "LEGACY_PROJECT_WITHOUT_PRODUCT"
				? "AFFILIATE_PRODUCT_NOT_LINKED"
				: "PROJECT_IDENTITY_UNSUPPORTED";
		return invalidIdentityResult(input, productReason);
	}
	if (!isCurrentAffiliateIdentity(input)) {
		if (!isOrganicScriptedIdentity(input)) {
			return invalidIdentityResult(input, "PROJECT_IDENTITY_UNSUPPORTED");
		}
	}

	const organic = isOrganicScriptedIdentity(input);
	const product = organic
		? deriveOrganicProduct(input)
		: deriveAffiliateProduct(input);
	const script = organic
		? deriveOrganicScript(input)
		: deriveAffiliateScript(input, product);
	const factLock = organic
		? deriveOrganicFactLock(input)
		: deriveAffiliateFactLock(input);
	const voice = deriveVoice(input, factLock);
	const render = deriveRender(input, [product, script, factLock, voice]);
	const capabilities = [product, script, factLock, voice, render];
	return {
		capabilities,
		nextApplicableStep: deriveNextApplicableStep(capabilities),
	};
}
