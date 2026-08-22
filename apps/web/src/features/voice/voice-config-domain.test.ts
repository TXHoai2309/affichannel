import {
	listVoicePresets,
	TTS_LANGUAGE,
	TTS_PROVIDER,
	TTS_SPEED_DEFAULT,
	TTS_SPEED_MAX,
	TTS_SPEED_MIN,
	VoiceConfigError,
	validateVoiceConfigFields,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

describe("AFF-US-011 VoiceConfig domain", () => {
	it("exposes the verified deterministic server catalog", () => {
		const presets = listVoicePresets();

		expect(presets.map((preset) => preset.id)).toEqual([
			"ara",
			"eve",
			"leo",
			"rex",
			"sal",
		]);
		expect(presets).toHaveLength(5);
		for (const preset of presets) {
			expect(preset.provider).toBe(TTS_PROVIDER);
			expect(preset.supportedLanguages).toEqual([TTS_LANGUAGE]);
			expect(preset.minSpeed).toBe(TTS_SPEED_MIN);
			expect(preset.maxSpeed).toBe(TTS_SPEED_MAX);
			expect(preset.defaultSpeed).toBe(TTS_SPEED_DEFAULT);
			expect(preset.previewSupported).toBe(true);
		}
	});

	it("accepts each catalog voice at the canonical Vietnamese speed", () => {
		for (const voiceId of ["ara", "eve", "leo", "rex", "sal"]) {
			expect(
				validateVoiceConfigFields({
					voiceId,
					language: "vi",
					speed: 1,
				}),
			).toEqual({ voiceId, language: "vi", speed: 1 });
		}
	});

	it.each([
		["TTS_VOICE_NOT_FOUND", { voiceId: "nope", language: "vi", speed: 1 }],
		[
			"TTS_LANGUAGE_NOT_SUPPORTED",
			{ voiceId: "ara", language: "en", speed: 1 },
		],
		["TTS_SPEED_OUT_OF_RANGE", { voiceId: "ara", language: "vi", speed: 0.69 }],
	] as const)("rejects invalid fields with %s", (code, input) => {
		expect(() => validateVoiceConfigFields(input)).toThrow(VoiceConfigError);
		try {
			validateVoiceConfigFields(input);
		} catch (error) {
			expect(error).toBeInstanceOf(VoiceConfigError);
			expect((error as VoiceConfigError).code).toBe(code);
		}
	});

	it("distinguishes malformed configuration input from speed range errors", () => {
		for (const input of [
			{ voiceId: "", language: "vi", speed: 1 },
			{ voiceId: "eve", language: "", speed: 1 },
			{ voiceId: "eve", language: "vi", speed: Number.NaN },
			{ voiceId: "eve", language: "vi", speed: Number.POSITIVE_INFINITY },
		]) {
			expect(() => validateVoiceConfigFields(input)).toThrowError(
				VoiceConfigError,
			);
			try {
				validateVoiceConfigFields(input);
			} catch (error) {
				expect((error as VoiceConfigError).code).toBe(
					"VOICE_CONFIG_INPUT_INVALID",
				);
			}
		}
	});

	it("keeps finite numeric range errors separate from malformed numbers", () => {
		for (const speed of [0.69, 1.51]) {
			expect(() =>
				validateVoiceConfigFields({ voiceId: "eve", language: "vi", speed }),
			).toThrowError(VoiceConfigError);
			try {
				validateVoiceConfigFields({ voiceId: "eve", language: "vi", speed });
			} catch (error) {
				expect((error as VoiceConfigError).code).toBe("TTS_SPEED_OUT_OF_RANGE");
			}
		}

		for (const speed of [0.7, 1, 1.5]) {
			expect(
				validateVoiceConfigFields({ voiceId: "eve", language: "vi", speed }),
			).toEqual({ voiceId: "eve", language: "vi", speed });
		}
	});
});
