import { buildSubjectAwareManifestClaimProjection } from "../claim-subject/manifest-projection";
import type { SubjectAwareScriptClaim } from "../claim-subject/types";
import { canonicalizeJson } from "../script-generation/canonical-json";
import {
	ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
	SCRIPT_OUTPUT_SCHEMA_VERSION,
} from "../script-generation/policy";
import type { ClaimOccurrence } from "../script-generation/types";
import { scriptVersionEditableSnapshotSchema } from "../script-version/schema";
import type { ScriptVersionEditableSnapshot } from "../script-version/types";
import {
	canonicalClaimManifestLocator,
	canonicalClaimSourceText,
	claimManifestSourceTextHash,
	sha256Hex,
} from "./canonicalization";
import { ClaimManifestError } from "./errors";
import {
	claimManifestFingerprint,
	subjectAwareClaimManifestFingerprint,
} from "./fingerprint";
import { buildClaimManifestFromScriptVersionInputSchema } from "./schema";
import type {
	BuildClaimManifestFromScriptVersionInput,
	BuiltClaimManifest,
	BuiltSubjectAwareClaimManifest,
	ClaimManifestClaim,
	ClaimManifestLocator,
	ClaimManifestSourceContentProjection,
	ScriptVersionClaimManifestLocator,
	SubjectAwareClaimManifestClaim,
} from "./types";
import {
	CLAIM_MANIFEST_BUILDER_VERSION,
	CLAIM_MANIFEST_BUILDER_VERSION_V2,
	CLAIM_MANIFEST_MAX_CLAIMS,
	CLAIM_MANIFEST_SCHEMA_VERSION,
} from "./types";

function immutable<T>(value: T): Readonly<T> {
	if (!value || typeof value !== "object" || Object.isFrozen(value))
		return value;
	for (const child of Object.values(value)) immutable(child);
	return Object.freeze(value);
}

function cloneOccurrence(occurrence: ClaimOccurrence): ClaimOccurrence {
	if (occurrence.section === "hook")
		return { section: "hook", hookKey: occurrence.hookKey };
	if (occurrence.section === "voiceover")
		return { section: "voiceover", segmentKey: occurrence.segmentKey };
	if (occurrence.section === "scene")
		return { section: "scene", sceneOrder: occurrence.sceneOrder };
	if (occurrence.section === "cta") return { section: "cta" };
	return { section: "caption" };
}

export function scriptVersionClaimManifestLocator(
	occurrence: ClaimOccurrence,
): ScriptVersionClaimManifestLocator {
	return {
		sourceType: "SCRIPT_VERSION",
		occurrence: cloneOccurrence(occurrence),
	};
}

export function assignSameLocatorOrdinals(
	locators: readonly ClaimManifestLocator[],
): number[] {
	const counts = new Map<string, number>();
	return locators.map((locator) => {
		const identity = canonicalClaimManifestLocator(locator);
		const ordinal = counts.get(identity) ?? 0;
		counts.set(identity, ordinal + 1);
		return ordinal;
	});
}

export function scriptVersionSourceContentProjection(
	snapshot: ScriptVersionEditableSnapshot,
): ClaimManifestSourceContentProjection {
	if (snapshot.selectedHookKey === null) {
		throw new ClaimManifestError("CLAIM_MANIFEST_SOURCE_NOT_USABLE", [
			"CLAIM_REFERENCE_INVALID",
		]);
	}
	const selectedHook = snapshot.hookVariants.find(
		(hook) => hook.key === snapshot.selectedHookKey,
	);
	if (!selectedHook) {
		throw new ClaimManifestError("CLAIM_MANIFEST_SOURCE_NOT_USABLE", [
			"CLAIM_REFERENCE_INVALID",
		]);
	}
	return {
		selectedHookKey: snapshot.selectedHookKey,
		hookVariants: [{ key: selectedHook.key, text: selectedHook.text }],
		voiceoverSegments: snapshot.voiceoverSegments.map((segment) => ({
			key: segment.key,
			text: segment.text,
		})),
		scenes: snapshot.scenes.map((scene) => ({
			order: scene.order,
			onScreenText: scene.onScreenText,
		})),
		cta: { text: snapshot.cta.text },
		caption: snapshot.caption,
		claims: snapshot.claims.map((claim) => ({
			text: claim.text,
			occurrence: cloneOccurrence(claim.occurrence),
		})),
	};
}

export async function scriptVersionSourceContentHash(
	snapshot: ScriptVersionEditableSnapshot,
): Promise<string> {
	return sha256Hex(scriptVersionSourceContentProjection(snapshot));
}

function comparisonText(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase("vi-VN")
		.replace(/\s+/g, " ")
		.trim();
}

function sourceTextForOccurrence(
	snapshot: ScriptVersionEditableSnapshot,
	occurrence: ClaimOccurrence,
): string | null {
	if (occurrence.section === "hook") {
		if (occurrence.hookKey !== snapshot.selectedHookKey) return null;
		return (
			snapshot.hookVariants.find((hook) => hook.key === occurrence.hookKey)
				?.text ?? null
		);
	}
	if (occurrence.section === "voiceover")
		return (
			snapshot.voiceoverSegments.find(
				(segment) => segment.key === occurrence.segmentKey,
			)?.text ?? null
		);
	if (occurrence.section === "scene")
		return (
			snapshot.scenes.find((scene) => scene.order === occurrence.sceneOrder)
				?.onScreenText ?? null
		);
	if (occurrence.section === "cta") return snapshot.cta.text;
	return snapshot.caption;
}

async function buildClaims(
	snapshot: ScriptVersionEditableSnapshot,
): Promise<ClaimManifestClaim[]> {
	const locators = snapshot.claims.map((claim) =>
		scriptVersionClaimManifestLocator(claim.occurrence),
	);
	const ordinals = assignSameLocatorOrdinals(locators);
	return Promise.all(
		snapshot.claims.map(async (claim, index) => {
			const locator = locators[index];
			const sameLocatorOrdinal = ordinals[index];
			if (!locator || sameLocatorOrdinal === undefined) {
				throw new ClaimManifestError("INVALID_CLAIM_MANIFEST", [
					"CLAIM_REFERENCE_INVALID",
				]);
			}
			const sourceText = sourceTextForOccurrence(snapshot, claim.occurrence);
			if (
				!sourceText ||
				!comparisonText(sourceText).includes(comparisonText(claim.text))
			) {
				throw new ClaimManifestError("CLAIM_MANIFEST_SOURCE_NOT_USABLE", [
					"CLAIM_REFERENCE_INVALID",
				]);
			}
			const claimKeyHash = await sha256Hex({
				sourceType: "SCRIPT_VERSION",
				locator,
				sameLocatorOrdinal,
				claimText: canonicalClaimSourceText(claim.text),
			});
			return {
				claimKey: `claim_${claimKeyHash}`,
				claimText: claim.text,
				locator,
				sourceTextHash: await claimManifestSourceTextHash(sourceText),
			};
		}),
	);
}

async function buildSubjectAwareClaims(
	snapshot: ScriptVersionEditableSnapshot,
): Promise<SubjectAwareClaimManifestClaim[]> {
	const locators = snapshot.claims.map((claim) =>
		scriptVersionClaimManifestLocator(claim.occurrence),
	);
	const ordinals = assignSameLocatorOrdinals(locators);
	return Promise.all(
		snapshot.claims.map(async (rawClaim, index) => {
			const locator = locators[index];
			const sameLocatorOrdinal = ordinals[index];
			if (!locator || sameLocatorOrdinal === undefined) {
				throw new ClaimManifestError("INVALID_CLAIM_MANIFEST", [
					"CLAIM_REFERENCE_INVALID",
				]);
			}
			const claim = rawClaim as SubjectAwareScriptClaim;
			if (
				claim.subjectStatus !== "CONFIRMED" ||
				(claim.subjectSource !== "USER" &&
					claim.subjectSource !== "STRUCTURED_SOURCE")
			) {
				throw new ClaimManifestError("CLAIM_MANIFEST_SOURCE_NOT_USABLE", [
					"INVALID_SOURCE",
				]);
			}
			const sourceText = sourceTextForOccurrence(snapshot, claim.occurrence);
			if (
				!sourceText ||
				!comparisonText(sourceText).includes(comparisonText(claim.text))
			) {
				throw new ClaimManifestError("CLAIM_MANIFEST_SOURCE_NOT_USABLE", [
					"CLAIM_REFERENCE_INVALID",
				]);
			}
			const claimKeyHash = await sha256Hex({
				sourceType: "SCRIPT_VERSION",
				locator,
				sameLocatorOrdinal,
				claimText: canonicalClaimSourceText(claim.text),
			});
			const projected = buildSubjectAwareManifestClaimProjection({
				claimKey: `claim_${claimKeyHash}`,
				claim,
				locator,
				sourceTextHash: await claimManifestSourceTextHash(sourceText),
			});
			return {
				...projected,
				subjectStatus: "CONFIRMED" as const,
				subjectSource: claim.subjectSource,
			};
		}),
	);
}

function rawClaimCount(snapshot: unknown): number | null {
	if (!snapshot || typeof snapshot !== "object" || !("claims" in snapshot))
		return null;
	const claims = (snapshot as { claims?: unknown }).claims;
	return Array.isArray(claims) ? claims.length : null;
}

export async function buildClaimManifestFromScriptVersion(
	rawInput: BuildClaimManifestFromScriptVersionInput,
): Promise<BuiltClaimManifest> {
	const input =
		buildClaimManifestFromScriptVersionInputSchema.safeParse(rawInput);
	if (!input.success) {
		throw new ClaimManifestError("INVALID_CLAIM_MANIFEST", ["INVALID_SOURCE"]);
	}
	if ((rawClaimCount(input.data.snapshot) ?? 0) > CLAIM_MANIFEST_MAX_CLAIMS) {
		throw new ClaimManifestError("CLAIM_MANIFEST_SOURCE_NOT_USABLE", [
			"CLAIM_LIMIT_EXCEEDED",
		]);
	}
	const snapshot = scriptVersionEditableSnapshotSchema.safeParse(
		input.data.snapshot,
	);
	if (!snapshot.success) {
		const rawSchemaVersion =
			input.data.snapshot !== null &&
			typeof input.data.snapshot === "object" &&
			"schemaVersion" in input.data.snapshot
				? (input.data.snapshot as { schemaVersion?: unknown }).schemaVersion
				: undefined;
		throw new ClaimManifestError("CLAIM_MANIFEST_SOURCE_NOT_USABLE", [
			rawSchemaVersion !== undefined &&
			rawSchemaVersion !== SCRIPT_OUTPUT_SCHEMA_VERSION
				? "UNSUPPORTED_SCHEMA_VERSION"
				: "INVALID_SOURCE",
		]);
	}
	if (snapshot.data.claimsStatus !== "current") {
		throw new ClaimManifestError("CLAIM_MANIFEST_SOURCE_NOT_USABLE", [
			"INVALID_SOURCE",
		]);
	}
	if (snapshot.data.claimsSourceRevision > input.data.scriptVersionRevision) {
		throw new ClaimManifestError("CLAIM_MANIFEST_SOURCE_NOT_USABLE", [
			"INVALID_SOURCE",
		]);
	}

	const projection = scriptVersionSourceContentProjection(snapshot.data);
	const sourceContentHash = await sha256Hex(projection);
	const claims = await buildClaims(snapshot.data);
	const source = {
		sourceType: "SCRIPT_VERSION" as const,
		scriptVersionId: input.data.scriptVersionId,
		scriptVersionRevision: input.data.scriptVersionRevision,
		claimsSourceRevision: snapshot.data.claimsSourceRevision,
		sourceContentHash,
	};
	const fingerprint = await claimManifestFingerprint({
		workspaceId: input.data.workspaceId,
		projectId: input.data.projectId,
		source,
		productId: input.data.productId,
		claims,
	});
	return immutable({
		workspaceId: input.data.workspaceId,
		projectId: input.data.projectId,
		source,
		productId: input.data.productId,
		schemaVersion: CLAIM_MANIFEST_SCHEMA_VERSION,
		builderVersion: CLAIM_MANIFEST_BUILDER_VERSION,
		claims,
		claimCount: claims.length,
		isEmpty: claims.length === 0,
		fingerprint,
	}) as BuiltClaimManifest;
}

/**
 * Builds the subject-aware Organic manifest while retaining the claim-manifest.v1
 * envelope. The full GENERAL + PRODUCT inventory is persisted; Fact Lock may
 * select its confirmed PRODUCT subset in a later phase.
 */
export async function buildSubjectAwareClaimManifestFromScriptVersion(
	rawInput: BuildClaimManifestFromScriptVersionInput,
): Promise<BuiltSubjectAwareClaimManifest> {
	const input =
		buildClaimManifestFromScriptVersionInputSchema.safeParse(rawInput);
	if (!input.success) {
		throw new ClaimManifestError("INVALID_CLAIM_MANIFEST", ["INVALID_SOURCE"]);
	}
	if ((rawClaimCount(input.data.snapshot) ?? 0) > CLAIM_MANIFEST_MAX_CLAIMS) {
		throw new ClaimManifestError("CLAIM_MANIFEST_SOURCE_NOT_USABLE", [
			"CLAIM_LIMIT_EXCEEDED",
		]);
	}
	const snapshot = scriptVersionEditableSnapshotSchema.safeParse(
		input.data.snapshot,
	);
	if (
		!snapshot.success ||
		snapshot.data.schemaVersion !== ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION
	) {
		throw new ClaimManifestError("CLAIM_MANIFEST_SOURCE_NOT_USABLE", [
			"INVALID_SOURCE",
		]);
	}
	if (
		snapshot.data.claimsStatus !== "current" ||
		snapshot.data.claimsSourceRevision !== input.data.scriptVersionRevision
	) {
		throw new ClaimManifestError("CLAIM_MANIFEST_SOURCE_NOT_USABLE", [
			"INVALID_SOURCE",
		]);
	}
	const projection = scriptVersionSourceContentProjection(snapshot.data);
	const sourceContentHash = await sha256Hex(projection);
	const claims = await buildSubjectAwareClaims(snapshot.data);
	const source = {
		sourceType: "SCRIPT_VERSION" as const,
		scriptVersionId: input.data.scriptVersionId,
		scriptVersionRevision: input.data.scriptVersionRevision,
		claimsSourceRevision: snapshot.data.claimsSourceRevision,
		sourceContentHash,
	};
	const fingerprint = await subjectAwareClaimManifestFingerprint({
		workspaceId: input.data.workspaceId,
		projectId: input.data.projectId,
		source,
		productId: input.data.productId,
		claims,
	});
	return immutable({
		workspaceId: input.data.workspaceId,
		projectId: input.data.projectId,
		source,
		productId: input.data.productId,
		schemaVersion: CLAIM_MANIFEST_SCHEMA_VERSION,
		builderVersion: CLAIM_MANIFEST_BUILDER_VERSION_V2,
		claims,
		claimCount: claims.length,
		isEmpty: claims.length === 0,
		fingerprint,
	}) as BuiltSubjectAwareClaimManifest;
}

export function selectConfirmedProductManifestClaims(
	manifest: BuiltSubjectAwareClaimManifest,
): readonly SubjectAwareClaimManifestClaim[] {
	return manifest.claims.filter(
		(claim) =>
			claim.subject.kind === "PRODUCT" && claim.subjectStatus === "CONFIRMED",
	);
}

export function canonicalSourceProjectionJson(
	snapshot: ScriptVersionEditableSnapshot,
): string {
	return canonicalizeJson(scriptVersionSourceContentProjection(snapshot));
}
