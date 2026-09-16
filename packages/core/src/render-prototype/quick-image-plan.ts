import { z } from "zod";

import { sha256Hex } from "../claim-manifest/canonicalization";
import { canonicalizeCompositionJson } from "../composition/canonicalization";
import {
	fingerprintVideoOnlyOutputProfile,
	MP4_H264_VIDEO_ONLY_V1,
	type VideoOnlyOutputProfile,
	videoOnlyOutputProfileSchema,
} from "../composition/output-profile";
import { VERTICAL_STANDARD_PROFILE } from "../composition/profile";
import {
	type CompositionInputV2,
	canonicalCompositionSemanticJsonV2,
	compositionInputV2Schema,
	QUICK_IMAGE_MEDIA_DEPENDENCY_KEY,
	QUICK_IMAGE_MEDIA_DEPENDENCY_ROLE,
	quickImageMotionSchema,
} from "../composition/v2";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const QUICK_IMAGE_RENDER_PLAN_SCHEMA_VERSION =
	"quick-image-render-plan.v1" as const;
export const QUICK_IMAGE_OUTPUT_CONTRACT_VERSION =
	"quick-image-output.v1" as const;
export const QUICK_IMAGE_RENDER_PLAN_KIND = "QUICK_IMAGE" as const;

const quickImageFrameCountSchema = z.union([
	z.literal(150),
	z.literal(300),
	z.literal(450),
]);

const quickImageDurationSchema = z.union([
	z.literal(5),
	z.literal(10),
	z.literal(15),
]);

const quickImageRenderSourceSchema = z
	.object({
		dependencyKey: z.literal(QUICK_IMAGE_MEDIA_DEPENDENCY_KEY),
		role: z.literal(QUICK_IMAGE_MEDIA_DEPENDENCY_ROLE),
		workspaceId: z.string().min(1),
		projectId: z.string().min(1),
		mediaAssetId: z.string().min(1),
		checksumSha256: sha256Schema,
		storageProvider: z.enum(["local", "r2"]),
		storageKey: z.string().trim().min(1),
		mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
		byteSize: z.number().int().positive().safe(),
		width: z.number().int().positive().safe(),
		height: z.number().int().positive().safe(),
	})
	.strict();

const quickImageRenderPlanDraftSchema = z
	.object({
		schemaVersion: z.literal(QUICK_IMAGE_RENDER_PLAN_SCHEMA_VERSION),
		kind: z.literal(QUICK_IMAGE_RENDER_PLAN_KIND),
		compositionVersionId: z.string().trim().min(1),
		compositionFingerprint: sha256Schema,
		compositionInput: compositionInputV2Schema,
		source: quickImageRenderSourceSchema,
		outputProfile: videoOnlyOutputProfileSchema,
		outputProfileFingerprint: sha256Schema,
		outputContractVersion: z.literal(QUICK_IMAGE_OUTPUT_CONTRACT_VERSION),
		timeline: z
			.object({
				fps: z
					.object({ numerator: z.literal(30), denominator: z.literal(1) })
					.strict(),
				durationSeconds: quickImageDurationSchema,
				totalFrames: quickImageFrameCountSchema,
			})
			.strict(),
		motion: quickImageMotionSchema,
		fit: z.literal("CENTERED_COVER"),
		audio: z.literal("NONE"),
		text: z.literal("NONE"),
	})
	.strict()
	.superRefine((plan, context) => {
		const input = plan.compositionInput;
		const dependency = input.media[0];
		if (
			input.workspaceId !== plan.source.workspaceId ||
			input.projectId !== plan.source.projectId ||
			input.source.mediaAssetId !== plan.source.mediaAssetId ||
			input.source.checksumSha256 !== plan.source.checksumSha256 ||
			input.source.storageProvider !== plan.source.storageProvider ||
			input.source.storageKey !== plan.source.storageKey ||
			input.source.mimeType !== plan.source.mimeType ||
			input.source.byteSize !== plan.source.byteSize ||
			input.source.width !== plan.source.width ||
			input.source.height !== plan.source.height ||
			dependency?.dependencyKey !== plan.source.dependencyKey ||
			dependency?.role !== plan.source.role ||
			dependency?.provenance.mediaAssetId !== plan.source.mediaAssetId ||
			dependency?.provenance.workspaceId !== plan.source.workspaceId ||
			dependency?.provenance.projectId !== plan.source.projectId ||
			dependency?.semantic.checksumSha256 !== plan.source.checksumSha256 ||
			dependency?.semantic.byteSize !== plan.source.byteSize ||
			dependency?.semantic.width !== plan.source.width ||
			dependency?.semantic.height !== plan.source.height ||
			dependency?.semantic.mimeType !== plan.source.mimeType
		) {
			context.addIssue({
				code: "custom",
				path: ["source"],
				message: "Render source must exactly match the frozen V2 dependency.",
			});
		}
		if (
			plan.timeline.durationSeconds !== input.source.durationSeconds ||
			plan.timeline.totalFrames !== Number(input.timeline.totalFrames) ||
			plan.timeline.fps.numerator !== input.timeline.fps.numerator ||
			plan.timeline.fps.denominator !== input.timeline.fps.denominator ||
			JSON.stringify(plan.motion) !== JSON.stringify(input.motion) ||
			plan.compositionFingerprint.length !== 64
		) {
			context.addIssue({
				code: "custom",
				path: ["timeline"],
				message: "Render plan must preserve the frozen V2 timeline and motion.",
			});
		}
	});

export const quickImageRenderPlanSchema = quickImageRenderPlanDraftSchema.and(
	z.object({ planFingerprint: sha256Schema }).strict(),
);

export type QuickImageRenderPlanDraft = z.infer<
	typeof quickImageRenderPlanDraftSchema
>;
export type QuickImageRenderPlan = z.infer<typeof quickImageRenderPlanSchema>;
export type QuickImageRenderPlanSource = QuickImageRenderPlan["source"];

export function quickImageRenderPlanSemanticProjection(
	plan: QuickImageRenderPlanDraft | QuickImageRenderPlan,
) {
	return {
		schemaVersion: plan.schemaVersion,
		kind: plan.kind,
		compositionFingerprint: plan.compositionFingerprint,
		source: plan.source,
		outputProfile: plan.outputProfile,
		outputProfileFingerprint: plan.outputProfileFingerprint,
		outputContractVersion: plan.outputContractVersion,
		timeline: plan.timeline,
		motion: plan.motion,
		fit: plan.fit,
		audio: plan.audio,
		text: plan.text,
	};
}

export function canonicalQuickImageRenderPlanJson(
	plan: QuickImageRenderPlanDraft | QuickImageRenderPlan,
) {
	return canonicalizeCompositionJson(
		quickImageRenderPlanSemanticProjection(plan),
	);
}

export async function fingerprintQuickImageRenderPlan(
	plan: QuickImageRenderPlanDraft | QuickImageRenderPlan,
) {
	return sha256Hex(canonicalQuickImageRenderPlanJson(plan));
}

export async function createQuickImageRenderPlanDraft(input: {
	compositionVersionId: string;
	compositionFingerprint: string;
	compositionInput: CompositionInputV2;
	outputProfile?: VideoOnlyOutputProfile;
	outputProfileFingerprint?: string;
}): Promise<QuickImageRenderPlanDraft> {
	const expectedCompositionFingerprint = await sha256Hex(
		canonicalCompositionSemanticJsonV2(input.compositionInput),
	);
	if (expectedCompositionFingerprint !== input.compositionFingerprint)
		throw new Error("QUICK_IMAGE_PLAN_COMPOSITION_FINGERPRINT_MISMATCH");
	if (
		JSON.stringify(input.compositionInput.profile) !==
		JSON.stringify(VERTICAL_STANDARD_PROFILE)
	)
		throw new Error("QUICK_IMAGE_PLAN_PROFILE_INVALID");
	const outputProfile = input.outputProfile ?? MP4_H264_VIDEO_ONLY_V1;
	const outputProfileFingerprint =
		input.outputProfileFingerprint ??
		(await fingerprintVideoOnlyOutputProfile(outputProfile));
	if (
		(await fingerprintVideoOnlyOutputProfile(outputProfile)) !==
		outputProfileFingerprint
	)
		throw new Error("QUICK_IMAGE_PLAN_PROFILE_FINGERPRINT_MISMATCH");
	const source = input.compositionInput.source;
	const dependency = input.compositionInput.media[0];
	if (!dependency) throw new Error("QUICK_IMAGE_DEPENDENCY_MISSING");
	return quickImageRenderPlanDraftSchema.parse({
		schemaVersion: QUICK_IMAGE_RENDER_PLAN_SCHEMA_VERSION,
		kind: QUICK_IMAGE_RENDER_PLAN_KIND,
		compositionVersionId: input.compositionVersionId,
		compositionFingerprint: input.compositionFingerprint,
		compositionInput: input.compositionInput,
		source: {
			dependencyKey: dependency.dependencyKey,
			role: dependency.role,
			workspaceId: dependency.provenance.workspaceId,
			projectId: dependency.provenance.projectId,
			mediaAssetId: source.mediaAssetId,
			checksumSha256: source.checksumSha256,
			storageProvider: source.storageProvider,
			storageKey: source.storageKey,
			mimeType: source.mimeType,
			byteSize: source.byteSize,
			width: source.width,
			height: source.height,
		},
		outputProfile,
		outputProfileFingerprint,
		outputContractVersion: QUICK_IMAGE_OUTPUT_CONTRACT_VERSION,
		timeline: {
			fps: input.compositionInput.timeline.fps,
			durationSeconds: source.durationSeconds,
			totalFrames: Number(input.compositionInput.timeline.totalFrames),
		},
		motion: input.compositionInput.motion,
		fit: "CENTERED_COVER",
		audio: "NONE",
		text: "NONE",
	});
}

export async function createQuickImageRenderPlan(
	input: Parameters<typeof createQuickImageRenderPlanDraft>[0],
): Promise<QuickImageRenderPlan> {
	const draft = await createQuickImageRenderPlanDraft(input);
	return quickImageRenderPlanSchema.parse({
		...draft,
		planFingerprint: await fingerprintQuickImageRenderPlan(draft),
	});
}
