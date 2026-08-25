import type { ClaimOccurrence } from "../script-generation/types";

export const CLAIM_MANIFEST_SCHEMA_VERSION = "claim-manifest.v1" as const;
export const CLAIM_MANIFEST_BUILDER_VERSION =
	"claim-manifest-builder.v1" as const;
export const CLAIM_MANIFEST_MAX_CLAIMS = 64 as const;

export const claimManifestSourceTypes = [
	"SCRIPT_VERSION",
	"NO_SCRIPT",
] as const;
export type ClaimManifestSourceType = (typeof claimManifestSourceTypes)[number];

export const noScriptSourceElementKinds = [
	"OVERLAY",
	"CAPTION",
	"CTA",
	"VOICE_TEXT",
	"DECLARED_CLAIM",
	"COMPOSITION_ELEMENT",
] as const;
export type NoScriptSourceElementKind =
	(typeof noScriptSourceElementKinds)[number];

export type NoScriptSourceElement = Readonly<{
	kind: NoScriptSourceElementKind;
	key: string;
	revision: string;
	contentHash: string;
}>;

export type ScriptVersionClaimManifestSource = Readonly<{
	sourceType: "SCRIPT_VERSION";
	scriptVersionId: string;
	scriptVersionRevision: number;
	claimsSourceRevision: number;
	sourceContentHash: string;
}>;

export type NoScriptClaimManifestSource = Readonly<{
	sourceType: "NO_SCRIPT";
	sourceSchemaVersion: string;
	sourceRevision: string;
	elements: readonly NoScriptSourceElement[];
	sourceContentHash: string;
}>;

export type ClaimManifestSource =
	| ScriptVersionClaimManifestSource
	| NoScriptClaimManifestSource;

export type ScriptVersionClaimManifestLocator = Readonly<{
	sourceType: "SCRIPT_VERSION";
	occurrence: ClaimOccurrence;
}>;

export type NoScriptClaimManifestLocator = Readonly<{
	sourceType: "NO_SCRIPT";
	elementKind: NoScriptSourceElementKind;
	elementKey: string;
}>;

export type ClaimManifestLocator =
	| ScriptVersionClaimManifestLocator
	| NoScriptClaimManifestLocator;

export type ClaimManifestClaim = Readonly<{
	claimKey: string;
	claimText: string;
	locator: ClaimManifestLocator;
	sourceTextHash: string;
}>;

export type ClaimManifestSourceContentProjection = Readonly<{
	selectedHookKey: string;
	hookVariants: readonly Readonly<{ key: string; text: string }>[];
	voiceoverSegments: readonly Readonly<{ key: string; text: string }>[];
	scenes: readonly Readonly<{
		order: number;
		onScreenText: string | null;
	}>[];
	cta: Readonly<{ text: string }>;
	caption: string;
	claims: readonly Readonly<{
		text: string;
		occurrence: ClaimOccurrence;
	}>[];
}>;

export type ClaimManifestFingerprintProjection = Readonly<{
	domain: typeof CLAIM_MANIFEST_SCHEMA_VERSION;
	builderVersion: typeof CLAIM_MANIFEST_BUILDER_VERSION;
	workspaceId: string;
	projectId: string;
	source: ClaimManifestSource;
	productId: string | null;
	claims: readonly Readonly<{
		claimKey: string;
		claimText: string;
		locator: ClaimManifestLocator;
		sourceTextHash: string;
	}>[];
}>;

export type BuiltClaimManifest = Readonly<{
	workspaceId: string;
	projectId: string;
	source: ClaimManifestSource;
	productId: string | null;
	schemaVersion: typeof CLAIM_MANIFEST_SCHEMA_VERSION;
	builderVersion: typeof CLAIM_MANIFEST_BUILDER_VERSION;
	claims: readonly ClaimManifestClaim[];
	claimCount: number;
	isEmpty: boolean;
	fingerprint: string;
}>;

export type ClaimManifest = Readonly<
	BuiltClaimManifest & {
		id: string;
		createdByUserId: string;
		createdAt: Date;
	}
>;

export type BuildClaimManifestFromScriptVersionInput = Readonly<{
	workspaceId: string;
	projectId: string;
	productId: string | null;
	scriptVersionId: string;
	scriptVersionRevision: number;
	snapshot: unknown;
}>;
