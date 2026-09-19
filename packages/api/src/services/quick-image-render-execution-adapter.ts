import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
	QuickImageFfmpegToolApproval,
	QuickImageOutputReady,
	QuickImageRenderPlan,
	RenderAttemptExecutionSnapshot,
} from "@affichannel/core";
import {
	quickImageFfmpegToolApprovalSchema,
	US22_QUICK_IMAGE_FFMPEG_TOOL_APPROVAL,
} from "@affichannel/core";
import { env } from "@affichannel/env/server";
import { createMediaAssetStorage } from "../media/media-asset-storage-factory";
import type {
	RenderOutputBody,
	RenderOutputStorage,
} from "../storage/render-output-storage";
import {
	buildQuickImageCommandPlan,
	type QuickImageCommandPlan,
} from "./quick-image-command-plan";
import {
	assertQuickImageServerOwnedPath,
	createQuickImageServerOwnedPath,
	createQuickImageSourceMaterializationSpec,
	type QuickImageServerOwnedPath,
	type QuickImageSourceMaterializationSpec,
	type QuickImageSourceMaterializer,
} from "./quick-image-materialization";
import {
	type ValidatedRenderOutputMetadataV1,
	validateRenderOutputBytes,
} from "./render-output-validator";
import type { T09FfmpegCommandPlan } from "./render-prototype-command-plan";
import {
	executeT09FfmpegProcess,
	T09_MAX_OUTPUT_BYTES,
} from "./render-prototype-execution-adapter";
import {
	createT09AttemptOutputStagingPath as createT09OutputPath,
	prepareT09AttemptOutputStaging,
	type T09ServerOwnedStagingPath,
} from "./render-prototype-staging";
import { resolveT09FfmpegTool } from "./render-prototype-tool-resolver";

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
			proof?: QuickImageExecutionProof;
			outputPath?: string;
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

export type QuickImageExecutionProof = Readonly<{
	byteSize: number;
	checksumSha256: string;
	validatedMetadata: ValidatedRenderOutputMetadataV1;
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
		relativePath: `${relativeBase}/${snapshot.execution.outputReservationId}/output.mp4`,
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

const APPROVED_QUICK_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

function sha256Bytes(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}

function readUint32(bytes: Uint8Array, offset: number) {
	return (
		(bytes[offset] ?? 0) * 0x1000000 +
		(bytes[offset + 1] ?? 0) * 0x10000 +
		(bytes[offset + 2] ?? 0) * 0x100 +
		(bytes[offset + 3] ?? 0)
	);
}

function assertPngSource(
	bytes: Uint8Array,
	spec: QuickImageSourceMaterializationSpec,
) {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (!signature.every((value, index) => bytes[index] === value))
		throw new Error("QUICK_IMAGE_SOURCE_MIME_MISMATCH");
	if (
		bytes.length < 33 ||
		String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR"
	)
		throw new Error("QUICK_IMAGE_SOURCE_PNG_INVALID");
	const width = readUint32(bytes, 16);
	const height = readUint32(bytes, 20);
	const bitDepth = bytes[24];
	const colorType = bytes[25];
	if (
		width !== spec.width ||
		height !== spec.height ||
		bitDepth !== 8 ||
		colorType !== 2
	)
		throw new Error("QUICK_IMAGE_SOURCE_RGB_DIMENSIONS_INVALID");
	let offset = 8;
	while (offset + 12 <= bytes.length) {
		const length = readUint32(bytes, offset);
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		const end = offset + 12 + length;
		if (end > bytes.length) throw new Error("QUICK_IMAGE_SOURCE_PNG_INVALID");
		if (type === "acTL")
			throw new Error("QUICK_IMAGE_SOURCE_ANIMATION_UNSUPPORTED");
		offset = end;
		if (type === "IEND") break;
	}
}

function assertJpegSource(
	bytes: Uint8Array,
	spec: QuickImageSourceMaterializationSpec,
) {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
		throw new Error("QUICK_IMAGE_SOURCE_MIME_MISMATCH");
	let offset = 2;
	let sawFrame = false;
	while (offset + 3 < bytes.length) {
		if (bytes[offset] !== 0xff)
			throw new Error("QUICK_IMAGE_SOURCE_JPEG_INVALID");
		while (bytes[offset] === 0xff) offset += 1;
		const marker = bytes[offset++];
		if (marker === undefined)
			throw new Error("QUICK_IMAGE_SOURCE_JPEG_INVALID");
		if (marker === 0xd9 || marker === 0xda) break;
		if (marker >= 0xd0 && marker <= 0xd7) continue;
		if (offset + 2 > bytes.length)
			throw new Error("QUICK_IMAGE_SOURCE_JPEG_INVALID");
		const length = (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0);
		if (length < 2 || offset + length > bytes.length)
			throw new Error("QUICK_IMAGE_SOURCE_JPEG_INVALID");
		if (
			marker === 0xe1 &&
			String.fromCharCode(...bytes.subarray(offset + 2, offset + 8)) ===
				"Exif\0\0"
		)
			throw new Error("QUICK_IMAGE_SOURCE_JPEG_ORIENTATION_UNSUPPORTED");
		if (
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf)
		) {
			const precision = bytes[offset + 2];
			const height = (bytes[offset + 3] ?? 0) * 256 + (bytes[offset + 4] ?? 0);
			const width = (bytes[offset + 5] ?? 0) * 256 + (bytes[offset + 6] ?? 0);
			const components = bytes[offset + 7];
			if (
				precision !== 8 ||
				width !== spec.width ||
				height !== spec.height ||
				components !== 3
			)
				throw new Error("QUICK_IMAGE_SOURCE_RGB_DIMENSIONS_INVALID");
			sawFrame = true;
		}
		offset += length;
	}
	if (!sawFrame) throw new Error("QUICK_IMAGE_SOURCE_JPEG_INVALID");
}

async function materializeApprovedQuickImageSource(
	spec: QuickImageSourceMaterializationSpec,
) {
	if (!APPROVED_QUICK_IMAGE_MIME_TYPES.has(spec.mimeType))
		throw new Error("QUICK_IMAGE_SOURCE_MIME_NOT_APPROVED");
	const bytes = await createMediaAssetStorage("local").get(spec.storageKey);
	if (
		bytes.byteLength !== spec.byteSize ||
		sha256Bytes(bytes) !== spec.checksumSha256
	)
		throw new Error("QUICK_IMAGE_SOURCE_CHECKSUM_MISMATCH");
	if (spec.mimeType === "image/png") assertPngSource(bytes, spec);
	else assertJpegSource(bytes, spec);
	const destination = assertQuickImageServerOwnedPath(
		spec.destination,
		"Quick Image source materialization",
	);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, bytes, { flag: "wx" });
}

function quickImageOutputReady(
	snapshot: RenderAttemptExecutionSnapshot,
): QuickImageOutputReady {
	return {
		schemaVersion: "quick-image-output-ready.v1",
		kind: "OUTPUT_READY",
		jobId: snapshot.jobId,
		attemptId: snapshot.attemptId,
		attemptNumber: snapshot.attemptNumber,
		outputReservationId: snapshot.execution.outputReservationId,
	};
}

function approvedQuickImageCommandPlan(
	input: QuickImageExecutionContext,
	tool: Awaited<ReturnType<typeof resolveT09FfmpegTool>>,
	outputPath: T09ServerOwnedStagingPath,
): T09FfmpegCommandPlan {
	if (
		input.commandPlan.schemaVersion !== "quick-image-command-plan.v1" ||
		input.commandPlan.toolBinding !== "US22_TOOL_APPROVAL_REQUIRED" ||
		input.commandPlan.shell !== false ||
		input.commandPlan.executablePath !== null ||
		input.commandPlan.outputPath.absolutePath !== outputPath.absolutePath ||
		input.commandPlan.argv.at(-1) !== outputPath.absolutePath ||
		!input.commandPlan.argv.includes("-n") ||
		input.commandPlan.argv.includes("-y")
	)
		throw new Error("QUICK_IMAGE_COMMAND_PLAN_INVALID");
	return {
		executablePath: tool.executablePath,
		toolManifestIdentity: tool.manifestIdentity,
		toolBinarySha256: tool.binarySha256,
		argv: input.commandPlan.argv,
		outputPath: outputPath.absolutePath,
		filterGraph: input.commandPlan.filterGraph,
	};
}

/**
 * Real US22 execution boundary. It is explicit and fail-closed: the caller
 * cannot select an executable, shell mode, output path, filter or URL.
 */
export function createApprovedQuickImageExecutionAdapter(
	input: {
		materializeSource?: QuickImageSourceMaterializer;
		approval?: QuickImageFfmpegToolApproval;
	} = {},
): QuickImageExecutionAdapter {
	const approval = quickImageFfmpegToolApprovalSchema.parse(
		input.approval ?? US22_QUICK_IMAGE_FFMPEG_TOOL_APPROVAL,
	);
	const materializeSource =
		input.materializeSource ?? materializeApprovedQuickImageSource;
	return async (context) => {
		try {
			const { snapshot, plan } = context;
			if (
				plan.outputProfile.id !== approval.profileId ||
				plan.outputProfileFingerprint !== approval.profileFingerprint ||
				plan.timeline.fps.numerator !== 30 ||
				plan.timeline.fps.denominator !== 1 ||
				!approval.approvedFrameCounts.includes(plan.timeline.totalFrames) ||
				!approval.approvedSourceMimeTypes.some(
					(mimeType) => mimeType === plan.source.mimeType,
				)
			)
				throw new Error("US22_QUICK_IMAGE_APPROVAL_CONTRACT_MISMATCH");
			const approvedTool = await resolveT09FfmpegTool({
				configuredPath: approval.executablePath,
				manifest: approval.toolManifest,
			});
			const outputPath = createT09OutputPath({
				rootPath: context.outputPath.rootPath,
				jobId: snapshot.jobId,
				attemptId: snapshot.attemptId,
				attemptNumber: snapshot.attemptNumber,
				outputReservationId: snapshot.execution.outputReservationId,
			});
			if (outputPath.absolutePath !== context.outputPath.absolutePath)
				throw new Error("QUICK_IMAGE_OUTPUT_PATH_IDENTITY_MISMATCH");
			await prepareT09AttemptOutputStaging(outputPath);
			await materializeSource(context.sourceMaterialization);
			const commandPlan = approvedQuickImageCommandPlan(
				context,
				approvedTool,
				outputPath,
			);
			const result = await executeT09FfmpegProcess({
				commandPlan,
				outputPath,
				outputReady: {
					schemaVersion: "t09-output-ready.v1",
					kind: "OUTPUT_READY",
					jobId: snapshot.jobId,
					attemptId: snapshot.attemptId,
					attemptNumber: snapshot.attemptNumber,
					outputReservationId: snapshot.execution.outputReservationId,
				},
				approvedTool,
				signal: context.signal,
			});
			if (result.outcome !== "SUCCESS")
				return {
					outcome: "PROCESS_FAILED",
					classification:
						result.classification === "RETRYABLE"
							? "RETRYABLE"
							: "DETERMINISTIC",
					sideEffectFree: result.sideEffectFree,
					errorCode: result.errorCode,
					errorMessage: result.errorMessage,
				};
			const bytes = new Uint8Array(await readFile(outputPath.absolutePath));
			if (bytes.byteLength > T09_MAX_OUTPUT_BYTES)
				throw new Error("OUTPUT_SIZE_LIMIT_EXCEEDED");
			const proof = await validateRenderOutputBytes(bytes, {
				kind: "QUICK_IMAGE",
				compositionInput: plan.compositionInput,
				outputProfile: plan.outputProfile,
				outputProfileFingerprint: plan.outputProfileFingerprint,
				outputContractVersion: plan.outputContractVersion,
				expectedColorRange: "LIMITED_TV",
			});
			return {
				outcome: "SUCCESS_OUTPUT_READY",
				outputReady: quickImageOutputReady(snapshot),
				proof: {
					byteSize: proof.byteSize,
					checksumSha256: proof.checksumSha256,
					validatedMetadata: proof.validatedMetadata,
				},
				outputPath: outputPath.absolutePath,
			};
		} catch (error) {
			return {
				outcome: "PROCESS_FAILED",
				classification: "DETERMINISTIC",
				sideEffectFree: true,
				errorCode:
					error instanceof Error
						? error.message
						: "QUICK_IMAGE_EXECUTION_FAILED",
				errorMessage: error instanceof Error ? error.message : String(error),
			};
		}
	};
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
