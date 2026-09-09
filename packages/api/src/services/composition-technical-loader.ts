/// <reference path="../types/fontkit.d.ts" />

import { readFile } from "node:fs/promises";
import type { MediaAsset, VoiceSegmentArtifact } from "@affichannel/core";
import {
	type CompositionInputV1,
	type CompositionTechnicalManifestV1,
	canonicalCompositionSemanticJson,
	checkCompositionAudioTiming,
	compositionInputV1Schema,
	MediaAssetError,
	sha256Hex,
	type TechnicalFontManifestFact,
	type TechnicalMediaManifestFact,
	type TechnicalPreflightReasonCode,
	type TechnicalPreflightResult,
	type TechnicalTimingManifestFact,
	type TechnicalVoiceManifestFact,
	VoiceSegmentError,
} from "@affichannel/core";
import { env } from "@affichannel/env/server";
import * as fontkit from "fontkit";
import { Decoder } from "minimp3-wasm";
import type { MediaAssetStorage } from "../media/media-asset-storage";
import { createMediaAssetStorage } from "../media/media-asset-storage-factory";
import {
	DEFAULT_MEDIA_ASSET_SIZE_LIMITS,
	validateMediaAssetBytes,
} from "../media/media-asset-validation";
import type {
	VoiceAudioStorage,
	VoiceAudioStorageProvider,
} from "../storage/voice-audio-storage";
import { createVoiceAudioStorage } from "../storage/voice-audio-storage-factory";
import {
	findMediaAssetByIdForWorkspace,
	type MediaAssetRecord,
} from "./media-asset-repository";
import { sha256Bytes } from "./voice-segment-hashing";
import { findVoiceSegmentArtifactById } from "./voice-segment-repository";
import type { WorkspaceActor } from "./workspace";

const FONT_MAX_BYTES = 2 * 1024 * 1024;
const FONT_MANIFEST_URL = new URL(
	"../render-assets/fonts/affichannel-fonts-v1/manifest.json",
	import.meta.url,
);
const FONT_FILE_URLS = {
	"NotoSans-Regular.ttf": new URL(
		"../render-assets/fonts/affichannel-fonts-v1/NotoSans-Regular.ttf",
		import.meta.url,
	),
	"NotoSans-SemiBold.ttf": new URL(
		"../render-assets/fonts/affichannel-fonts-v1/NotoSans-SemiBold.ttf",
		import.meta.url,
	),
	"NotoSans-Bold.ttf": new URL(
		"../render-assets/fonts/affichannel-fonts-v1/NotoSans-Bold.ttf",
		import.meta.url,
	),
} as const;
const MP3_WASM_URL = new URL(
	"../../node_modules/minimp3-wasm/dist/decoder.opt.wasm",
	import.meta.url,
);

type FontAssetManifest = {
	schemaVersion: "affichannel-font-manifest.v1";
	bundleId: "affichannel-fonts-v1";
	license: "OFL-1.1";
	licenseFile: "OFL.txt";
	source: {
		fontRepository: string;
		fontRevision: string;
		licenseRepository: string;
		licenseRevision: string;
	};
	faces: Array<{
		fontStableId: string;
		family: "Noto Sans";
		weight: 400 | 600 | 700;
		style: "normal";
		format: "ttf";
		fileName: string;
		byteLength: number;
		sha256: string;
		license: "OFL-1.1";
		version: string;
	}>;
};

let fontAssetManifestPromise: Promise<FontAssetManifest> | undefined;

async function readFontAssetManifest() {
	fontAssetManifestPromise ??= readFile(FONT_MANIFEST_URL, "utf8").then(
		(value) => JSON.parse(value) as FontAssetManifest,
	);
	return fontAssetManifestPromise;
}

type LoadedTechnicalDependency<T> =
	| { status: "VALID"; facts: T; bytes: Uint8Array }
	| {
			status: "INVALID" | "UNSUPPORTED" | "UNKNOWN";
			reasonCode: TechnicalPreflightReasonCode;
			issue: string;
	  };

type MediaPin = CompositionInputV1["media"][number];
type VoicePin = CompositionInputV1["voice"]["segments"][number];
type FontPin = CompositionInputV1["fonts"]["faces"][number];

type MediaTechnicalFacts = TechnicalMediaManifestFact;
type VoiceTechnicalFacts = TechnicalVoiceManifestFact;
type FontTechnicalFacts = TechnicalFontManifestFact;

type LoaderOptions = {
	actor: WorkspaceActor;
	projectId: string;
	findMediaAsset?: (
		actor: WorkspaceActor,
		assetId: string,
	) => Promise<MediaAssetRecord | undefined>;
	findVoiceArtifact?: (
		actor: WorkspaceActor,
		artifactId: string,
	) => Promise<VoiceSegmentArtifact | undefined>;
	mediaStorage?: (provider: MediaAsset["storageProvider"]) => MediaAssetStorage;
	voiceStorage?: (provider: VoiceAudioStorageProvider) => VoiceAudioStorage;
	fontReadFile?: (fileName: string) => Promise<Uint8Array>;
	wasmReadFile?: () => Promise<Uint8Array>;
};

function valid<T>(facts: T, bytes: Uint8Array): LoadedTechnicalDependency<T> {
	return { status: "VALID", facts, bytes };
}

function failure(
	status: "INVALID" | "UNSUPPORTED" | "UNKNOWN",
	reasonCode: TechnicalPreflightReasonCode,
	issue: string,
): LoadedTechnicalDependency<never> {
	return { status, reasonCode, issue };
}

function isMediaNotFound(error: unknown) {
	return (
		error instanceof MediaAssetError &&
		error.code === "MEDIA_ASSET_STORAGE_NOT_FOUND"
	);
}

function isVoiceNotFound(error: unknown) {
	return (
		error instanceof VoiceSegmentError && error.metadata?.notFound === true
	);
}

function unknownRead<T>(kind: string): LoadedTechnicalDependency<T> {
	return failure(
		"UNKNOWN",
		"DEPENDENCY_READ_UNAVAILABLE",
		`${kind} dependency could not be read; retryable storage state.`,
	);
}

function decodeUint32Be(bytes: Uint8Array, offset: number) {
	return (
		(((bytes[offset] ?? 0) << 24) >>> 0) |
		((bytes[offset + 1] ?? 0) << 16) |
		((bytes[offset + 2] ?? 0) << 8) |
		(bytes[offset + 3] ?? 0)
	);
}

type MpegFrameHeader = Readonly<{
	offset: number;
	version: 0 | 2 | 3;
	layer: 1;
	channelMode: number;
	channels: 1 | 2;
	sampleRate: number;
	bitrateKbps: number;
	padding: number;
	frameLength: number;
	samplesPerFrame: 576 | 1152;
	crcLength: 0 | 2;
	sideInfoLength: number;
}>;

type ParsedGaplessInfo = Readonly<{
	encoderDelay: number;
	endPadding: number;
	frameCount: number;
	decodedSampleFrames: number;
	sampleRate: number;
	channels: 1 | 2;
}>;

type DecodedMp3Facts = Readonly<{
	samplingRate: number;
	numChannels: number;
	numSamples: number;
	pcmLength: number;
}>;

const MPEG_BITRATES = {
	3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
	2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
	0: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
} as const;

const MPEG_SAMPLE_RATES = {
	3: [44100, 48000, 32000],
	2: [22050, 24000, 16000],
	0: [11025, 12000, 8000],
} as const;

function readId3v2End(bytes: Uint8Array) {
	if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
	if (bytes.length < 10) return undefined;
	const majorVersion = bytes[3] ?? 0;
	const flags = bytes[5] ?? 0;
	if (majorVersion < 2 || majorVersion > 4 || (flags & 0x0f) !== 0)
		return undefined;
	const tagSizeBytes = bytes.slice(6, 10);
	if (tagSizeBytes.some((value) => (value & 0x80) !== 0)) return undefined;
	const tagSize =
		((tagSizeBytes[0] ?? 0) << 21) |
		((tagSizeBytes[1] ?? 0) << 14) |
		((tagSizeBytes[2] ?? 0) << 7) |
		(tagSizeBytes[3] ?? 0);
	const footerLength = majorVersion === 4 && (flags & 0x10) !== 0 ? 10 : 0;
	const end = 10 + tagSize + footerLength;
	return end <= bytes.length ? end : undefined;
}

function parseMpegFrameHeader(
	bytes: Uint8Array,
	offset: number,
): MpegFrameHeader | undefined {
	if (offset < 0 || offset + 4 > bytes.length) return undefined;
	const first = bytes[offset] ?? 0;
	const second = bytes[offset + 1] ?? 0;
	if (first !== 0xff || (second & 0xe0) !== 0xe0) return undefined;
	const version = ((second >> 3) & 0x03) as 0 | 1 | 2 | 3;
	const layer = ((second >> 1) & 0x03) as 0 | 1 | 2 | 3;
	if (version === 1 || layer !== 1) return undefined;
	const third = bytes[offset + 2] ?? 0;
	const bitrateIndex = (third >> 4) & 0x0f;
	const sampleRateIndex = (third >> 2) & 0x03;
	const bitrateKbps = MPEG_BITRATES[version as 0 | 2 | 3]?.[bitrateIndex];
	const sampleRate = MPEG_SAMPLE_RATES[version as 0 | 2 | 3]?.[sampleRateIndex];
	if (
		bitrateKbps === undefined ||
		bitrateKbps === 0 ||
		sampleRate === undefined
	)
		return undefined;
	const fourth = bytes[offset + 3] ?? 0;
	if ((fourth & 0x03) === 0x03) return undefined;
	const channelMode = (fourth >> 6) & 0x03;
	const channels = channelMode === 3 ? 1 : 2;
	const padding = (third >> 1) & 0x01;
	const crcLength = (second & 0x01) === 0 ? 2 : 0;
	const samplesPerFrame = version === 3 ? 1152 : 576;
	const frameLength =
		Math.floor(((version === 3 ? 144000 : 72000) * bitrateKbps) / sampleRate) +
		padding;
	const sideInfoLength =
		version === 3 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17;
	if (frameLength < 4 + crcLength + sideInfoLength) return undefined;
	return {
		offset,
		version: version as 0 | 2 | 3,
		layer: 1,
		channelMode,
		channels,
		sampleRate,
		bitrateKbps,
		padding,
		frameLength,
		samplesPerFrame,
		crcLength,
		sideInfoLength,
	};
}

function isAllowedTrailingMetadata(bytes: Uint8Array, offset: number) {
	if (offset === bytes.length) return true;
	const remaining = bytes.slice(offset);
	if (
		remaining.length >= 128 &&
		String.fromCharCode(...remaining.slice(0, 3)) === "TAG"
	)
		return remaining.length === 128;
	return (
		remaining.length >= 32 &&
		String.fromCharCode(...remaining.slice(0, 8)) === "APETAGEX"
	);
}

function walkMpegFrames(bytes: Uint8Array, first: MpegFrameHeader) {
	let offset = first.offset;
	let frameCount = 0;
	while (offset + 4 <= bytes.length) {
		const header = parseMpegFrameHeader(bytes, offset);
		if (!header) break;
		if (
			header.version !== first.version ||
			header.layer !== first.layer ||
			header.sampleRate !== first.sampleRate ||
			header.channels !== first.channels
		)
			return undefined;
		if (offset + header.frameLength > bytes.length) return undefined;
		frameCount += 1;
		offset += header.frameLength;
	}
	if (frameCount === 0 || !isAllowedTrailingMetadata(bytes, offset))
		return undefined;
	return { frameCount, endOffset: offset };
}

function findFirstMpegFrame(bytes: Uint8Array) {
	const firstOffset = readId3v2End(bytes);
	if (firstOffset === undefined) return undefined;
	const first = parseMpegFrameHeader(bytes, firstOffset);
	if (!first || first.offset + first.frameLength > bytes.length)
		return undefined;
	return first;
}

function readLameGaplessInfo(bytes: Uint8Array): ParsedGaplessInfo | undefined {
	const frame = findFirstMpegFrame(bytes);
	if (!frame) return undefined;
	const frames = walkMpegFrames(bytes, frame);
	if (!frames) return undefined;
	const xingOffset = frame.offset + 4 + frame.crcLength + frame.sideInfoLength;
	if (xingOffset + 12 > frame.offset + frame.frameLength) return undefined;
	const marker = String.fromCharCode(
		...bytes.slice(xingOffset, xingOffset + 4),
	);
	if (marker !== "Xing" && marker !== "Info") return undefined;
	const flags = decodeUint32Be(bytes, xingOffset + 4);
	// Xing flags are the low four bits: frames, bytes, TOC, and VBR scale.
	if ((flags & ~0x0f) !== 0 || (flags & 0x01) === 0) return undefined;
	let cursor = xingOffset + 8;
	const frameCount = decodeUint32Be(bytes, cursor);
	cursor += 4;
	if ((flags & 0x02) !== 0) cursor += 4;
	if ((flags & 0x04) !== 0) cursor += 100;
	if ((flags & 0x08) !== 0) cursor += 4;
	if (frameCount === 0 || frameCount !== frames.frameCount) return undefined;
	if (
		cursor + 24 > frame.offset + frame.frameLength ||
		String.fromCharCode(...bytes.slice(cursor, cursor + 4)) !== "LAME"
	)
		return undefined;
	const gaplessOffset = cursor + 21;
	const encoderDelay =
		((bytes[gaplessOffset] ?? 0) << 4) | ((bytes[gaplessOffset + 1] ?? 0) >> 4);
	const endPadding =
		(((bytes[gaplessOffset + 1] ?? 0) & 0x0f) << 8) |
		(bytes[gaplessOffset + 2] ?? 0);
	if (encoderDelay > 4095 || endPadding > 4095) return undefined;
	const decodedSampleFrames = frameCount * frame.samplesPerFrame;
	if (
		!Number.isSafeInteger(decodedSampleFrames) ||
		encoderDelay + endPadding >= decodedSampleFrames
	)
		return undefined;
	return {
		encoderDelay,
		endPadding,
		frameCount,
		decodedSampleFrames,
		sampleRate: frame.sampleRate,
		channels: frame.channels,
	};
}

export function validateDecodedMp3SampleDomain(
	decoded: DecodedMp3Facts,
	proof: ParsedGaplessInfo,
) {
	if (
		!Number.isSafeInteger(decoded.samplingRate) ||
		!Number.isSafeInteger(decoded.numChannels) ||
		!Number.isSafeInteger(decoded.numSamples) ||
		decoded.samplingRate <= 0 ||
		decoded.numChannels <= 0 ||
		decoded.numSamples <= 0 ||
		decoded.numSamples % decoded.numChannels !== 0 ||
		decoded.pcmLength !== decoded.numSamples
	)
		return {
			status: "INVALID" as const,
			reasonCode: "VOICE_AUDIO_METADATA_INVALID" as const,
			issue: "Decoded MP3 PCM metadata is invalid.",
		};
	const decodedSamplesPerChannel = decoded.numSamples / decoded.numChannels;
	if (
		decoded.samplingRate !== proof.sampleRate ||
		decoded.numChannels !== proof.channels ||
		decodedSamplesPerChannel !== proof.decodedSampleFrames
	)
		return {
			status: "UNSUPPORTED" as const,
			reasonCode: "AUDIO_SAMPLE_DOMAIN_UNPROVABLE" as const,
			issue:
				"Decoded MP3 sample data is inconsistent with the proven MPEG frame domain.",
		};
	return { status: "VALID" as const, decodedSamplesPerChannel };
}

async function decodeMp3(
	bytes: Uint8Array,
	readWasm: () => Promise<Uint8Array>,
) {
	const gapless = readLameGaplessInfo(bytes);
	if (!gapless) {
		return failure(
			"UNSUPPORTED",
			"AUDIO_SAMPLE_DOMAIN_UNPROVABLE",
			"MP3 encoder delay and end padding are not objectively provable.",
		);
	}
	try {
		const wasmBytes = await readWasm();
		const wasm = await (
			globalThis as unknown as {
				WebAssembly: {
					instantiate(
						bytes: Uint8Array,
						imports: Record<string, never>,
					): Promise<{ instance: { exports: Record<string, unknown> } }>;
				};
			}
		).WebAssembly.instantiate(wasmBytes, {});
		const decoder = new Decoder(wasm.instance.exports, bytes);
		const decoded = decoder.decode(Math.max(1, decoder.duration + 1));
		const sampleDomain = validateDecodedMp3SampleDomain(
			{
				samplingRate: decoded.samplingRate,
				numChannels: decoded.numChannels,
				numSamples: decoded.numSamples,
				pcmLength: decoded.pcm.length,
			},
			gapless,
		);
		if (sampleDomain.status !== "VALID") return sampleDomain;
		// The pinned minimp3-wasm build uses the basic minimp3.h decoder: its
		// numSamples/PCM buffer are the raw interleaved frame domain. Apply the
		// objectively parsed LAME delay and padding exactly once here.
		const decodedSamplesPerChannel = sampleDomain.decodedSamplesPerChannel;
		const usableSampleCount =
			decodedSamplesPerChannel - gapless.encoderDelay - gapless.endPadding;
		if (usableSampleCount <= 0 || !Number.isSafeInteger(usableSampleCount))
			return failure(
				"INVALID",
				"VOICE_AUDIO_METADATA_INVALID",
				"Decoded MP3 PCM has no usable sample domain.",
			);
		return {
			status: "VALID" as const,
			facts: {
				sourceSampleRate: decoded.samplingRate,
				sourceSampleCount: String(usableSampleCount),
				encoderDelaySamples: gapless.encoderDelay,
				endPaddingSamples: gapless.endPadding,
			},
			bytes,
		};
	} catch {
		return failure(
			"INVALID",
			"VOICE_AUDIO_METADATA_INVALID",
			"MP3 bytes could not be deterministically decoded.",
		);
	}
}

function defaultFontReadFile(fileName: string) {
	const url = FONT_FILE_URLS[fileName as keyof typeof FONT_FILE_URLS];
	if (!url) return Promise.reject(new Error("Unknown immutable font file."));
	return readFile(/* turbopackIgnore: true */ url).then(
		(bytes) => new Uint8Array(bytes),
	);
}

function defaultWasmReadFile() {
	return readFile(MP3_WASM_URL).then((bytes) => new Uint8Array(bytes));
}

function canonicalFontFamilyMatches(
	actualFamily: string | null,
	face: FontAssetManifest["faces"][number],
) {
	if (actualFamily === face.family) return true;
	// The pinned upstream static SemiBold file names its family "Noto Sans
	// SemiBold" while its OS/2 weight is 600. This is the only accepted alias.
	return face.weight === 600 && actualFamily === "Noto Sans SemiBold";
}

export class CompositionTechnicalLoader {
	private readonly actor: WorkspaceActor;
	private readonly projectId: string;
	private readonly findMediaAsset: NonNullable<LoaderOptions["findMediaAsset"]>;
	private readonly findVoiceArtifact: NonNullable<
		LoaderOptions["findVoiceArtifact"]
	>;
	private readonly mediaStorage: NonNullable<LoaderOptions["mediaStorage"]>;
	private readonly voiceStorage: NonNullable<LoaderOptions["voiceStorage"]>;
	private readonly fontReadFile: NonNullable<LoaderOptions["fontReadFile"]>;
	private readonly wasmReadFile: NonNullable<LoaderOptions["wasmReadFile"]>;

	constructor(options: LoaderOptions) {
		this.actor = options.actor;
		this.projectId = options.projectId;
		this.findMediaAsset =
			options.findMediaAsset ?? findMediaAssetByIdForWorkspace;
		this.findVoiceArtifact =
			options.findVoiceArtifact ?? findVoiceSegmentArtifactById;
		this.mediaStorage = options.mediaStorage ?? createMediaAssetStorage;
		this.voiceStorage = options.voiceStorage ?? createVoiceAudioStorage;
		this.fontReadFile = options.fontReadFile ?? defaultFontReadFile;
		this.wasmReadFile = options.wasmReadFile ?? defaultWasmReadFile;
	}

	async loadMedia(
		pin: MediaPin,
	): Promise<LoadedTechnicalDependency<MediaTechnicalFacts>> {
		if (
			pin.semantic.mediaType !== "image" ||
			!(["image/jpeg", "image/png", "image/webp"] as const).includes(
				pin.semantic.mimeType as "image/jpeg" | "image/png" | "image/webp",
			)
		)
			return failure(
				"UNSUPPORTED",
				"MEDIA_FORMAT_UNSUPPORTED",
				"Only JPEG, PNG, and WebP image dependencies are supported in 21B.",
			);
		let asset: MediaAssetRecord | undefined;
		try {
			asset = await this.findMediaAsset(
				this.actor,
				pin.provenance.mediaAssetId,
			);
		} catch {
			return unknownRead("Media asset record");
		}
		if (!asset)
			return failure(
				"INVALID",
				"MISSING_MEDIA_OBJECT",
				"Media asset is missing.",
			);
		if (
			asset.workspaceId !== this.actor.workspaceId ||
			pin.provenance.workspaceId !== this.actor.workspaceId ||
			pin.provenance.projectId !== this.projectId ||
			asset.id !== pin.provenance.mediaAssetId
		)
			return failure(
				"INVALID",
				"MEDIA_METADATA_MISMATCH",
				"Media dependency scope is invalid.",
			);
		if (asset.mediaType !== "image")
			return failure(
				"UNSUPPORTED",
				"MEDIA_FORMAT_UNSUPPORTED",
				"Media asset format is unsupported.",
			);
		if (asset.checksumSha256 !== pin.semantic.checksumSha256)
			return failure(
				"INVALID",
				"MEDIA_CHECKSUM_MISMATCH",
				"Media checksum pin does not match the exact asset record.",
			);
		if (asset.byteSize !== pin.semantic.byteSize)
			return failure(
				"INVALID",
				"MEDIA_BYTE_SIZE_MISMATCH",
				"Media byte-size pin does not match the exact asset record.",
			);
		if (asset.mimeType !== pin.semantic.mimeType)
			return failure(
				"INVALID",
				"MEDIA_MIME_MISMATCH",
				"Media MIME pin does not match the exact asset record.",
			);
		if (
			asset.width !== pin.semantic.width ||
			asset.height !== pin.semantic.height ||
			asset.durationMs !== pin.semantic.durationMs
		)
			return failure(
				"INVALID",
				"MEDIA_METADATA_MISMATCH",
				"Media decoded metadata pin does not match the exact asset record.",
			);
		const maxBytes =
			asset.mediaType === "image"
				? Math.min(
						DEFAULT_MEDIA_ASSET_SIZE_LIMITS.image,
						env.MEDIA_IMAGE_MAX_BYTES,
					)
				: env.MEDIA_AUDIO_MAX_BYTES;
		if (
			!asset.storageKey ||
			asset.byteSize === null ||
			asset.byteSize > maxBytes
		)
			return failure(
				"INVALID",
				"MEDIA_BYTE_SIZE_MISMATCH",
				"Media bytes exceed the bounded technical loader limit.",
			);
		let storage: MediaAssetStorage;
		try {
			storage = this.mediaStorage(asset.storageProvider);
			const head = await storage.head(asset.storageKey);
			if (!head)
				return failure(
					"INVALID",
					"MISSING_MEDIA_OBJECT",
					"Media object is missing.",
				);
			if (head.byteSize !== pin.semantic.byteSize)
				return failure(
					"INVALID",
					"MEDIA_BYTE_SIZE_MISMATCH",
					"Media object byte length does not match the exact pin.",
				);
		} catch (error) {
			if (isMediaNotFound(error))
				return failure(
					"INVALID",
					"MISSING_MEDIA_OBJECT",
					"Media object is missing.",
				);
			return unknownRead("Media object");
		}
		let bytes: Uint8Array;
		try {
			bytes = await storage.get(asset.storageKey);
		} catch (error) {
			if (isMediaNotFound(error))
				return failure(
					"INVALID",
					"MISSING_MEDIA_OBJECT",
					"Media object is missing.",
				);
			return unknownRead("Media object");
		}
		if (bytes.byteLength !== pin.semantic.byteSize)
			return failure(
				"INVALID",
				"MEDIA_BYTE_SIZE_MISMATCH",
				"Media byte length does not match the exact pin.",
			);
		if (bytes.byteLength > maxBytes)
			return failure(
				"INVALID",
				"MEDIA_BYTE_SIZE_MISMATCH",
				"Media object exceeds the bounded technical loader limit.",
			);
		if (sha256Bytes(bytes) !== pin.semantic.checksumSha256)
			return failure(
				"INVALID",
				"MEDIA_CHECKSUM_MISMATCH",
				"Media bytes do not match the exact checksum pin.",
			);
		let detected: Awaited<ReturnType<typeof validateMediaAssetBytes>>;
		try {
			detected = await validateMediaAssetBytes({
				mediaType: "image",
				bytes,
				originalFilename: "pinned-image",
				declaredMimeType: null,
				maxBytes,
			});
		} catch {
			return failure(
				"INVALID",
				"MEDIA_METADATA_MISMATCH",
				"Media image metadata could not be decoded.",
			);
		}
		if (detected.mimeType !== pin.semantic.mimeType)
			return failure(
				"INVALID",
				"MEDIA_MIME_MISMATCH",
				"Media magic bytes do not match the exact MIME pin.",
			);
		if (
			detected.width !== pin.semantic.width ||
			detected.height !== pin.semantic.height ||
			detected.durationMs !== pin.semantic.durationMs
		)
			return failure(
				"INVALID",
				"MEDIA_METADATA_MISMATCH",
				"Media decoded metadata does not match the exact pin.",
			);
		return valid(
			{
				dependencyKey: pin.dependencyKey,
				mediaAssetId: pin.provenance.mediaAssetId,
				byteSize: bytes.byteLength,
				checksumSha256: pin.semantic.checksumSha256,
				mimeType: detected.mimeType as MediaTechnicalFacts["mimeType"],
				width: detected.width as number,
				height: detected.height as number,
			},
			bytes,
		);
	}

	async loadVoice(
		pin: VoicePin,
	): Promise<LoadedTechnicalDependency<VoiceTechnicalFacts>> {
		let artifact: VoiceSegmentArtifact | undefined;
		try {
			artifact = await this.findVoiceArtifact(
				this.actor,
				pin.provenance.artifactId,
			);
		} catch {
			return unknownRead("Voice artifact record");
		}
		if (!artifact)
			return failure(
				"INVALID",
				"MISSING_VOICE_OBJECT",
				"Voice artifact is missing.",
			);
		if (
			artifact.workspaceId !== this.actor.workspaceId ||
			artifact.projectId !== this.projectId ||
			artifact.id !== pin.provenance.artifactId ||
			artifact.segmentKey !== pin.segmentKey
		)
			return failure(
				"INVALID",
				"VOICE_AUDIO_METADATA_INVALID",
				"Voice dependency scope is invalid.",
			);
		if (artifact.checksum !== pin.semantic.checksum)
			return failure(
				"INVALID",
				"VOICE_CHECKSUM_MISMATCH",
				"Voice checksum pin does not match the exact artifact record.",
			);
		if (artifact.byteSize !== pin.semantic.byteSize)
			return failure(
				"INVALID",
				"VOICE_BYTE_SIZE_MISMATCH",
				"Voice byte-size pin does not match the exact artifact record.",
			);
		if (artifact.mimeType !== pin.semantic.mimeType)
			return failure(
				"INVALID",
				"VOICE_MIME_MISMATCH",
				"Voice MIME pin does not match the exact artifact record.",
			);
		if (
			artifact.storageProvider === null ||
			artifact.storageProvider !== pin.provenance.storageProvider ||
			!artifact.storageKey ||
			artifact.byteSize === null ||
			artifact.byteSize > env.VOICE_SEGMENT_MAX_AUDIO_BYTES
		)
			return failure(
				"INVALID",
				"VOICE_AUDIO_METADATA_INVALID",
				"Voice storage identity is incomplete or exceeds the bounded limit.",
			);
		const inspected = await this.inspectVoiceArtifact(artifact);
		if (inspected.status !== "VALID") return inspected;
		if (
			inspected.facts.sourceSampleRate !== pin.semantic.sourceSampleRate ||
			inspected.facts.sourceSampleCount !== pin.semantic.sourceSampleCount
		)
			return failure(
				"INVALID",
				"VOICE_AUDIO_METADATA_INVALID",
				"Decoded voice sample facts do not match the exact pin.",
			);
		return valid(
			{
				segmentKey: pin.segmentKey,
				artifactId: pin.provenance.artifactId,
				byteSize: inspected.bytes.byteLength,
				checksum: pin.semantic.checksum,
				mimeType: "audio/mpeg",
				sourceSampleRate: inspected.facts.sourceSampleRate,
				sourceSampleCount: inspected.facts.sourceSampleCount,
			},
			inspected.bytes,
		);
	}

	/** Materialization-only inspection of the exact persisted artifact. */
	async inspectVoiceArtifact(
		artifact: VoiceSegmentArtifact,
	): Promise<LoadedTechnicalDependency<VoiceTechnicalFacts>> {
		if (
			artifact.workspaceId !== this.actor.workspaceId ||
			artifact.projectId !== this.projectId ||
			artifact.checksum === null ||
			artifact.byteSize === null ||
			artifact.mimeType !== "audio/mpeg" ||
			artifact.storageProvider === null ||
			!artifact.storageKey ||
			artifact.byteSize > env.VOICE_SEGMENT_MAX_AUDIO_BYTES
		)
			return failure(
				"INVALID",
				"VOICE_AUDIO_METADATA_INVALID",
				"Voice artifact technical metadata is incomplete.",
			);
		let storage: VoiceAudioStorage;
		try {
			storage = this.voiceStorage(artifact.storageProvider);
			if (storage.head) {
				const head = await storage.head(artifact.storageKey);
				if (!head)
					return failure(
						"INVALID",
						"MISSING_VOICE_OBJECT",
						"Voice object is missing.",
					);
				if (head.byteSize !== artifact.byteSize)
					return failure(
						"INVALID",
						"VOICE_BYTE_SIZE_MISMATCH",
						"Voice object byte length does not match its exact artifact record.",
					);
			}
		} catch (error) {
			if (isVoiceNotFound(error))
				return failure(
					"INVALID",
					"MISSING_VOICE_OBJECT",
					"Voice object is missing.",
				);
			return unknownRead("Voice object");
		}
		let bytes: Uint8Array;
		try {
			bytes = await storage.get(artifact.storageKey);
		} catch (error) {
			if (isVoiceNotFound(error))
				return failure(
					"INVALID",
					"MISSING_VOICE_OBJECT",
					"Voice object is missing.",
				);
			return unknownRead("Voice object");
		}
		if (bytes.byteLength !== artifact.byteSize)
			return failure(
				"INVALID",
				"VOICE_BYTE_SIZE_MISMATCH",
				"Voice byte length does not match its exact artifact record.",
			);
		if (bytes.byteLength > env.VOICE_SEGMENT_MAX_AUDIO_BYTES)
			return failure(
				"INVALID",
				"VOICE_BYTE_SIZE_MISMATCH",
				"Voice object exceeds the bounded technical loader limit.",
			);
		if (sha256Bytes(bytes) !== artifact.checksum)
			return failure(
				"INVALID",
				"VOICE_CHECKSUM_MISMATCH",
				"Voice bytes do not match its exact artifact record.",
			);
		const decoded = await decodeMp3(bytes, this.wasmReadFile);
		if (decoded.status !== "VALID") return decoded;
		return valid(
			{
				segmentKey: artifact.segmentKey,
				artifactId: artifact.id,
				byteSize: bytes.byteLength,
				checksum: artifact.checksum,
				mimeType: "audio/mpeg",
				sourceSampleRate: decoded.facts.sourceSampleRate,
				sourceSampleCount: decoded.facts.sourceSampleCount,
			},
			bytes,
		);
	}

	/** Materialization-only inspection of the exact linked media asset. */
	async inspectMediaAsset(
		asset: MediaAsset,
		dependencyKey = asset.id,
		role = "project_resource",
	): Promise<LoadedTechnicalDependency<MediaTechnicalFacts>> {
		if (
			asset.mimeType === null ||
			asset.byteSize === null ||
			asset.checksumSha256 === null ||
			asset.width === null ||
			asset.height === null ||
			asset.durationMs !== null
		)
			return failure(
				"INVALID",
				"MEDIA_METADATA_MISMATCH",
				"Media asset technical metadata is incomplete.",
			);
		const pin = {
			dependencyKey,
			role,
			semantic: {
				mediaType: asset.mediaType,
				mimeType: asset.mimeType,
				checksumSha256: asset.checksumSha256,
				byteSize: asset.byteSize,
				width: asset.width,
				height: asset.height,
				durationMs: asset.durationMs,
			},
			provenance: {
				mediaAssetId: asset.id,
				workspaceId: asset.workspaceId,
				projectId: this.projectId,
			},
		} as MediaPin;
		return this.loadMedia(pin);
	}

	async loadFont(
		pin: FontPin,
		requiredText: readonly string[] = [],
	): Promise<LoadedTechnicalDependency<FontTechnicalFacts>> {
		let fontAssetManifest: FontAssetManifest;
		try {
			fontAssetManifest = await readFontAssetManifest();
		} catch {
			return failure(
				"INVALID",
				"FONT_NOT_AVAILABLE",
				"Immutable font manifest is missing.",
			);
		}
		const face = fontAssetManifest.faces.find(
			(candidate) => candidate.fontStableId === pin.fontId,
		);
		if (!face)
			return failure(
				"INVALID",
				"FONT_NOT_AVAILABLE",
				"Pinned font face is not available.",
			);
		if (
			face.family !== pin.family ||
			face.weight !== pin.weight ||
			face.style !== pin.style ||
			face.sha256 !== pin.contentSha256
		)
			return failure(
				"INVALID",
				"FONT_METADATA_MISMATCH",
				"Pinned font metadata does not match the immutable font manifest.",
			);
		let bytes: Uint8Array;
		try {
			bytes = await this.fontReadFile(face.fileName);
		} catch {
			return failure(
				"INVALID",
				"FONT_NOT_AVAILABLE",
				"Pinned font asset is missing.",
			);
		}
		if (
			bytes.byteLength !== face.byteLength ||
			bytes.byteLength > FONT_MAX_BYTES
		)
			return failure(
				"INVALID",
				"FONT_METADATA_MISMATCH",
				"Font byte length does not match the immutable manifest.",
			);
		if (sha256Bytes(bytes) !== face.sha256)
			return failure(
				"INVALID",
				"FONT_CHECKSUM_MISMATCH",
				"Font bytes do not match the immutable manifest.",
			);
		let parsedFont: fontkit.ParsedFont;
		try {
			parsedFont = fontkit.create(bytes);
		} catch {
			return failure(
				"INVALID",
				"FONT_METADATA_MISMATCH",
				"Pinned font bytes could not be decoded.",
			);
		}
		if (
			parsedFont.type !== "TTF" ||
			!canonicalFontFamilyMatches(parsedFont.familyName, face) ||
			parsedFont["OS/2"]?.usWeightClass !== face.weight ||
			parsedFont.italicAngle !== 0 ||
			parsedFont.subfamilyName?.toLowerCase().includes("italic")
		)
			return failure(
				"INVALID",
				"FONT_METADATA_MISMATCH",
				"Decoded font family, weight, style, or format is not exact.",
			);
		const glyphCodePoints = new Set<number>();
		for (const text of requiredText) {
			for (const character of text.normalize("NFC")) {
				const codePoint = character.codePointAt(0);
				if (codePoint === undefined) continue;
				if (!parsedFont.characterSet.includes(codePoint))
					return failure(
						"UNSUPPORTED",
						"FONT_UNSUPPORTED",
						"A materialized text glyph is not available in the pinned font.",
					);
				glyphCodePoints.add(codePoint);
			}
		}
		return valid(
			{
				fontStableId: face.fontStableId,
				family: face.family,
				weight: face.weight,
				style: face.style,
				format: face.format,
				byteLength: bytes.byteLength,
				sha256: face.sha256,
				glyphCodePoints: [...glyphCodePoints].sort(
					(left, right) => left - right,
				),
			},
			bytes,
		);
	}

	async loadFontBundle(
		fonts: CompositionInputV1["fonts"],
		requiredText: readonly string[],
	) {
		let fontAssetManifest: FontAssetManifest;
		try {
			fontAssetManifest = await readFontAssetManifest();
		} catch {
			return failure(
				"INVALID",
				"FONT_NOT_AVAILABLE",
				"Immutable font manifest is missing.",
			);
		}
		if (
			fonts.bundleId !== fontAssetManifest.bundleId ||
			fonts.faces.length !== 3
		)
			return failure(
				"INVALID",
				"FONT_METADATA_MISMATCH",
				"Font bundle is not the immutable render font bundle.",
			);
		const loaded: Array<
			Extract<
				LoadedTechnicalDependency<FontTechnicalFacts>,
				{ status: "VALID" }
			>
		> = [];
		for (const face of fonts.faces) {
			const result = await this.loadFont(face, requiredText);
			if (result.status !== "VALID") return result;
			loaded.push(result);
		}
		return {
			status: "VALID" as const,
			facts: loaded.map((item) => item.facts),
			bytes: new Uint8Array(),
		};
	}

	async loadBundledFontBundle(requiredText: readonly string[]) {
		let manifest: FontAssetManifest;
		try {
			manifest = await readFontAssetManifest();
		} catch {
			return failure(
				"INVALID",
				"FONT_NOT_AVAILABLE",
				"Immutable font manifest is missing.",
			);
		}
		return this.loadFontBundle(
			{
				bundleId: manifest.bundleId,
				faces: manifest.faces.map((face) => ({
					family: face.family,
					weight: face.weight,
					style: face.style,
					fontId: face.fontStableId,
					contentSha256: face.sha256,
				})),
			},
			requiredText,
		);
	}
}

type TechnicalFailure = Extract<
	LoadedTechnicalDependency<unknown>,
	{ status: "INVALID" | "UNSUPPORTED" | "UNKNOWN" }
>;

function resultFromFailure(
	compositionVersionId: string | null,
	compositionFingerprint: string | null,
	result: TechnicalFailure,
): TechnicalPreflightResult {
	return {
		status: result.status,
		retryable: result.status === "UNKNOWN",
		reasonCode: result.reasonCode,
		compositionVersionId,
		compositionFingerprint,
		issues: [result.issue],
	};
}

function aggregateFailure(
	compositionVersionId: string,
	compositionFingerprint: string,
	results: readonly LoadedTechnicalDependency<unknown>[],
) {
	const isFailure = (
		result: LoadedTechnicalDependency<unknown>,
	): result is TechnicalFailure => result.status !== "VALID";
	const firstPermanent = results.find(
		(result): result is TechnicalFailure =>
			result.status === "INVALID" || result.status === "UNSUPPORTED",
	);
	const first = firstPermanent ?? results.find(isFailure);
	return first
		? resultFromFailure(compositionVersionId, compositionFingerprint, first)
		: undefined;
}

export async function technicalPreflightCompositionInput(
	loader: CompositionTechnicalLoader,
	compositionVersionId: string,
	input: unknown,
	compositionFingerprint: string,
): Promise<TechnicalPreflightResult> {
	const parsed = compositionInputV1Schema.safeParse(input);
	if (!parsed.success) {
		return {
			status: "INVALID",
			retryable: false,
			reasonCode: "INVALID_COMPOSITION_STRUCTURE",
			compositionVersionId,
			compositionFingerprint,
			issues: ["CompositionInputV1 structure is invalid."],
		};
	}
	const computedFingerprint = await sha256Hex(
		canonicalCompositionSemanticJson(parsed.data),
	);
	if (computedFingerprint !== compositionFingerprint) {
		return {
			status: "INVALID",
			retryable: false,
			reasonCode: "INVALID_COMPOSITION_STRUCTURE",
			compositionVersionId,
			compositionFingerprint,
			issues: ["Composition fingerprint does not match the exact input."],
		};
	}
	const textLayers = parsed.data.sceneComposition.scenes.flatMap((scene) =>
		scene.layers.flatMap((layer) =>
			layer.kind === "TEXT" ? [layer.text] : [],
		),
	);
	const mediaResults = await Promise.all(
		parsed.data.media.map((pin) => loader.loadMedia(pin)),
	);
	const voiceResults = await Promise.all(
		parsed.data.voice.segments.map((pin) => loader.loadVoice(pin)),
	);
	const fontResults = await loader.loadFontBundle(
		parsed.data.fonts,
		textLayers,
	);
	const dependencyResults: LoadedTechnicalDependency<unknown>[] = [
		...mediaResults,
		...voiceResults,
		fontResults,
	];
	const dependencyFailure = aggregateFailure(
		compositionVersionId,
		compositionFingerprint,
		dependencyResults,
	);
	if (dependencyFailure) return dependencyFailure;
	if (fontResults.status !== "VALID")
		return resultFromFailure(
			compositionVersionId,
			compositionFingerprint,
			fontResults,
		);
	const voiceFacts = new Map(
		voiceResults
			.filter(
				(result): result is Extract<typeof result, { status: "VALID" }> =>
					result.status === "VALID",
			)
			.map((result) => [result.facts.segmentKey, result.facts]),
	);
	for (const track of parsed.data.sceneComposition.audioTracks) {
		const facts = voiceFacts.get(track.sourceVoiceKey);
		if (!facts) {
			return {
				status: "INVALID",
				retryable: false,
				reasonCode: "AUDIO_TIMING_NOT_FEASIBLE",
				compositionVersionId,
				compositionFingerprint,
				issues: [
					"Audio source sample facts are unavailable for a pinned track.",
				],
			};
		}
		const check = checkCompositionAudioTiming(
			track,
			facts,
			parsed.data.profile.fps,
			parsed.data.timeline.totalFrames,
		);
		if (!check.ok) {
			return {
				status: "INVALID",
				retryable: false,
				reasonCode: check.reasonCode,
				compositionVersionId,
				compositionFingerprint,
				issues: ["Audio track sample-domain feasibility is not exact."],
			};
		}
	}
	const manifest: CompositionTechnicalManifestV1 = {
		schemaVersion: "composition-technical-manifest.v1",
		compositionFingerprint,
		media: mediaResults.map(
			(result) => (result as { facts: MediaTechnicalFacts }).facts,
		),
		voice: voiceResults.map(
			(result) => (result as { facts: VoiceTechnicalFacts }).facts,
		),
		fonts: fontResults.facts,
		timing: parsed.data.sceneComposition.audioTracks.map(
			(track): TechnicalTimingManifestFact => ({
				trackId: track.trackId,
				sourceVoiceKey: track.sourceVoiceKey,
				startFrame: track.startFrame,
				durationFrames: track.durationFrames,
				endFrame: track.endFrame,
				trimStartSample: track.trimStartSample,
				trimEndSample: track.trimEndSample,
			}),
		),
	};
	return {
		status: "VALID",
		retryable: false,
		reasonCode: null,
		compositionVersionId,
		compositionFingerprint,
		issues: [],
		technicalManifest: manifest,
	};
}

export { readFontAssetManifest, readLameGaplessInfo };
