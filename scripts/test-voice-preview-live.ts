import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({
	path: resolve(process.cwd(), "apps/web/.env"),
	override: true,
});

if (process.env.AFFICHANNEL_LIVE_TTS_SMOKE !== "1") {
	console.log(
		"SKIPPED — live TTS smoke disabled. Set AFFICHANNEL_LIVE_TTS_SMOKE=1 explicitly to permit one paid preview request.",
	);
	process.exit(0);
}

const apiKey = process.env.TTS_APIKEY_FUN_API_KEY?.trim();
if (!apiKey) {
	console.error("Live TTS smoke requested, but TTS API key is not configured.");
	process.exit(1);
}

const { ApiKeyFunTtsProvider } = await import(
	"../packages/api/src/providers/tts/apikeyfun-tts-provider.ts"
);
const provider = new ApiKeyFunTtsProvider({
	apiKey,
	baseUrl: process.env.TTS_APIKEY_FUN_BASE_URL,
	timeoutMs: Number(process.env.TTS_PREVIEW_TIMEOUT_MS ?? 30_000),
});
const result = await provider.preview({
	text: "Xin chào.",
	voiceId: "eve",
	language: "vi",
	speed: 1,
});

if (result.contentType !== "audio/mpeg" || result.audio.byteLength === 0) {
	throw new Error("Live TTS smoke returned an invalid audio preview.");
}
console.log(
	`Live TTS smoke passed: ${result.contentType}, ${result.audio.byteLength} bytes, ${result.latencyMs ?? "unknown"} ms. Audio was not persisted.`,
);
