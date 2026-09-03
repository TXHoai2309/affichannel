import {
	mergeScriptVersionAutosave,
	ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
	ORGANIC_SCRIPT_PROMPT_VERSION,
	ORGANIC_SCRIPT_SNAPSHOT_VERSION,
	parseScriptClaimByOutputVersion,
	scriptVersionEditableSnapshotSchema,
	validateOrganicScriptDraftOutput,
	validateRepairOrganicScriptOutput,
} from "@affichannel/core";
import type { OrganicScriptGenerationInputSnapshot } from "@affichannel/core/script-generation/types";
import { DeterministicTextProvider } from "../packages/api/src/providers/text/deterministic-text-provider.ts";
import { renderScriptPrompt } from "../packages/api/src/services/script-prompt.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const snapshot: OrganicScriptGenerationInputSnapshot = {
	snapshotVersion: ORGANIC_SCRIPT_SNAPSHOT_VERSION,
	sourceMode: "ORGANIC_NO_PRODUCT",
	request: { mode: "full", repair: null },
	project: {
		id: "organic-project",
		name: "Organic Scripted",
		contentType: "ORGANIC",
		creationPath: "SCRIPTED",
		contentFormat: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
	},
	contentBrief: {
		platform: "tiktok",
		goal: "Xây kênh",
		durationSeconds: 30,
		angle: "Chia sẻ thói quen hữu ích",
		description:
			"Kể một câu chuyện ngắn về việc hình thành thói quen đọc sách mỗi tối.",
	},
	channelSettings: {
		niche: "Học tập",
		targetAudience: "Người trẻ",
		tone: "Ấm áp",
		contentPillar: "Giá trị thực tế",
		defaultCta: "Theo dõi kênh",
		affiliateDisclosure: "Nội dung có liên kết affiliate.",
		avoidWords: [],
	},
	mediaMetadata: [],
	outputRules: {
		language: "vi-VN",
		aspectRatio: "9:16",
		subtitleSafeArea: "center",
		claimLimit: 64,
		requireFinalCta: true,
	},
	generationConfig: {
		textProvider: "deterministic",
		textModel: "organic-test",
		promptVersion: ORGANIC_SCRIPT_PROMPT_VERSION,
		outputSchemaVersion: ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
	},
};

const request = {
	messages: [
		{ role: "system" as const, content: "trusted" },
		{ role: "developer" as const, content: "schema" },
		{ role: "user" as const, content: "organic" },
	],
	model: "organic-test",
	mode: "full" as const,
	sections: [
		"hook",
		"voiceover",
		"scenes",
		"cta",
		"caption",
		"hashtags",
		"disclosure",
		"claims",
	],
	idempotencyKey: "organic-test-key",
};

const prompt = renderScriptPrompt(snapshot);
assert(
	prompt.trustedInstructions.includes("Organic"),
	"Organic prompt policy missing.",
);
assert(
	prompt.outputSchema.includes("script-draft.v3"),
	"Organic prompt must use v3.",
);
assert(
	!prompt.untrustedInputData.includes('"product"'),
	"Organic provider input contains a Product object.",
);
assert(
	!prompt.untrustedInputData.includes('"facts"'),
	"Organic provider input contains Product Facts.",
);

const provider = new DeterministicTextProvider({ snapshot });
const valid = await provider.generate(request);
assert(
	validateOrganicScriptDraftOutput(valid.content, 30, 64, {
		expectedLanguage: "vi-VN",
	}).status === "completed",
	"Storytelling Organic output must validate.",
);

for (const scenario of [
	"organic_general_proposal",
	"organic_zero_claims",
] as const) {
	const result = await new DeterministicTextProvider({
		snapshot,
		scenario,
	}).generate(request);
	const validation = validateOrganicScriptDraftOutput(result.content, 30, 64, {
		expectedLanguage: "vi-VN",
	});
	assert(
		validation.status === "completed" && validation.output,
		`${scenario} must complete.`,
	);
	if (scenario === "organic_general_proposal") {
		const claim = validation.output.claims?.[0];
		assert(
			claim &&
				"subjectStatus" in claim &&
				claim.subjectStatus === "NEEDS_CONFIRMATION" &&
				claim.subjectSource === null &&
				claim.proposedSubject === "GENERAL",
			"GENERAL provider proposal must remain unresolved.",
		);
	} else {
		assert(
			validation.output.claims?.length === 0,
			"Zero-claim Organic output must stay empty.",
		);
	}
}

const productProposal = await new DeterministicTextProvider({
	snapshot,
	scenario: "organic_product_proposal",
}).generate(request);
const rejected = validateOrganicScriptDraftOutput(
	productProposal.content,
	30,
	64,
	{
		expectedLanguage: "vi-VN",
	},
);
assert(
	rejected.status === "failed" &&
		rejected.issueCodes.includes("ORGANIC_PRODUCT_CLAIM_PROPOSAL"),
	"PRODUCT proposal must fail closed without coercion or deletion.",
);

const affiliateDisclosure = validateOrganicScriptDraftOutput(
	{
		...(valid.content as Record<string, unknown>),
		disclosure: "Có liên kết affiliate.",
	},
	30,
	64,
	{ expectedLanguage: "vi-VN" },
);
assert(
	affiliateDisclosure.status === "failed" &&
		affiliateDisclosure.issueCodes.includes("DISCLOSURE_POLICY_INVALID"),
	"Organic output must not carry Affiliate disclosure text.",
);

const malformed = {
	...(valid.content as Record<string, unknown>),
	claims: [
		{
			text: "Một nhận xét",
			occurrence: { section: "voiceover", segmentKey: "intro" },
			proposedSubject: "GENERAL",
			subject: { kind: "PRODUCT" },
		},
	],
};
assert(
	validateOrganicScriptDraftOutput(malformed, 30, 64, {
		expectedLanguage: "vi-VN",
	}).status === "failed",
	"Malformed Organic subject must fail closed.",
);

const repairRaw = await new DeterministicTextProvider({ snapshot }).generate({
	...request,
	mode: "repair",
	sections: ["cta"],
});
assert(
	validateRepairOrganicScriptOutput(repairRaw.content, ["cta"], 64, {
		expectedLanguage: "vi-VN",
	}).success,
	"Organic repair output must remain v3.",
);

const v3Claim = {
	text: "Một mẹo học tập",
	occurrence: { section: "caption" as const },
	subject: { kind: "GENERAL" as const },
	subjectStatus: "NEEDS_CONFIRMATION" as const,
	subjectSource: null,
	proposedSubject: "GENERAL" as const,
};
assert(
	parseScriptClaimByOutputVersion({
		version: "script-draft.v3",
		claim: v3Claim,
	}),
	"v3 claim parser rejected valid claim.",
);

const editable = {
	...(valid.content as Record<string, unknown>),
	selectedHookKey: "curiosity",
	claimsSourceRevision: 1,
	claimsStatus: "current",
	claims: [v3Claim],
};
const parsedEditable = scriptVersionEditableSnapshotSchema.safeParse(editable);
assert(
	parsedEditable.success,
	"ScriptVersion must accept v3 subject-aware snapshots.",
);
const submitted = {
	...editable,
	caption: "Sửa một đoạn chữ, không đổi claim metadata.",
};
const merged = mergeScriptVersionAutosave(
	parsedEditable.data,
	submitted as typeof parsedEditable.data,
);
assert(
	merged?.claims[0] && "proposedSubject" in merged.claims[0],
	"Autosave dropped proposedSubject.",
);
assert(
	"subjectStatus" in merged.claims[0] &&
		merged.claims[0].subjectStatus === "NEEDS_CONFIRMATION",
	"Autosave changed claim authority.",
);

console.log("Organic ScriptGeneration v3 deterministic contract tests passed.");
