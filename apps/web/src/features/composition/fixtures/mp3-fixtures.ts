/**
 * Deterministic checked-in MPEG fixtures. The expected sample counts below
 * are fixture authority; production inspection is never used to derive them.
 * The frames contain silence-like ancillary bytes and are intentionally kept
 * small so the tests never need a provider or an encoder at runtime.
 */
export type Mp3Fixture = Readonly<{
	bytes: Uint8Array;
	sourceSampleRate: 44100;
	sourceChannels: 1 | 2;
	sourceSampleFrames: number;
	decodedSampleFrames: number;
	encoderDelay: number;
	endPadding: number;
	frameCount: number;
	id3v2: boolean;
}>;

const FRAME_LENGTH = 417;
const SAMPLES_PER_FRAME = 1152;
const DEFAULT_FRAME_COUNT = 41;

function writeUint32Be(bytes: Uint8Array, offset: number, value: number) {
	bytes[offset] = (value >>> 24) & 0xff;
	bytes[offset + 1] = (value >>> 16) & 0xff;
	bytes[offset + 2] = (value >>> 8) & 0xff;
	bytes[offset + 3] = value & 0xff;
}

function writeGaplessFields(
	bytes: Uint8Array,
	offset: number,
	delay: number,
	padding: number,
) {
	bytes[offset] = delay >> 4;
	bytes[offset + 1] = ((delay & 0x0f) << 4) | (padding >> 8);
	bytes[offset + 2] = padding & 0xff;
}

export function makeMp3Fixture(
	options: {
		channels?: 1 | 2;
		frameCount?: number;
		encoderDelay?: number;
		endPadding?: number;
		id3v2?: boolean;
		infoFlags?: number;
		advertisedFrameCount?: number;
		includeLame?: boolean;
	} = {},
): Mp3Fixture {
	const channels = options.channels ?? 2;
	const frameCount = options.frameCount ?? DEFAULT_FRAME_COUNT;
	const encoderDelay = options.encoderDelay ?? 0;
	const endPadding = options.endPadding ?? 0;
	const id3v2 = options.id3v2 ?? false;
	const prefixLength = id3v2 ? 10 : 0;
	const bytes = new Uint8Array(prefixLength + FRAME_LENGTH * frameCount);
	if (id3v2) {
		bytes.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0], 0);
	}
	const header = [0xff, 0xfb, 0x90, channels === 1 ? 0xc4 : 0x64];
	for (let index = 0; index < frameCount; index += 1) {
		bytes.set(header, prefixLength + index * FRAME_LENGTH);
	}

	const firstFrameOffset = prefixLength;
	const xingOffset = firstFrameOffset + (channels === 1 ? 21 : 36);
	bytes.set(new TextEncoder().encode("Info"), xingOffset);
	writeUint32Be(bytes, xingOffset + 4, options.infoFlags ?? 0x01);
	writeUint32Be(
		bytes,
		xingOffset + 8,
		options.advertisedFrameCount ?? frameCount,
	);
	let lameOffset = xingOffset + 12;
	if ((options.infoFlags ?? 0x01) & 0x02) lameOffset += 4;
	if ((options.infoFlags ?? 0x01) & 0x04) lameOffset += 100;
	if ((options.infoFlags ?? 0x01) & 0x08) lameOffset += 4;
	if (options.includeLame !== false) {
		bytes.set(new TextEncoder().encode("LAME3.99.5"), lameOffset);
		writeGaplessFields(bytes, lameOffset + 21, encoderDelay, endPadding);
	}
	const decodedSampleFrames = frameCount * SAMPLES_PER_FRAME;
	return {
		bytes,
		sourceSampleRate: 44100,
		sourceChannels: channels,
		sourceSampleFrames: decodedSampleFrames - encoderDelay - endPadding,
		decodedSampleFrames,
		encoderDelay,
		endPadding,
		frameCount,
		id3v2,
	};
}

export const monoMp3Fixture = makeMp3Fixture({ channels: 1 });
export const stereoMp3Fixture = makeMp3Fixture({ channels: 2 });
export const id3PrefixedMp3Fixture = makeMp3Fixture({ id3v2: true });
export const validGaplessMp3Fixture = makeMp3Fixture({
	encoderDelay: 576,
	endPadding: 1000,
});
export const missingFrameFlagMp3Fixture = makeMp3Fixture({ infoFlags: 0 });
export const malformedFrameCountMp3Fixture = makeMp3Fixture({
	advertisedFrameCount: DEFAULT_FRAME_COUNT + 1,
});
export const malformedLameMp3Fixture = makeMp3Fixture({
	includeLame: false,
});

/** Static provenance values are reviewed independently of the loader output. */
export const mp3FixtureProvenance = {
	mono: {
		sourcePcmSampleRate: 44100,
		sourceChannels: 1,
		sourcePcmSampleFrames: 47232,
		expectedUsableMp3SampleFrames: 47232,
		encodedFixtureSha256:
			"2b0241e245fe27e2bfa6b963067c9690f6d37e42b6e53ddfed8fa63663d2a101",
		encoder: "deterministic MPEG frame fixture v1",
	},
	stereo: {
		sourcePcmSampleRate: 44100,
		sourceChannels: 2,
		sourcePcmSampleFrames: 47232,
		expectedUsableMp3SampleFrames: 47232,
		encodedFixtureSha256:
			"b4c3cc9e420a7b3a69726af88f8046b07ffe817e5c0d9e36ffa7c2f2d74b193a",
		encoder: "deterministic MPEG frame fixture v1",
	},
	gapless: {
		sourcePcmSampleRate: 44100,
		sourceChannels: 2,
		sourcePcmSampleFrames: 45656,
		expectedUsableMp3SampleFrames: 45656,
		encodedFixtureSha256:
			"67322fd4de7ece6a256102fbddd0c5a33f4d39f669a26b820a13171b5ca2a538",
		encoder: "deterministic MPEG frame fixture v1; delay=576; padding=1000",
	},
	id3Prefixed: {
		sourcePcmSampleRate: 44100,
		sourceChannels: 2,
		sourcePcmSampleFrames: 47232,
		expectedUsableMp3SampleFrames: 47232,
		encodedFixtureSha256:
			"01a07f78fbca9b5829063953e8f1b41b11ea8be92553b6a5cc35517e21ef533a",
		encoder: "deterministic MPEG frame fixture v1; ID3v2.4 prefix",
	},
} as const;
