import {
	FactLockError,
	type ScriptVersionEditableSnapshot,
	VoiceConfigError,
	validateVoiceConfigFields,
} from "@affichannel/core";
import { env } from "@affichannel/env/server";

import { TTS_PREVIEW_MAX_BYTES } from "../providers/tts/apikeyfun-tts-provider";
import type {
	TtsPreviewResult,
	TtsProvider,
} from "../providers/tts/tts-provider";
import { resolveTtsProvider } from "../providers/tts/tts-provider-registry";
import { FactLockGate } from "./fact-lock-gate-service";
import { findCurrentScriptVersion } from "./script-version-repository";
import { getVoiceConfig } from "./voice-config-service";
import { assertVoicePaidExecutionAuthorized } from "./voice-paid-authorization-service";
import type { WorkspaceActor } from "./workspace";

export const VOICE_PREVIEW_FALLBACK_TEXT =
	"Xin chào, đây là bản nghe thử giọng đọc cho nội dung của bạn.";

export type VoicePreviewResult = TtsPreviewResult & {
	sourceScriptVersionId: string;
	sourceScriptRevision: number;
	configRevision: number;
};

export type VoicePreviewDependencies = {
	provider?: TtsProvider;
	maxChars?: number;
	authorizePaidExecution?: typeof assertVoicePaidExecutionAuthorized;
};

function normalizedText(value: string) {
	return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function truncateByCodePoint(value: string, maxChars: number) {
	return Array.from(value).slice(0, maxChars).join("");
}

export function deriveVoicePreviewText(
	snapshot: ScriptVersionEditableSnapshot,
	maxChars = env.TTS_PREVIEW_MAX_CHARS,
) {
	const candidate = snapshot.voiceoverSegments
		.map((segment) => normalizedText(segment.text))
		.find(Boolean);
	const source = candidate || VOICE_PREVIEW_FALLBACK_TEXT;
	return truncateByCodePoint(normalizedText(source), maxChars);
}

function staleFactLock(
	reason: string,
	gate: Awaited<ReturnType<typeof FactLockGate.assertPassed>>,
) {
	return new FactLockError(
		"FACT_LOCK_REQUIRED",
		"Fact Lock hoặc ScriptVersion đã thay đổi; cần chạy lại Fact Lock.",
		{
			reason,
			currentScriptVersionId: gate.currentScriptVersionId,
			currentScriptRevision: gate.currentScriptRevision,
		},
	);
}

function validateProviderResult(result: TtsPreviewResult) {
	if (
		result.contentType !== "audio/mpeg" ||
		result.audio.byteLength === 0 ||
		result.audio.byteLength > TTS_PREVIEW_MAX_BYTES
	) {
		throw new VoiceConfigError(
			"TTS_PREVIEW_FAILED",
			"TTS provider trả về audio preview không hợp lệ.",
		);
	}
}

export async function previewVoice(
	actor: WorkspaceActor,
	projectId: string,
	dependencies: VoicePreviewDependencies = {},
): Promise<VoicePreviewResult> {
	const preparedScript = await findCurrentScriptVersion(actor, projectId);
	const preparedGate = await FactLockGate.evaluate(actor, projectId);
	const authorizePaidExecution =
		dependencies.authorizePaidExecution ?? assertVoicePaidExecutionAuthorized;
	await authorizePaidExecution(actor, projectId);
	if (
		!preparedScript ||
		preparedGate.currentScriptVersionId !== preparedScript.id ||
		preparedGate.currentScriptRevision !== preparedScript.revision
	) {
		throw staleFactLock(preparedGate.reason, preparedGate);
	}

	const text = deriveVoicePreviewText(
		preparedScript.editableSnapshot,
		dependencies.maxChars,
	);
	const preparedConfig = await getVoiceConfig(actor, projectId);
	if (!preparedConfig) {
		throw new VoiceConfigError("VOICE_CONFIG_NOT_FOUND");
	}
	const fields = validateVoiceConfigFields({
		voiceId: preparedConfig.voiceId,
		language: preparedConfig.language,
		speed: preparedConfig.speed,
	});
	const currentScript = await findCurrentScriptVersion(actor, projectId);
	const finalGate = await FactLockGate.evaluate(actor, projectId);
	if (
		!currentScript ||
		currentScript.id !== preparedScript.id ||
		currentScript.revision !== preparedScript.revision ||
		finalGate.currentScriptVersionId !== preparedScript.id ||
		finalGate.currentScriptRevision !== preparedScript.revision
	) {
		throw staleFactLock(finalGate.reason, finalGate);
	}

	const finalConfig = await getVoiceConfig(actor, projectId);
	if (!finalConfig) {
		throw new VoiceConfigError("VOICE_CONFIG_NOT_FOUND");
	}
	if (
		finalConfig.id !== preparedConfig.id ||
		finalConfig.revision !== preparedConfig.revision
	) {
		throw new VoiceConfigError(
			"VOICE_CONFIG_CONFLICT",
			"VoiceConfig đã thay đổi; vui lòng tải lại cấu hình.",
			{ latestRevision: finalConfig.revision },
		);
	}

	await authorizePaidExecution(actor, projectId);
	const provider =
		dependencies.provider ?? resolveTtsProvider(finalConfig.provider);
	if (!provider) {
		throw new VoiceConfigError(
			"TTS_PROVIDER_UNAVAILABLE",
			"TTS provider mặc định không khả dụng.",
		);
	}

	const result = await provider.preview({
		text,
		voiceId: fields.voiceId,
		language: fields.language,
		speed: fields.speed,
	});
	validateProviderResult(result);
	return {
		...result,
		sourceScriptVersionId: preparedScript.id,
		sourceScriptRevision: preparedScript.revision,
		configRevision: preparedConfig.revision,
	};
}
