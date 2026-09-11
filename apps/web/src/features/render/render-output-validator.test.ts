import { createHash } from "node:crypto";
import {
	RenderOutputValidationError,
	validateRenderOutputBytes,
} from "@affichannel/api/services/render-output-validator";
import type {
	CompositionInputV1,
	RenderRequestSpecV1,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";
import {
	deterministicRenderOutputFixture,
	deterministicRenderOutputFixtureProvenance,
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

function expectation(totalFrames = "1", width = 1080) {
	return {
		requestSpec: {
			schemaVersion: "render-request.v1",
			compositionVersionId: "composition-v1",
			compositionFingerprint: "a".repeat(64),
			outputEncodingProfile: testProfile,
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
		} as unknown as CompositionInputV1,
	};
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

	it("does not accept an ftyp-only byte sequence", async () => {
		const ftypOnly = deterministicRenderOutputFixture.slice(0, 24);
		await expect(
			validateRenderOutputBytes(ftypOnly, expectation()),
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
