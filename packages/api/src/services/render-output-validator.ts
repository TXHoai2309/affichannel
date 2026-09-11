import { createHash } from "node:crypto";
import type {
	CompositionInputV1,
	OutputEncodingProfile,
	RenderRequestSpecV1,
} from "@affichannel/core";

export const RENDER_OUTPUT_VALIDATION_VERSION = "render-output-validation.v1";
export const RENDER_OUTPUT_PROOF_VERSION = "render-output-proof.v1";

export type RenderOutputValidationExpectation = Readonly<{
	requestSpec: RenderRequestSpecV1;
	compositionInput: CompositionInputV1;
}>;

export type ValidatedRenderOutputMetadataV1 = Readonly<{
	schemaVersion: "render-output-metadata.v1";
	container: "MP4";
	mimeType: "video/mp4";
	videoCodec: "H.264/AVC";
	width: number;
	height: number;
	frameRate: Readonly<{ numerator: number; denominator: number }>;
	totalFrames: string;
	duration: Readonly<{ timescale: number; value: string }>;
	audio: Readonly<{
		codec: "AAC-LC";
		sampleRate: number;
		channels: number;
	}> | null;
}>;

export type StoredRenderOutputProofV1 = Readonly<{
	schemaVersion: "render-output-proof.v1";
	outputReservationId: string;
	storageProvider: "local" | "r2";
	storageKey: string;
	mimeType: "video/mp4";
	byteSize: number;
	checksumSha256: string;
	validationVersion: typeof RENDER_OUTPUT_VALIDATION_VERSION;
	validatedMetadata: ValidatedRenderOutputMetadataV1;
}>;

export class RenderOutputValidationError extends Error {
	readonly code = "RENDER_OUTPUT_INVALID" as const;

	constructor(message: string) {
		super(message);
		this.name = "RenderOutputValidationError";
	}
}

export class RenderOutputUnsupportedError extends Error {
	readonly code = "RENDER_OUTPUT_UNSUPPORTED" as const;

	constructor(message: string) {
		super(message);
		this.name = "RenderOutputUnsupportedError";
	}
}

type Mp4Box = Readonly<{
	type: string;
	start: number;
	payloadStart: number;
	end: number;
}>;

type StreamValidationResult = Readonly<{
	byteSize: number;
	checksumSha256: string;
	validatedMetadata: ValidatedRenderOutputMetadataV1;
}>;

const MAX_FTYP_BYTES = 1024 * 1024;
const MAX_MOOV_BYTES = 32 * 1024 * 1024;

function invalid(message: string): never {
	throw new RenderOutputValidationError(message);
}

function unsupported(message: string): never {
	throw new RenderOutputUnsupportedError(message);
}

function ensureRange(bytes: Uint8Array, offset: number, length: number) {
	if (offset < 0 || length < 0 || offset + length > bytes.byteLength)
		invalid("MP4 box is truncated.");
}

function byte(bytes: Uint8Array, offset: number) {
	ensureRange(bytes, offset, 1);
	const value = bytes[offset];
	if (value === undefined) invalid("MP4 box is truncated.");
	return value;
}

function uint16(bytes: Uint8Array, offset: number) {
	ensureRange(bytes, offset, 2);
	return (byte(bytes, offset) << 8) | byte(bytes, offset + 1);
}

function uint32(bytes: Uint8Array, offset: number) {
	ensureRange(bytes, offset, 4);
	return (
		byte(bytes, offset) * 0x1000000 +
		(byte(bytes, offset + 1) << 16) +
		(byte(bytes, offset + 2) << 8) +
		byte(bytes, offset + 3)
	);
}

function uint64(bytes: Uint8Array, offset: number) {
	ensureRange(bytes, offset, 8);
	const value =
		(BigInt(uint32(bytes, offset)) << BigInt(32)) |
		BigInt(uint32(bytes, offset + 4));
	if (value > BigInt(Number.MAX_SAFE_INTEGER))
		invalid("MP4 integer exceeds the supported safe range.");
	return Number(value);
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
	ensureRange(bytes, offset, length);
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function parseBoxes(bytes: Uint8Array, start: number, end: number): Mp4Box[] {
	const boxes: Mp4Box[] = [];
	let offset = start;
	while (offset < end) {
		ensureRange(bytes, offset, 8);
		const size32 = uint32(bytes, offset);
		const type = ascii(bytes, offset + 4, 4);
		let headerSize = 8;
		let size: number;
		if (size32 === 1) {
			size = uint64(bytes, offset + 8);
			headerSize = 16;
		} else if (size32 === 0) {
			size = end - offset;
		} else {
			size = size32;
		}
		if (size < headerSize || offset + size > end)
			invalid(`MP4 box ${type} has an invalid size.`);
		boxes.push({
			type,
			start: offset,
			payloadStart: offset + headerSize,
			end: offset + size,
		});
		offset += size;
	}
	if (offset !== end) invalid("MP4 box boundaries are not aligned.");
	return boxes;
}

function fullBoxVersion(bytes: Uint8Array, box: Mp4Box) {
	ensureRange(bytes, box.payloadStart, 4);
	return byte(bytes, box.payloadStart);
}

function parseMovieHeader(bytes: Uint8Array, box: Mp4Box) {
	const version = fullBoxVersion(bytes, box);
	if (version !== 0 && version !== 1)
		invalid("Unsupported MP4 movie header version.");
	const offset = box.payloadStart + (version === 1 ? 20 : 12);
	const durationOffset = box.payloadStart + (version === 1 ? 24 : 16);
	const timescale = uint32(bytes, offset);
	const duration =
		version === 1
			? uint64(bytes, durationOffset)
			: uint32(bytes, durationOffset);
	if (timescale <= 0 || duration <= 0)
		invalid("MP4 movie duration is invalid.");
	return { movieTimescale: timescale, movieDuration: duration };
}

function parseMediaHeader(bytes: Uint8Array, box: Mp4Box) {
	const version = fullBoxVersion(bytes, box);
	if (version !== 0 && version !== 1)
		invalid("Unsupported MP4 media header version.");
	const offset = box.payloadStart + (version === 1 ? 20 : 12);
	const durationOffset = box.payloadStart + (version === 1 ? 24 : 16);
	const timescale = uint32(bytes, offset);
	const duration =
		version === 1
			? uint64(bytes, durationOffset)
			: uint32(bytes, durationOffset);
	if (timescale <= 0 || duration <= 0)
		invalid("MP4 media duration is invalid.");
	return { timescale, duration };
}

function parseTrackDimensions(bytes: Uint8Array, box: Mp4Box) {
	const version = fullBoxVersion(bytes, box);
	if (version !== 0 && version !== 1)
		invalid("Unsupported MP4 track header version.");
	const widthOffset = box.payloadStart + (version === 1 ? 88 : 76);
	const heightOffset = widthOffset + 4;
	const widthFixed = uint32(bytes, widthOffset);
	const heightFixed = uint32(bytes, heightOffset);
	const durationOffset = box.payloadStart + (version === 1 ? 28 : 20);
	const duration =
		version === 1
			? uint64(bytes, durationOffset)
			: uint32(bytes, durationOffset);
	if (duration <= 0) invalid("MP4 track duration is invalid.");
	if (widthFixed % 0x10000 !== 0 || heightFixed % 0x10000 !== 0)
		invalid("MP4 track dimensions are not integral pixels.");
	return {
		width: widthFixed / 0x10000,
		height: heightFixed / 0x10000,
		duration,
	};
}

function parseHandler(bytes: Uint8Array, box: Mp4Box) {
	return ascii(bytes, box.payloadStart + 8, 4);
}

function parseTimeToSample(bytes: Uint8Array, box: Mp4Box) {
	const entryCount = uint32(bytes, box.payloadStart + 4);
	let offset = box.payloadStart + 8;
	let sampleCount = 0;
	let duration = 0;
	const entries: Array<{ count: number; delta: number }> = [];
	for (let index = 0; index < entryCount; index += 1) {
		const count = uint32(bytes, offset);
		const delta = uint32(bytes, offset + 4);
		if (count <= 0 || delta <= 0)
			invalid("MP4 sample timing entry is invalid.");
		sampleCount += count;
		duration += count * delta;
		if (!Number.isSafeInteger(sampleCount) || !Number.isSafeInteger(duration))
			invalid("MP4 sample timing exceeds the supported safe range.");
		entries.push({ count, delta });
		offset += 8;
	}
	if (offset !== box.end) invalid("MP4 time-to-sample table is truncated.");
	return { sampleCount, duration, entries };
}

function parseSampleSize(bytes: Uint8Array, box: Mp4Box) {
	const sampleSize = uint32(bytes, box.payloadStart + 4);
	const sampleCount = uint32(bytes, box.payloadStart + 8);
	if (sampleCount <= 0) invalid("MP4 sample-size table is empty.");
	const expectedEnd =
		box.payloadStart + 12 + (sampleSize === 0 ? sampleCount * 4 : 0);
	if (box.end !== expectedEnd)
		invalid("MP4 sample-size table is structurally invalid.");
	const sizes =
		sampleSize === 0
			? Array.from({ length: sampleCount }, (_, index) =>
					uint32(bytes, box.payloadStart + 12 + index * 4),
				)
			: null;
	if (sizes?.some((size) => size <= 0))
		invalid("MP4 sample-size table contains an empty sample.");
	return { sampleSize, sampleCount, sizes };
}

function parseChunkOffsets(bytes: Uint8Array, box: Mp4Box) {
	const entryCount = uint32(bytes, box.payloadStart + 4);
	if (entryCount <= 0) invalid("MP4 chunk-offset table is empty.");
	const offsets: number[] = [];
	let offset = box.payloadStart + 8;
	const wide = box.type === "co64";
	for (let index = 0; index < entryCount; index += 1) {
		const chunkOffset = wide ? uint64(bytes, offset) : uint32(bytes, offset);
		if (chunkOffset <= 0 || chunkOffset <= (offsets.at(-1) ?? 0))
			invalid("MP4 chunk offsets are invalid or non-monotonic.");
		offsets.push(chunkOffset);
		offset += wide ? 8 : 4;
	}
	if (offset !== box.end) invalid("MP4 chunk-offset table is truncated.");
	return offsets;
}

function parseChunkMap(bytes: Uint8Array, box: Mp4Box) {
	const entryCount = uint32(bytes, box.payloadStart + 4);
	if (entryCount <= 0) invalid("MP4 sample-to-chunk table is empty.");
	const expectedEnd = box.payloadStart + 8 + entryCount * 12;
	if (box.end !== expectedEnd)
		invalid("MP4 sample-to-chunk table is structurally invalid.");
	const entries: Array<{
		firstChunk: number;
		samplesPerChunk: number;
		sampleDescriptionIndex: number;
	}> = [];
	for (let index = 0; index < entryCount; index += 1) {
		const offset = box.payloadStart + 8 + index * 12;
		const firstChunk = uint32(bytes, offset);
		const samplesPerChunk = uint32(bytes, offset + 4);
		const sampleDescriptionIndex = uint32(bytes, offset + 8);
		if (
			firstChunk <= 0 ||
			(index === 0 && firstChunk !== 1) ||
			samplesPerChunk <= 0 ||
			sampleDescriptionIndex !== 1 ||
			firstChunk <= (entries.at(-1)?.firstChunk ?? 0)
		)
			invalid("MP4 sample-to-chunk entry is invalid.");
		entries.push({ firstChunk, samplesPerChunk, sampleDescriptionIndex });
	}
	return entries;
}

function parseCompositionOffsets(bytes: Uint8Array, box: Mp4Box) {
	const entryCount = uint32(bytes, box.payloadStart + 4);
	if (entryCount <= 0) invalid("MP4 composition-offset table is empty.");
	let offset = box.payloadStart + 8;
	for (let index = 0; index < entryCount; index += 1) {
		const count = uint32(bytes, offset);
		uint32(bytes, offset + 4);
		if (count <= 0) invalid("MP4 composition-offset entry is invalid.");
		offset += 8;
	}
	if (offset !== box.end) invalid("MP4 composition-offset table is truncated.");
	unsupported(
		"MP4 ctts composition offsets are unsupported by render-output-validation.v1.",
	);
}

function validateSampleLayout(input: {
	chunkOffsets: ReadonlyArray<number>;
	chunkMap: ReadonlyArray<{
		firstChunk: number;
		samplesPerChunk: number;
		sampleDescriptionIndex: number;
	}>;
	sampleCount: number;
	fixedSampleSize: number | null;
	sampleSizes: ReadonlyArray<number> | null;
	mdatRanges: ReadonlyArray<Readonly<{ start: number; end: number }>>;
}) {
	let mappedSampleCount = 0;
	for (const [entryIndex, entry] of input.chunkMap.entries()) {
		const firstChunkIndex = entry.firstChunk - 1;
		const nextEntry = input.chunkMap[entryIndex + 1];
		const nextFirstChunkIndex = nextEntry
			? nextEntry.firstChunk - 1
			: input.chunkOffsets.length;
		const chunkCount = nextFirstChunkIndex - firstChunkIndex;
		const entrySampleCount = chunkCount * entry.samplesPerChunk;
		if (!Number.isSafeInteger(entrySampleCount) || entrySampleCount <= 0)
			invalid("MP4 sample-to-chunk mapping exceeds the supported safe range.");
		mappedSampleCount += entrySampleCount;
		if (!Number.isSafeInteger(mappedSampleCount))
			invalid("MP4 sample-to-chunk mapping exceeds the supported safe range.");
	}
	if (mappedSampleCount !== input.sampleCount)
		invalid("MP4 sample-to-chunk mapping count disagrees with stsz.");
	let sampleIndex = 0;
	for (const [entryIndex, entry] of input.chunkMap.entries()) {
		const firstChunkIndex = entry.firstChunk - 1;
		const nextEntry = input.chunkMap[entryIndex + 1];
		const nextFirstChunkIndex = nextEntry
			? nextEntry.firstChunk - 1
			: input.chunkOffsets.length;
		if (
			firstChunkIndex < 0 ||
			firstChunkIndex >= input.chunkOffsets.length ||
			nextFirstChunkIndex <= firstChunkIndex ||
			nextFirstChunkIndex > input.chunkOffsets.length
		)
			invalid("MP4 sample-to-chunk entries reference invalid chunks.");
		for (
			let chunkIndex = firstChunkIndex;
			chunkIndex < nextFirstChunkIndex;
			chunkIndex += 1
		) {
			const chunkStart = input.chunkOffsets[chunkIndex];
			if (chunkStart === undefined) invalid("MP4 chunk is missing.");
			if (input.fixedSampleSize !== null) {
				const chunkEnd =
					chunkStart + entry.samplesPerChunk * input.fixedSampleSize;
				const nextChunkStart = input.chunkOffsets[chunkIndex + 1];
				if (nextChunkStart !== undefined && chunkEnd > nextChunkStart)
					invalid("MP4 samples overlap the next chunk.");
				if (
					!Number.isSafeInteger(chunkEnd) ||
					!input.mdatRanges.some(
						(range) => chunkStart >= range.start && chunkEnd <= range.end,
					)
				)
					invalid("MP4 fixed-size samples point outside mdat.");
				sampleIndex += entry.samplesPerChunk;
				continue;
			}
			let sampleCursor = chunkStart;
			for (
				let sampleOffset = 0;
				sampleOffset < entry.samplesPerChunk;
				sampleOffset += 1
			) {
				const sampleSize = input.sampleSizes?.[sampleIndex];
				if (sampleSize === undefined)
					invalid("MP4 sample-to-chunk mapping has too many samples.");
				const sampleEnd = sampleCursor + sampleSize;
				if (!Number.isSafeInteger(sampleEnd) || sampleEnd <= sampleCursor)
					invalid("MP4 sample interval exceeds the supported safe range.");
				if (
					!input.mdatRanges.some(
						(range) => sampleCursor >= range.start && sampleEnd <= range.end,
					)
				)
					invalid("MP4 sample interval points outside mdat.");
				sampleCursor = sampleEnd;
				sampleIndex += 1;
			}
			const nextChunkStart = input.chunkOffsets[chunkIndex + 1];
			if (nextChunkStart !== undefined && sampleCursor > nextChunkStart)
				invalid("MP4 samples overlap the next chunk.");
		}
	}
	if (sampleIndex !== input.sampleCount)
		invalid("MP4 sample-to-chunk mapping has too few samples.");
}

function parseAvc1(bytes: Uint8Array, entry: Mp4Box) {
	const width = uint16(bytes, entry.payloadStart + 24);
	const height = uint16(bytes, entry.payloadStart + 26);
	const childrenStart = entry.payloadStart + 78;
	const children = parseBoxes(bytes, childrenStart, entry.end);
	const avcConfiguration = children.find((child) => child.type === "avcC");
	if (
		!avcConfiguration ||
		avcConfiguration.end - avcConfiguration.payloadStart < 4
	)
		invalid("MP4 video sample entry has no AVC configuration.");
	const profileIdc = byte(bytes, avcConfiguration.payloadStart + 1);
	if (![0x42, 0x4d, 0x58, 0x64].includes(profileIdc))
		invalid("MP4 video sample entry is not a supported H.264/AVC profile.");
	return { width, height };
}

function parseAudioSpecificConfig(
	bytes: Uint8Array,
	offset: number,
	end: number,
) {
	if (end - offset < 2) invalid("AAC AudioSpecificConfig is truncated.");
	const objectType = byte(bytes, offset) >> 3;
	const sampleRateIndex =
		((byte(bytes, offset) & 0x07) << 1) | (byte(bytes, offset + 1) >> 7);
	const channelConfiguration = (byte(bytes, offset + 1) >> 3) & 0x0f;
	if (objectType !== 2) invalid("MP4 audio track is not AAC-LC.");
	const sampleRates = [
		96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
		8000, 7350,
	];
	const sampleRate = sampleRates[sampleRateIndex];
	if (!sampleRate || channelConfiguration <= 0)
		invalid("AAC audio metadata is invalid.");
	return {
		sampleRate,
		channels: channelConfiguration === 7 ? 8 : channelConfiguration,
	};
}

function parseMp4a(bytes: Uint8Array, entry: Mp4Box) {
	const channels = uint16(bytes, entry.payloadStart + 16);
	const sampleRateFixed = uint32(bytes, entry.payloadStart + 24);
	if (sampleRateFixed % 0x10000 !== 0)
		invalid("MP4 audio sample rate is not integral.");
	const sampleRate = sampleRateFixed / 0x10000;
	const children = parseBoxes(bytes, entry.payloadStart + 28, entry.end);
	const esds = children.find((child) => child.type === "esds");
	if (!esds)
		invalid("MP4 audio sample entry has no elementary stream descriptor.");
	let audioConfigOffset = -1;
	let audioConfigLength = 0;
	for (let offset = esds.payloadStart + 4; offset + 2 < esds.end; offset += 1) {
		if (bytes[offset] !== 0x05) continue;
		let length = 0;
		let cursor = offset + 1;
		for (let index = 0; index < 4 && cursor < esds.end; index += 1) {
			const value = byte(bytes, cursor++);
			length = (length << 7) | (value & 0x7f);
			if ((value & 0x80) === 0) break;
		}
		if (length >= 2 && cursor + length <= esds.end) {
			audioConfigOffset = cursor;
			audioConfigLength = length;
			break;
		}
	}
	if (audioConfigOffset < 0)
		invalid("MP4 audio sample entry has no AAC configuration.");
	const config = parseAudioSpecificConfig(
		bytes,
		audioConfigOffset,
		audioConfigOffset + audioConfigLength,
	);
	if (config.sampleRate !== sampleRate || config.channels !== channels)
		invalid("MP4 audio sample entry disagrees with its AAC configuration.");
	return config;
}

function expectedAudio(
	profile: OutputEncodingProfile,
	compositionInput: CompositionInputV1,
) {
	if (compositionInput.sceneComposition.audioTracks.length === 0) return null;
	if (!profile.audioCodec) return null;
	if (profile.audioCodec !== "AAC-LC")
		invalid("The output profile requests an unsupported audio codec.");
	return {
		codec: "AAC-LC" as const,
		sampleRate: profile.audioSampleRate,
		channels: profile.audioChannels,
	};
}

function validateContainer(
	ftypBytes: Uint8Array,
	moovBytes: Uint8Array,
	mdatRanges: ReadonlyArray<Readonly<{ start: number; end: number }>>,
	expectation: RenderOutputValidationExpectation,
) {
	const ftyp = parseBoxes(ftypBytes, 0, ftypBytes.byteLength)[0];
	if (ftyp?.type !== "ftyp") invalid("MP4 ftyp box is missing.");
	const majorBrand = ascii(ftypBytes, ftyp.payloadStart, 4);
	if (!majorBrand.trim()) invalid("MP4 major brand is empty.");
	const moov = parseBoxes(moovBytes, 0, moovBytes.byteLength).find(
		(box) => box.type === "moov",
	);
	if (!moov) invalid("MP4 moov box is missing.");
	const moovChildren = parseBoxes(moovBytes, moov.payloadStart, moov.end);
	const mvhd = moovChildren.find((box) => box.type === "mvhd");
	if (!mvhd) invalid("MP4 movie header is missing.");
	const movieHeader = parseMovieHeader(moovBytes, mvhd);
	const expectedWidth = expectation.compositionInput.profile.logicalWidth;
	const expectedHeight = expectation.compositionInput.profile.logicalHeight;
	const expectedFps = expectation.compositionInput.timeline.fps;
	const expectedFrames = BigInt(
		expectation.compositionInput.timeline.totalFrames,
	);
	if (
		BigInt(movieHeader.movieDuration) * BigInt(expectedFps.numerator) !==
		expectedFrames *
			BigInt(expectedFps.denominator) *
			BigInt(movieHeader.movieTimescale)
	)
		invalid(
			"MP4 movie duration does not match the exact composition timeline.",
		);
	const expectedAudioMetadata = expectedAudio(
		expectation.requestSpec.outputEncodingProfile,
		expectation.compositionInput,
	);
	let videoMetadata:
		| (ReturnType<typeof parseAvc1> & {
				frameCount: number;
				timescale: number;
				duration: number;
		  })
		| undefined;
	let audioMetadata: ReturnType<typeof parseMp4a> | null = null;
	for (const trak of moovChildren.filter((box) => box.type === "trak")) {
		const trakChildren = parseBoxes(moovBytes, trak.payloadStart, trak.end);
		if (trakChildren.some((box) => box.type === "edts" || box.type === "elst"))
			unsupported(
				"MP4 edit-list presentation semantics are unsupported by render-output-validation.v1.",
			);
		const tkhd = trakChildren.find((box) => box.type === "tkhd");
		const mdia = trakChildren.find((box) => box.type === "mdia");
		if (!tkhd || !mdia) invalid("MP4 track is missing required headers.");
		const trackDimensions = parseTrackDimensions(moovBytes, tkhd);
		const mdiaChildren = parseBoxes(moovBytes, mdia.payloadStart, mdia.end);
		const mdhd = mdiaChildren.find((box) => box.type === "mdhd");
		const hdlr = mdiaChildren.find((box) => box.type === "hdlr");
		const minf = mdiaChildren.find((box) => box.type === "minf");
		if (!mdhd || !hdlr || !minf) invalid("MP4 media track is incomplete.");
		const handler = parseHandler(moovBytes, hdlr);
		const mediaHeader = parseMediaHeader(moovBytes, mdhd);
		const minfChildren = parseBoxes(moovBytes, minf.payloadStart, minf.end);
		const stbl = minfChildren.find((box) => box.type === "stbl");
		if (!stbl) invalid("MP4 media track has no sample table.");
		const stblChildren = parseBoxes(moovBytes, stbl.payloadStart, stbl.end);
		const stsd = stblChildren.find((box) => box.type === "stsd");
		const stts = stblChildren.find((box) => box.type === "stts");
		const stsc = stblChildren.find((box) => box.type === "stsc");
		const stsz = stblChildren.find((box) => box.type === "stsz");
		const stco = stblChildren.find(
			(box) => box.type === "stco" || box.type === "co64",
		);
		if (!stsd || !stts || !stsc || !stsz || !stco)
			invalid("MP4 media track lacks a complete sample table.");
		const timing = parseTimeToSample(moovBytes, stts);
		const sizes = parseSampleSize(moovBytes, stsz);
		if (timing.sampleCount !== sizes.sampleCount)
			invalid("MP4 sample timing and sample-size counts disagree.");
		const chunkMap = parseChunkMap(moovBytes, stsc);
		const chunkOffsets = parseChunkOffsets(moovBytes, stco);
		validateSampleLayout({
			chunkOffsets,
			chunkMap,
			sampleCount: sizes.sampleCount,
			fixedSampleSize: sizes.sampleSize === 0 ? null : sizes.sampleSize,
			sampleSizes: sizes.sizes,
			mdatRanges,
		});
		const ctts = stblChildren.find((box) => box.type === "ctts");
		if (ctts) parseCompositionOffsets(moovBytes, ctts);
		const sampleEntryCount = uint32(moovBytes, stsd.payloadStart + 4);
		if (sampleEntryCount !== 1)
			invalid("MP4 track must have exactly one sample entry.");
		const sampleEntry = parseBoxes(
			moovBytes,
			stsd.payloadStart + 8,
			stsd.end,
		)[0];
		if (!sampleEntry) invalid("MP4 sample entry is missing.");
		if (handler === "vide") {
			if (sampleEntry.type !== "avc1" && sampleEntry.type !== "avc3")
				invalid("MP4 video track is not H.264/AVC.");
			const dimensions = parseAvc1(moovBytes, sampleEntry);
			if (
				dimensions.width !== trackDimensions.width ||
				dimensions.height !== trackDimensions.height
			)
				invalid("MP4 track header and sample entry dimensions disagree.");
			if (
				dimensions.width !== expectedWidth ||
				dimensions.height !== expectedHeight
			)
				invalid("MP4 dimensions do not match the exact composition profile.");
			const fpsNumerator = expectedFps.numerator;
			const fpsDenominator = expectedFps.denominator;
			if ((mediaHeader.timescale * fpsDenominator) % fpsNumerator !== 0)
				invalid(
					"MP4 timescale cannot represent the exact composition frame duration.",
				);
			const expectedDelta =
				(mediaHeader.timescale * fpsDenominator) / fpsNumerator;
			if (timing.entries.some((entry) => entry.delta !== expectedDelta))
				invalid(
					"MP4 every-frame timing deltas do not match the exact composition FPS.",
				);
			if (timing.duration !== timing.sampleCount * expectedDelta)
				invalid("MP4 frame timing does not match the exact composition FPS.");
			if (BigInt(timing.sampleCount) !== expectedFrames)
				invalid(
					"MP4 frame count does not match the exact composition timeline.",
				);
			if (
				BigInt(mediaHeader.duration) * BigInt(fpsNumerator) !==
				expectedFrames * BigInt(fpsDenominator) * BigInt(mediaHeader.timescale)
			)
				invalid("MP4 duration does not match the exact composition timeline.");
			if (
				BigInt(trackDimensions.duration) * BigInt(fpsNumerator) !==
				expectedFrames *
					BigInt(fpsDenominator) *
					BigInt(movieHeader.movieTimescale)
			)
				invalid(
					"MP4 video track presentation duration does not match the exact composition timeline.",
				);
			videoMetadata = {
				...dimensions,
				frameCount: timing.sampleCount,
				timescale: mediaHeader.timescale,
				duration: mediaHeader.duration,
			};
		} else if (handler === "soun") {
			if (!expectedAudioMetadata)
				invalid("Unexpected audio track in the output.");
			if (sampleEntry.type !== "mp4a") invalid("MP4 audio track is not AAC.");
			audioMetadata = parseMp4a(moovBytes, sampleEntry);
			if (
				audioMetadata.sampleRate !== expectedAudioMetadata.sampleRate ||
				audioMetadata.channels !== expectedAudioMetadata.channels
			)
				invalid("MP4 audio metadata does not match the output profile.");
		}
	}
	if (!videoMetadata) invalid("MP4 output has no video track.");
	if (expectedAudioMetadata && !audioMetadata)
		invalid("MP4 output is missing the audio track required by the profile.");
	return {
		schemaVersion: "render-output-metadata.v1" as const,
		container: "MP4" as const,
		mimeType: "video/mp4" as const,
		videoCodec: "H.264/AVC" as const,
		width: videoMetadata.width,
		height: videoMetadata.height,
		frameRate: expectedFps,
		totalFrames: expectedFrames.toString(),
		duration: {
			timescale: videoMetadata.timescale,
			value: String(videoMetadata.duration),
		},
		audio: audioMetadata
			? {
					codec: "AAC-LC" as const,
					sampleRate: audioMetadata.sampleRate,
					channels: audioMetadata.channels,
				}
			: null,
	};
}

function appendBytes(target: number[], source: Uint8Array) {
	for (const value of source) target.push(value);
}

export async function validateRenderOutputStream(
	stream: ReadableStream<Uint8Array>,
	expectation: RenderOutputValidationExpectation,
): Promise<StreamValidationResult> {
	const reader = stream.getReader();
	const hash = createHash("sha256");
	let byteSize = 0;
	let cursor = 0;
	let header: number[] = [];
	let boxStart = 0;
	let boxType = "";
	let boxSize = 0;
	let headerSize = 0;
	let payloadRemaining = 0;
	let capture: number[] | null = null;
	let ftypBytes: Uint8Array | undefined;
	let moovBytes: Uint8Array | undefined;
	const mdatRanges: Array<{ start: number; end: number }> = [];
	let sawMdat = false;

	const finishHeader = () => {
		if (header.length < 8) return false;
		const headerBytes = Uint8Array.from(header);
		const size32 = uint32(headerBytes, 0);
		boxType = ascii(headerBytes, 4, 4);
		headerSize = size32 === 1 ? 16 : 8;
		if (header.length < headerSize) return false;
		boxSize = size32 === 0 ? Number.POSITIVE_INFINITY : size32;
		if (size32 === 1) boxSize = uint64(headerBytes, 8);
		if (boxSize < headerSize)
			invalid(`MP4 box ${boxType} has an invalid size.`);
		if (boxSize > Number.MAX_SAFE_INTEGER) invalid("MP4 box is too large.");
		payloadRemaining =
			boxSize === Number.POSITIVE_INFINITY
				? Number.POSITIVE_INFINITY
				: boxSize - headerSize;
		capture = boxType === "ftyp" || boxType === "moov" ? [...header] : null;
		if (boxType === "moov" && boxSize > MAX_MOOV_BYTES)
			invalid("MP4 moov box exceeds the validation memory limit.");
		if (boxType === "ftyp" && boxSize > MAX_FTYP_BYTES)
			invalid("MP4 ftyp box exceeds the validation memory limit.");
		if (boxType === "mdat") {
			sawMdat = true;
			mdatRanges.push({
				start: boxStart + headerSize,
				end: boxStart + boxSize,
			});
		}
		header = [];
		return true;
	};

	const consume = (chunk: Uint8Array) => {
		let offset = 0;
		while (offset < chunk.byteLength) {
			if (payloadRemaining === 0) {
				if (capture && boxType === "ftyp") ftypBytes = Uint8Array.from(capture);
				if (capture && boxType === "moov") moovBytes = Uint8Array.from(capture);
				capture = null;
				boxType = "";
				boxSize = 0;
				headerSize = 0;
				boxStart = cursor;
			}
			if (!boxType) {
				if (header.length === 0) boxStart = cursor;
				const needed = (header.length < 8 ? 8 : 16) - header.length;
				const take = Math.min(needed, chunk.byteLength - offset);
				appendBytes(header, chunk.subarray(offset, offset + take));
				cursor += take;
				offset += take;
				if (!finishHeader()) continue;
			}
			if (
				payloadRemaining > 0 ||
				payloadRemaining === Number.POSITIVE_INFINITY
			) {
				const take =
					payloadRemaining === Number.POSITIVE_INFINITY
						? chunk.byteLength - offset
						: Math.min(payloadRemaining, chunk.byteLength - offset);
				if (
					capture &&
					capture.length + take >
						(boxType === "moov" ? MAX_MOOV_BYTES : MAX_FTYP_BYTES)
				)
					invalid("MP4 captured box exceeds the validation memory limit.");
				if (capture)
					appendBytes(capture, chunk.subarray(offset, offset + take));
				cursor += take;
				offset += take;
				if (payloadRemaining !== Number.POSITIVE_INFINITY)
					payloadRemaining -= take;
			}
		}
	};

	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			if (next.value?.byteLength) {
				hash.update(next.value);
				byteSize += next.value.byteLength;
				consume(next.value);
			}
		}
	} finally {
		reader.releaseLock();
	}
	if (payloadRemaining === 0 && boxType) {
		if (capture && boxType === "ftyp") ftypBytes = Uint8Array.from(capture);
		if (capture && boxType === "moov") moovBytes = Uint8Array.from(capture);
		capture = null;
		boxType = "";
		headerSize = 0;
		boxSize = 0;
	}
	if (boxType || header.length > 0 || payloadRemaining !== 0)
		invalid("MP4 output ended inside a box.");
	if (!ftypBytes || !moovBytes || !sawMdat)
		invalid("MP4 output must contain ftyp, moov and mdat boxes.");
	if (byteSize <= 0) invalid("MP4 output is empty.");
	const validatedMetadata = validateContainer(
		ftypBytes,
		moovBytes,
		mdatRanges,
		expectation,
	);
	return {
		byteSize,
		checksumSha256: hash.digest("hex"),
		validatedMetadata,
	};
}

export async function validateRenderOutputBytes(
	bytes: Uint8Array,
	expectation: RenderOutputValidationExpectation,
) {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
	return validateRenderOutputStream(stream, expectation);
}
