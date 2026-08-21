import { describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
	VOICE_AUDIO_STORAGE_PROVIDER: "r2" as "local" | "r2",
	VOICE_AUDIO_LOCAL_ROOT: ".data/voice-audio",
	R2_ENDPOINT: undefined as string | undefined,
	R2_BUCKET: undefined as string | undefined,
	R2_ACCESS_KEY_ID: undefined as string | undefined,
	R2_SECRET_ACCESS_KEY: undefined as string | undefined,
}));

vi.mock("@affichannel/env/server", () => ({ env: mockEnv }));

const { createVoiceAudioStorage, createR2VoiceAudioStorage } = await import(
	"@affichannel/api/storage/voice-audio-storage-factory"
);

describe("voice audio storage factory", () => {
	it("fails closed when R2 is selected without complete server credentials", () => {
		expect(() => createVoiceAudioStorage()).toThrowError(
			expect.objectContaining({ code: "TTS_STORAGE_CONFIGURATION_INVALID" }),
		);
	});

	it("creates an R2 adapter without making a network call", () => {
		const storage = createR2VoiceAudioStorage({
			endpoint: "https://r2.example.test",
			bucket: "private-audio",
			accessKeyId: "test-access",
			secretAccessKey: "test-secret",
		});
		expect(storage.provider).toBe("r2");
	});
});
