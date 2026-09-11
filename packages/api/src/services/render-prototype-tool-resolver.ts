import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
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
	let fileInfo: Awaited<ReturnType<typeof stat>>;
	try {
		fileInfo = await stat(input.configuredPath);
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
	return {
		executablePath: input.configuredPath,
		manifest,
		manifestIdentity: await sha256Hex(manifest),
		binarySha256,
	};
}
