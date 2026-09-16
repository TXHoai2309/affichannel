import { z } from "zod";
import { sha256Hex } from "../claim-manifest/canonicalization";
import { canonicalizeCompositionJson } from "../composition/canonicalization";
import {
	fingerprintVideoOnlyOutputProfile,
	videoOnlyOutputProfileSchema,
} from "../composition/output-profile";
import {
	QUICK_IMAGE_OUTPUT_CONTRACT_VERSION,
	type QuickImageRenderPlan,
} from "./quick-image-plan";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const QUICK_IMAGE_RENDER_REQUEST_SCHEMA_VERSION =
	"render-request.quick-image.v1" as const;

export const quickImageRenderRequestSchema = z
	.object({
		schemaVersion: z.literal(QUICK_IMAGE_RENDER_REQUEST_SCHEMA_VERSION),
		compositionVersionId: z.string().trim().min(1),
		compositionFingerprint: sha256Schema,
		renderPlanFingerprint: sha256Schema,
		outputProfile: videoOnlyOutputProfileSchema,
		outputProfileFingerprint: sha256Schema,
		outputContractVersion: z.literal(QUICK_IMAGE_OUTPUT_CONTRACT_VERSION),
	})
	.strict();

export type QuickImageRenderRequest = z.infer<
	typeof quickImageRenderRequestSchema
>;

export async function fingerprintQuickImageRenderRequest(
	request: QuickImageRenderRequest,
) {
	const parsed = quickImageRenderRequestSchema.parse(request);
	const expectedProfileFingerprint = await fingerprintVideoOnlyOutputProfile(
		parsed.outputProfile,
	);
	if (expectedProfileFingerprint !== parsed.outputProfileFingerprint)
		throw new Error("QUICK_IMAGE_REQUEST_PROFILE_FINGERPRINT_MISMATCH");
	return sha256Hex(
		canonicalizeCompositionJson({
			inputVersion: QUICK_IMAGE_RENDER_REQUEST_SCHEMA_VERSION,
			compositionFingerprint: parsed.compositionFingerprint,
			renderPlanFingerprint: parsed.renderPlanFingerprint,
			outputProfileFingerprint: parsed.outputProfileFingerprint,
			outputContractVersion: parsed.outputContractVersion,
		}),
	);
}

export async function createQuickImageRenderRequest(
	plan: QuickImageRenderPlan,
): Promise<QuickImageRenderRequest> {
	const outputProfile = videoOnlyOutputProfileSchema.parse(plan.outputProfile);
	const outputProfileFingerprint =
		await fingerprintVideoOnlyOutputProfile(outputProfile);
	if (outputProfileFingerprint !== plan.outputProfileFingerprint)
		throw new Error("QUICK_IMAGE_REQUEST_PLAN_PROFILE_MISMATCH");
	return quickImageRenderRequestSchema.parse({
		schemaVersion: QUICK_IMAGE_RENDER_REQUEST_SCHEMA_VERSION,
		compositionVersionId: plan.compositionVersionId,
		compositionFingerprint: plan.compositionFingerprint,
		renderPlanFingerprint: plan.planFingerprint,
		outputProfile,
		outputProfileFingerprint,
		outputContractVersion: plan.outputContractVersion,
	});
}
