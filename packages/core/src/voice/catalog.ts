import { z } from "zod";

import { VoiceConfigError } from "./errors";

export const TTS_PROVIDER = "apikeyfun" as const;
export const TTS_LANGUAGE = "vi" as const;
export const TTS_SPEED_MIN = 0.7;
export const TTS_SPEED_MAX = 1.5;
export const TTS_SPEED_DEFAULT = 1;

export type VoicePreset = {
	id: string;
	provider: typeof TTS_PROVIDER;
	displayName: string;
	supportedLanguages: readonly [
		typeof TTS_LANGUAGE,
		...(typeof TTS_LANGUAGE)[],
	];
	minSpeed: number;
	maxSpeed: number;
	defaultSpeed: number;
	previewSupported: boolean;
};

const voicePresetCatalog: readonly VoicePreset[] = [
	{
		id: "ara",
		provider: TTS_PROVIDER,
		displayName: "Ara",
		supportedLanguages: [TTS_LANGUAGE],
		minSpeed: TTS_SPEED_MIN,
		maxSpeed: TTS_SPEED_MAX,
		defaultSpeed: TTS_SPEED_DEFAULT,
		previewSupported: true,
	},
	{
		id: "eve",
		provider: TTS_PROVIDER,
		displayName: "Eve",
		supportedLanguages: [TTS_LANGUAGE],
		minSpeed: TTS_SPEED_MIN,
		maxSpeed: TTS_SPEED_MAX,
		defaultSpeed: TTS_SPEED_DEFAULT,
		previewSupported: true,
	},
	{
		id: "leo",
		provider: TTS_PROVIDER,
		displayName: "Leo",
		supportedLanguages: [TTS_LANGUAGE],
		minSpeed: TTS_SPEED_MIN,
		maxSpeed: TTS_SPEED_MAX,
		defaultSpeed: TTS_SPEED_DEFAULT,
		previewSupported: true,
	},
	{
		id: "rex",
		provider: TTS_PROVIDER,
		displayName: "Rex",
		supportedLanguages: [TTS_LANGUAGE],
		minSpeed: TTS_SPEED_MIN,
		maxSpeed: TTS_SPEED_MAX,
		defaultSpeed: TTS_SPEED_DEFAULT,
		previewSupported: true,
	},
	{
		id: "sal",
		provider: TTS_PROVIDER,
		displayName: "Sal",
		supportedLanguages: [TTS_LANGUAGE],
		minSpeed: TTS_SPEED_MIN,
		maxSpeed: TTS_SPEED_MAX,
		defaultSpeed: TTS_SPEED_DEFAULT,
		previewSupported: true,
	},
];

export const voiceConfigFieldsSchema = z
	.object({
		voiceId: z.string().trim().min(1).max(120),
		language: z.string().trim().min(2).max(20),
		speed: z.number().finite(),
	})
	.strict();

export function listVoicePresets(): VoicePreset[] {
	return voicePresetCatalog.map((preset) => ({
		...preset,
		supportedLanguages: [...preset.supportedLanguages] as [
			typeof TTS_LANGUAGE,
			...(typeof TTS_LANGUAGE)[],
		],
	}));
}

export function findVoicePreset(voiceId: string) {
	return voicePresetCatalog.find((preset) => preset.id === voiceId);
}

export function validateVoiceConfigFields(raw: unknown) {
	const parsed = voiceConfigFieldsSchema.safeParse(raw);
	if (!parsed.success) {
		throw new VoiceConfigError(
			"VOICE_CONFIG_INPUT_INVALID",
			"Voice configuration contains invalid fields.",
		);
	}

	const { voiceId, language, speed } = parsed.data;
	const preset = findVoicePreset(voiceId);
	if (!preset) {
		throw new VoiceConfigError(
			"TTS_VOICE_NOT_FOUND",
			"Voice preset không tồn tại.",
			{
				voiceId,
			},
		);
	}
	if (!preset.supportedLanguages.includes(language as typeof TTS_LANGUAGE)) {
		throw new VoiceConfigError(
			"TTS_LANGUAGE_NOT_SUPPORTED",
			"Ngôn ngữ không được hỗ trợ cho voice preset.",
			{ language, voiceId },
		);
	}
	if (speed < preset.minSpeed || speed > preset.maxSpeed) {
		throw new VoiceConfigError(
			"TTS_SPEED_OUT_OF_RANGE",
			"Tốc độ voice nằm ngoài khoảng cho phép.",
			{ minSpeed: preset.minSpeed, maxSpeed: preset.maxSpeed, speed },
		);
	}

	return parsed.data;
}
