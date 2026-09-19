import type {
	QuickImageOutputReady,
	QuickImageRenderPlan,
	RenderAttemptExecutionSnapshot,
} from "@affichannel/core";
import { env } from "@affichannel/env/server";
import type {
	RenderOutputBody,
	RenderOutputStorage,
} from "../storage/render-output-storage";
import {
	buildQuickImageCommandPlan,
	type QuickImageCommandPlan,
} from "./quick-image-command-plan";
import {
	createQuickImageServerOwnedPath,
	createQuickImageSourceMaterializationSpec,
	type QuickImageServerOwnedPath,
	type QuickImageSourceMaterializationSpec,
} from "./quick-image-materialization";

export const QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED =
	"QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED" as const;

export type QuickImageExecutionContext = Readonly<{
	snapshot: RenderAttemptExecutionSnapshot;
	plan: QuickImageRenderPlan;
	sourceMaterialization: QuickImageSourceMaterializationSpec;
	inputPath: QuickImageServerOwnedPath;
	outputPath: QuickImageServerOwnedPath;
	commandPlan: QuickImageCommandPlan;
	signal?: AbortSignal;
}>;

export type QuickImageExecutionAdapterResult =
	| Readonly<{
			outcome: "SUCCESS_OUTPUT_READY";
			outputReady?: QuickImageOutputReady;
			/** Tests may provide an already stored object or a body for finalization. */
			storage?: RenderOutputStorage;
			body?: RenderOutputBody;
	  }>
	| Readonly<{
			outcome: "PROCESS_FAILED";
			classification: "DETERMINISTIC" | "RETRYABLE";
			sideEffectFree: boolean;
			errorCode: string;
			errorMessage?: string;
	  }>
	| Readonly<{
			outcome: "INDETERMINATE";
			errorCode: string;
			errorMessage?: string;
	  }>
	| Readonly<{
			outcome: "BLOCKED";
			errorCode?: typeof QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED;
			errorMessage?: string;
	  }>;

export type QuickImageExecutionAdapter = (
	input: QuickImageExecutionContext,
) => Promise<QuickImageExecutionAdapterResult>;

function sourceExtension(mimeType: QuickImageRenderPlan["source"]["mimeType"]) {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/webp") return "webp";
	return "png";
}

/** Builds the attempt-owned, server-owned Quick Image execution context. */
export async function buildQuickImageExecutionContext(
	snapshot: RenderAttemptExecutionSnapshot,
	rootPath = env.RENDER_OUTPUT_LOCAL_ROOT,
): Promise<QuickImageExecutionContext> {
	if (
		snapshot.execution.renderKind !== "QUICK_IMAGE" ||
		!snapshot.execution.quickImagePlan
	)
		throw new Error("QUICK_IMAGE_EXECUTION_CONTEXT_INVALID");
	const plan = snapshot.execution.quickImagePlan;
	const relativeBase = `attempts/${snapshot.jobId}/${snapshot.attemptId}/${snapshot.attemptNumber}`;
	const inputPath = createQuickImageServerOwnedPath({
		rootPath,
		relativePath: `${relativeBase}/source.${sourceExtension(plan.source.mimeType)}`,
	});
	const outputPath = createQuickImageServerOwnedPath({
		rootPath,
		relativePath: `${relativeBase}/output.mp4`,
	});
	const sourceMaterialization = createQuickImageSourceMaterializationSpec({
		plan,
		destination: inputPath,
	});
	const commandPlan = await buildQuickImageCommandPlan({
		plan,
		inputPath,
		outputPath,
	});
	return {
		snapshot,
		plan,
		sourceMaterialization,
		inputPath,
		outputPath,
		commandPlan,
	};
}

/** Production/default boundary. It deliberately does not inspect or spawn a tool. */
export function createDeniedQuickImageExecutionAdapter(): QuickImageExecutionAdapter {
	return async () => ({
		outcome: "BLOCKED",
		errorCode: QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED,
		errorMessage:
			"Quick Image live execution remains disabled pending the D3 tool gate.",
	});
}

/** Explicit test-only adapter factory; it has no process execution behavior. */
export function createFakeQuickImageExecutionAdapter(input: {
	result:
		| QuickImageExecutionAdapterResult
		| ((
				context: QuickImageExecutionContext,
		  ) => Promise<QuickImageExecutionAdapterResult>);
}): QuickImageExecutionAdapter {
	return async (context) =>
		typeof input.result === "function" ? input.result(context) : input.result;
}
