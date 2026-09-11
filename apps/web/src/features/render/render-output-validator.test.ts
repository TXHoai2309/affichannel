import { createHash } from "node:crypto";
import {
	RenderOutputUnsupportedError,
	RenderOutputValidationError,
	validateRenderOutputBytes,
} from "@affichannel/api/services/render-output-validator";
import type {
	CompositionInputV1,
	RenderRequestSpecV1,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";
import {
	deterministicCompositionOffsetRenderOutputFixture,
	deterministicEditListRenderOutputFixture,
	deterministicFirstChunkTwoRenderOutputFixture,
	deterministicFixedChunkOverlapRenderOutputFixture,
	deterministicFixedSampleOutsideMdatRenderOutputFixture,
	deterministicMalformedTimingRenderOutputFixture,
	deterministicRenderOutputFixture,
	deterministicRenderOutputFixtureProvenance,
	deterministicVariableChunkOverlapRenderOutputFixture,
	deterministicVideoOnlyRenderOutputFixture,
} from "./render-output-fixture";

const testProfile = {
	id: "mp4-h264-aac-v1",
	container: "MP4",
	videoCodec: "H.264/AVC",
	pixelFormat: "yuv420p",
	audioCodec: "AAC-LC",
	audioSampleRate: 48_000,
	audioChannels: 2,
	colorDelivery: "BT.709",
	videoBitrateKbps: 100,
	videoCrf: 23,
	audioBitrateKbps: 96,
	keyframeIntervalFrames: 30,
} as const;

function expectation(
	totalFrames = "1",
	width = 1080,
	options: {
		hasAudio?: boolean;
		audioSampleRate?: number;
		audioChannels?: number;
	} = {},
) {
	const hasAudio = options.hasAudio ?? true;
	return {
		requestSpec: {
			schemaVersion: "render-request.v1",
			compositionVersionId: "composition-v1",
			compositionFingerprint: "a".repeat(64),
			outputEncodingProfile: {
				...testProfile,
				audioSampleRate: options.audioSampleRate ?? testProfile.audioSampleRate,
				audioChannels: options.audioChannels ?? testProfile.audioChannels,
			},
			outputEncodingProfileFingerprint: "b".repeat(64),
			outputContractVersion: "test-output-contract.v1",
		} as unknown as RenderRequestSpecV1,
		compositionInput: {
			profile: {
				logicalWidth: width,
				logicalHeight: 1920,
			},
			timeline: {
				fps: { numerator: 30, denominator: 1 },
				totalFrames,
			},
			sceneComposition: {
				scenes: [],
				audioTracks: hasAudio ? [{}] : [],
			},
		} as unknown as CompositionInputV1,
	};
}

function findAscii(bytes: Uint8Array, value: string) {
	const needle = new TextEncoder().encode(value);
	for (let index = 0; index <= bytes.length - needle.length; index += 1) {
		if (needle.every((item, offset) => bytes[index + offset] === item))
			return index;
	}
	throw new Error(`box ${value} not found`);
}

function withU32(bytes: Uint8Array, offset: number, value: number) {
	const result = bytes.slice();
	result.set(
		new Uint8Array([
			(value >>> 24) & 0xff,
			(value >>> 16) & 0xff,
			(value >>> 8) & 0xff,
			value & 0xff,
		]),
		offset,
	);
	return result;
}

describe("AFF-US-021 EN001 21D output proof", () => {
	it("accepts the deterministic exact MP4 fixture", async () => {
		const result = await validateRenderOutputBytes(
			deterministicRenderOutputFixture,
			expectation(),
		);
		expect(result.byteSize).toBe(
			deterministicRenderOutputFixtureProvenance.byteSize,
		);
		expect(result.checksumSha256).toBe(
			deterministicRenderOutputFixtureProvenance.sha256,
		);
		expect(result.validatedMetadata).toMatchObject({
			videoCodec: "H.264/AVC",
			width: 1080,
			height: 1920,
			frameRate: { numerator: 30, denominator: 1 },
			totalFrames: "1",
			audio: { codec: "AAC-LC", sampleRate: 48_000, channels: 2 },
		});
	});

	it("binds timing and dimensions to the exact composition contract", async () => {
		await expect(
			validateRenderOutputBytes(
				deterministicRenderOutputFixture,
				expectation("2"),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);
		await expect(
			validateRenderOutputBytes(
				deterministicRenderOutputFixture,
				expectation("1", 720),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);
	});

	it("proves the exact movie and video-track presentation durations", async () => {
		const mvhd = findAscii(deterministicRenderOutputFixture, "mvhd");
		await expect(
			validateRenderOutputBytes(
				withU32(deterministicRenderOutputFixture, mvhd + 20, 2),
				expectation(),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);

		const tkhd = findAscii(deterministicRenderOutputFixture, "tkhd");
		await expect(
			validateRenderOutputBytes(
				withU32(deterministicRenderOutputFixture, tkhd + 24, 2),
				expectation(),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);

		await expect(
			validateRenderOutputBytes(
				deterministicRenderOutputFixture,
				expectation(),
			),
		).resolves.toMatchObject({ validatedMetadata: { totalFrames: "1" } });
	});

	it("classifies edit lists and composition offsets as typed unsupported features", async () => {
		await expect(
			validateRenderOutputBytes(
				deterministicEditListRenderOutputFixture,
				expectation(),
			),
		).rejects.toMatchObject({ code: "RENDER_OUTPUT_UNSUPPORTED" });
		await expect(
			validateRenderOutputBytes(
				deterministicEditListRenderOutputFixture,
				expectation(),
			),
		).rejects.toBeInstanceOf(RenderOutputUnsupportedError);
		await expect(
			validateRenderOutputBytes(
				deterministicCompositionOffsetRenderOutputFixture,
				expectation(),
			),
		).rejects.toMatchObject({ code: "RENDER_OUTPUT_UNSUPPORTED" });
	});

	it("does not accept an ftyp-only byte sequence", async () => {
		const ftypOnly = deterministicRenderOutputFixture.slice(0, 24);
		await expect(
			validateRenderOutputBytes(ftypOnly, expectation()),
		).rejects.toBeInstanceOf(RenderOutputValidationError);
	});

	it("maps every declared sample interval into mdat", async () => {
		await expect(
			validateRenderOutputBytes(
				deterministicFirstChunkTwoRenderOutputFixture,
				expectation("2", 1080, { hasAudio: false }),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);
		await expect(
			validateRenderOutputBytes(
				deterministicFixedChunkOverlapRenderOutputFixture,
				expectation("2", 1080, { hasAudio: false }),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);
		await expect(
			validateRenderOutputBytes(
				deterministicFixedSampleOutsideMdatRenderOutputFixture,
				expectation("1", 1080, { hasAudio: false }),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);
		await expect(
			validateRenderOutputBytes(
				deterministicVariableChunkOverlapRenderOutputFixture,
				expectation("2", 1080, { hasAudio: false }),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);

		const stsz = findAscii(deterministicRenderOutputFixture, "stsz");
		await expect(
			validateRenderOutputBytes(
				withU32(deterministicRenderOutputFixture, stsz + 4 + 4, 10_000),
				expectation(),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);

		const stsc = findAscii(
			deterministicMalformedTimingRenderOutputFixture,
			"stsc",
		);
		await expect(
			validateRenderOutputBytes(
				withU32(
					deterministicMalformedTimingRenderOutputFixture,
					stsc + 4 + 12,
					1,
				),
				expectation("2"),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);
		await expect(
			validateRenderOutputBytes(
				withU32(
					deterministicMalformedTimingRenderOutputFixture,
					stsc + 4 + 8,
					0,
				),
				expectation("2"),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);
	});

	it("rejects aggregate-correct but uneven per-frame timing", async () => {
		await expect(
			validateRenderOutputBytes(
				deterministicMalformedTimingRenderOutputFixture,
				expectation("2"),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);
	});

	it("treats audio as conditional on the composition contract", async () => {
		await expect(
			validateRenderOutputBytes(
				deterministicVideoOnlyRenderOutputFixture,
				expectation("1", 1080, { hasAudio: false }),
			),
		).resolves.toMatchObject({ validatedMetadata: { audio: null } });
		await expect(
			validateRenderOutputBytes(
				deterministicVideoOnlyRenderOutputFixture,
				expectation(),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);
		await expect(
			validateRenderOutputBytes(
				deterministicRenderOutputFixture,
				expectation("1", 1080, { audioSampleRate: 44_100 }),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);
		await expect(
			validateRenderOutputBytes(
				deterministicRenderOutputFixture,
				expectation("1", 1080, { audioChannels: 1 }),
			),
		).rejects.toBeInstanceOf(RenderOutputValidationError);
	});

	it("records independent SHA-256 authority for the fixture", () => {
		expect(
			createHash("sha256")
				.update(deterministicRenderOutputFixture)
				.digest("hex"),
		).toBe(deterministicRenderOutputFixtureProvenance.sha256);
	});
});
