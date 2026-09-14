import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
	type PrototypeToolManifest,
	prototypeToolManifestSchema,
	sha256Hex,
} from "@affichannel/core";

export class T09ToolResolutionError extends Error {
	readonly code:
		| "T09_FFMPEG_BINARY_APPROVAL_REQUIRED"
		| "T09_FFMPEG_PATH_MUST_BE_ABSOLUTE"
		| "T09_FFMPEG_APPROVED_PATH_MISMATCH"
		| "T09_FFMPEG_MANIFEST_IDENTITY_MISMATCH"
		| "T09_FFMPEG_BINARY_IDENTITY_MISMATCH"
		| "T09_FFMPEG_BINARY_NOT_FOUND"
		| "T09_FFMPEG_BINARY_NOT_REGULAR_FILE"
		| "T09_FFMPEG_PLATFORM_MISMATCH"
		| "T09_FFMPEG_BINARY_HASH_MISMATCH";

	constructor(code: T09ToolResolutionError["code"], message: string) {
		super(message);
		this.name = "T09ToolResolutionError";
		this.code = code;
	}
}

const T09_RESOLVED_TOOL_AUTHORITY = Symbol("T09_RESOLVED_TOOL_AUTHORITY");

export type ResolvedT09FfmpegTool = Readonly<{
	executablePath: string;
	manifest: PrototypeToolManifest;
	manifestIdentity: string;
	binarySha256: string;
}>;

function sha256Bytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export async function resolveT09FfmpegTool(input: {
	configuredPath: string;
	manifest: PrototypeToolManifest;
	platform?: "windows";
	architecture?: "x64";
}): Promise<ResolvedT09FfmpegTool> {
	const manifest = prototypeToolManifestSchema.parse(input.manifest);
	if (
		manifest.approvalStatus !== "APPROVED" ||
		!manifest.version ||
		!manifest.binarySha256 ||
		!manifest.buildIdentity ||
		!manifest.sourceOrDistributionReference
	)
		throw new T09ToolResolutionError(
			"T09_FFMPEG_BINARY_APPROVAL_REQUIRED",
			"T09 execution requires an owner-approved FFmpeg version, build identity, distribution reference, and SHA-256.",
		);
	if (!isAbsolute(input.configuredPath))
		throw new T09ToolResolutionError(
			"T09_FFMPEG_PATH_MUST_BE_ABSOLUTE",
			"T09 FFmpeg resolution never searches PATH; configuredPath must be absolute.",
		);
	if (
		manifest.platform !== (input.platform ?? "windows") ||
		manifest.architecture !== (input.architecture ?? "x64")
	)
		throw new T09ToolResolutionError(
			"T09_FFMPEG_PLATFORM_MISMATCH",
			"The pinned FFmpeg manifest does not match the requested execution platform.",
		);
	let fileInfo: Awaited<ReturnType<typeof lstat>>;
	try {
		fileInfo = await lstat(input.configuredPath);
	} catch {
		throw new T09ToolResolutionError(
			"T09_FFMPEG_BINARY_NOT_FOUND",
			"The explicitly configured FFmpeg binary does not exist.",
		);
	}
	if (!fileInfo.isFile())
		throw new T09ToolResolutionError(
			"T09_FFMPEG_BINARY_NOT_REGULAR_FILE",
			"The explicitly configured FFmpeg path is not a regular file.",
		);
	const bytes = await readFile(input.configuredPath);
	const binarySha256 = sha256Bytes(bytes);
	if (binarySha256 !== manifest.binarySha256)
		throw new T09ToolResolutionError(
			"T09_FFMPEG_BINARY_HASH_MISMATCH",
			"The configured FFmpeg binary SHA-256 does not match the approved manifest.",
		);
	const resolved = {
		executablePath: input.configuredPath,
		manifest,
		manifestIdentity: await sha256Hex(manifest),
		binarySha256,
	};
	Object.defineProperty(resolved, T09_RESOLVED_TOOL_AUTHORITY, {
		configurable: false,
		enumerable: false,
		value: true,
		writable: false,
	});
	return Object.freeze(resolved);
}

/**
 * Revalidates the resolver authority immediately before the real spawn
 * boundary. The non-exported authority symbol prevents a plain object from
 * becoming executable authority by structural typing alone. Node cannot bind
 * a path hash atomically to a Windows process image, so deployment must keep
 * the approved binary location non-writable; this check only narrows the
 * validation-to-spawn window and does not claim filesystem immutability.
 */
export async function revalidateT09FfmpegTool(input: {
	tool: ResolvedT09FfmpegTool;
	expectedExecutablePath: string;
	expectedManifestIdentity: string;
	expectedBinarySha256: string;
}) {
	if (Reflect.get(input.tool, T09_RESOLVED_TOOL_AUTHORITY) !== true)
		throw new T09ToolResolutionError(
			"T09_FFMPEG_BINARY_APPROVAL_REQUIRED",
			"T09 execution authority must come from the approved tool resolver.",
		);
	if (input.tool.executablePath !== input.expectedExecutablePath)
		throw new T09ToolResolutionError(
			"T09_FFMPEG_APPROVED_PATH_MISMATCH",
			"The command executable path does not match the approved tool path.",
		);
	if (input.tool.manifestIdentity !== input.expectedManifestIdentity)
		throw new T09ToolResolutionError(
			"T09_FFMPEG_MANIFEST_IDENTITY_MISMATCH",
			"The command tool manifest does not match the approved tool identity.",
		);
	if (input.tool.binarySha256 !== input.expectedBinarySha256)
		throw new T09ToolResolutionError(
			"T09_FFMPEG_BINARY_IDENTITY_MISMATCH",
			"The command binary identity does not match the approved tool.",
		);
	const current = await resolveT09FfmpegTool({
		configuredPath: input.tool.executablePath,
		manifest: input.tool.manifest,
	});
	if (
		current.executablePath !== input.tool.executablePath ||
		current.manifestIdentity !== input.tool.manifestIdentity ||
		current.binarySha256 !== input.tool.binarySha256
	)
		throw new T09ToolResolutionError(
			"T09_FFMPEG_BINARY_IDENTITY_MISMATCH",
			"The approved FFmpeg executable changed after initial resolution.",
		);
	return current;
}
