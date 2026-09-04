import type {
	ClaimSubject,
	ClaimSubjectSource,
	ClaimSubjectStatus,
	ProposedClaimSubject,
} from "../claim-subject/types";
import type {
	FactAssessment,
	FactGenerationUsability,
} from "../product-fact/freshness";
import type { ProductFactType } from "../product-fact/types";
import type {
	AiSettings,
	ChannelSettings,
	MediaMetadataSnapshot,
	OutputRules,
} from "./input-contract";

export const scriptGenerationStatuses = [
	"pending",
	"completed",
	"partial",
	"failed",
	"indeterminate",
] as const;
export type ScriptGenerationStatus = (typeof scriptGenerationStatuses)[number];

export const scriptGenerationModes = ["full", "repair"] as const;
export type ScriptGenerationMode = (typeof scriptGenerationModes)[number];

export const scriptGenerationSourceModes = [
	"PRODUCT_BACKED",
	"ORGANIC_NO_PRODUCT",
] as const;
export type ScriptGenerationSourceMode =
	(typeof scriptGenerationSourceModes)[number];

export const scriptGenerationSections = [
	"hook",
	"voiceover",
	"scenes",
	"cta",
	"caption",
	"hashtags",
	"disclosure",
	"claims",
] as const;
export type ScriptGenerationSection = (typeof scriptGenerationSections)[number];

export type ClaimOccurrence =
	| { section: "hook"; hookKey: string }
	| { section: "voiceover"; segmentKey: string }
	| { section: "scene"; sceneOrder: number }
	| { section: "cta" }
	| { section: "caption" };

export type ScriptDraft = {
	schemaVersion: string;
	language: string;
	hookVariants: Array<{ key: string; text: string }>;
	voiceoverSegments: Array<{ key: string; text: string }>;
	scenes: Array<{
		order: number;
		durationSeconds: number;
		visualDirection: string;
		onScreenText: string | null;
		voiceoverSegmentKeys: string[];
	}>;
	cta: { text: string };
	caption: string;
	hashtags: string[];
	disclosure: string;
	claims: Array<
		| { text: string; occurrence: ClaimOccurrence }
		| {
				text: string;
				occurrence: ClaimOccurrence;
				subject: ClaimSubject;
				subjectStatus: ClaimSubjectStatus;
				subjectSource: ClaimSubjectSource | null;
				proposedSubject?: ProposedClaimSubject;
		  }
	>;
};

export type PartialScriptDraft = {
	schemaVersion: string;
	language: string;
} & Partial<Omit<ScriptDraft, "schemaVersion" | "language">>;

export type ScriptGenerationFactSnapshot = {
	id: string;
	revision: number;
	content: string;
	type: ProductFactType;
	assessment: FactAssessment;
	generationUsability: FactGenerationUsability;
	source: {
		type: string | null;
		label: string | null;
		url: string | null;
		confirmedAt: string | null;
		expiresAt: string | null;
	};
};

type ScriptGenerationSnapshotBase = {
	snapshotVersion: string;
	request: {
		mode: ScriptGenerationMode;
		repair: null | {
			parentGenerationId: string;
			sections: ScriptGenerationSection[];
			baseOutput: PartialScriptDraft;
			baseValidSections?: ScriptGenerationSection[];
			baseInvalidSections?: ScriptGenerationSection[];
		};
	};
	project: {
		id: string;
		name: string;
	};
	contentBrief: {
		platform: "tiktok";
		goal: string;
		durationSeconds: number;
		angle: string;
		description: string | null;
	};
	product?: {
		id: string;
		name: string;
		category: string | null;
	} | null;
	channelSettings: ChannelSettings;
	mediaMetadata: MediaMetadataSnapshot[];
	outputRules: OutputRules;
	generationConfig: Pick<AiSettings, "textProvider" | "textModel"> & {
		promptVersion: string;
		outputSchemaVersion: string;
	};
	facts?: ScriptGenerationFactSnapshot[];
};

export type AffiliateScriptGenerationInputSnapshot =
	ScriptGenerationSnapshotBase & {
		snapshotVersion: typeof import("./policy").SCRIPT_SNAPSHOT_VERSION;
		product: { id: string; name: string; category: string | null };
		facts: ScriptGenerationFactSnapshot[];
	};

export type OrganicScriptGenerationInputSnapshot = Omit<
	ScriptGenerationSnapshotBase,
	"product"
> & {
	snapshotVersion: typeof import("./policy").ORGANIC_SCRIPT_SNAPSHOT_VERSION;
	sourceMode: "ORGANIC_NO_PRODUCT";
	project: ScriptGenerationSnapshotBase["project"] & {
		contentType: "ORGANIC";
		creationPath: "SCRIPTED";
		contentFormat: "SCRIPTED_STANDARD";
		contentFormatVersion: 1;
	};
};

// Runtime readers accept both frozen v2 and additive v3 payloads.  The
// version-specific aliases above remain available for strategy code, while
// this boundary keeps historical fixture literals source-compatible.
export type ScriptGenerationInputSnapshot = ScriptGenerationSnapshotBase & {
	snapshotVersion: string;
	sourceMode?: "ORGANIC_NO_PRODUCT";
	project: ScriptGenerationSnapshotBase["project"] &
		Partial<{
			contentType: "ORGANIC" | "AFFILIATE";
			creationPath: "SCRIPTED" | "QUICK_IMAGE" | "MEDIA_FIRST";
			contentFormat: string;
			contentFormatVersion: number;
		}>;
	product?: { id: string; name: string; category: string | null } | null;
	facts?: ScriptGenerationFactSnapshot[];
};

export type ScriptGenerationArtifact = {
	id: string;
	workspaceId: string;
	projectId: string;
	createdByUserId: string;
	idempotencyKey: string;
	requestHash: string;
	parentGenerationId: string | null;
	mode: ScriptGenerationMode;
	provider: string;
	model: string;
	promptVersion: string;
	outputSchemaVersion: string;
	inputSnapshot: ScriptGenerationInputSnapshot;
	inputHash: string;
	promptHash: string;
	status: ScriptGenerationStatus;
	output: PartialScriptDraft | null;
	validSections: ScriptGenerationSection[];
	invalidSections: ScriptGenerationSection[];
	providerRequestId: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	estimatedCostMicros: bigint | null;
	actualCostMicros: bigint | null;
	currency: string | null;
	errorCode: string | null;
	finishedAt: Date | null;
	createdAt: Date;
};

export type ScriptGenerationContext = Omit<
	ScriptGenerationInputSnapshot,
	"snapshotVersion" | "request" | "channelSettings" | "product" | "facts"
> & {
	channelSettings: ChannelSettings | null;
	product: { id: string; name: string; category: string | null } | null;
	facts: ScriptGenerationFactSnapshot[];
	sourceMode?: ScriptGenerationSourceMode;
};

export type ScriptGenerationDependencyState = {
	state: "current" | "invalidated";
	invalidatedFactCount: number;
};

export type ScriptGenerationReadModel = {
	context: ScriptGenerationContext;
	latestRequest: ScriptGenerationArtifact | null;
	latestUsableArtifact: ScriptGenerationArtifact | null;
	dependencyState: ScriptGenerationDependencyState | null;
};

export type ScriptGenerationArtifactReadModel = Omit<
	ScriptGenerationReadModel,
	"context"
>;
