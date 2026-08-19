import { listVoicePresets } from "@affichannel/core";
import { describe, expect, it, vi } from "vitest";

import {
	createVoiceStudioDraft,
	getVoiceStudioErrorCode,
	getVoiceStudioErrorMessage,
	isVoiceStudioFactLockError,
	releaseVoicePreviewUrl,
	voiceStudioDraftEquals,
} from "./voice-studio-state";

const presets = listVoicePresets();

describe("Voice Studio state", () => {
	it("derives the initial draft from the server catalog", () => {
		expect(createVoiceStudioDraft(presets, null)).toEqual({
			voiceId: "ara",
			language: "vi",
			speed: 1,
		});
	});

	it("hydrates a persisted config and detects only actual edits as dirty", () => {
		const config = {
			voiceId: "eve",
			language: "vi",
			speed: 1.2,
		} as const;
		const draft = createVoiceStudioDraft(presets, {
			...config,
			id: "config-1",
			workspaceId: "workspace-1",
			projectId: "project-1",
			provider: "apikeyfun",
			revision: 3,
			createdBy: "user-1",
			updatedBy: "user-1",
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		expect(draft).toEqual(config);
		expect(draft).not.toBeNull();
		if (!draft) throw new Error("Expected a draft from persisted config.");
		expect(
			voiceStudioDraftEquals(draft, {
				...config,
				id: "config-1",
				workspaceId: "workspace-1",
				projectId: "project-1",
				provider: "apikeyfun",
				revision: 3,
				createdBy: "user-1",
				updatedBy: "user-1",
				createdAt: new Date(),
				updatedAt: new Date(),
			}),
		).toBe(true);
		expect(
			voiceStudioDraftEquals(
				{ ...draft, speed: 1.3 },
				{
					...config,
					id: "config-1",
					workspaceId: "workspace-1",
					projectId: "project-1",
					provider: "apikeyfun",
					revision: 3,
					createdBy: "user-1",
					updatedBy: "user-1",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			),
		).toBe(false);
	});

	it("maps server and preview errors to safe localized messages", () => {
		const conflict = { data: { code: "VOICE_CONFIG_CONFLICT" } };
		const previewProviderError = { code: "TTS_PROVIDER_UNAVAILABLE" };

		expect(getVoiceStudioErrorCode(conflict)).toBe("VOICE_CONFIG_CONFLICT");
		expect(getVoiceStudioErrorMessage(conflict)).toContain(
			"thay đổi ở nơi khác",
		);
		expect(getVoiceStudioErrorCode(previewProviderError)).toBe(
			"TTS_PROVIDER_UNAVAILABLE",
		);
		expect(getVoiceStudioErrorMessage(previewProviderError)).toContain(
			"chưa khả dụng",
		);
		expect(isVoiceStudioFactLockError({ code: "FACT_LOCK_STALE_SCRIPT" })).toBe(
			true,
		);
	});

	it("revokes the previous Blob URL when preview is replaced or cleared", () => {
		const revoke = vi.fn();

		releaseVoicePreviewUrl("blob:first", revoke);
		releaseVoicePreviewUrl(null, revoke);

		expect(revoke).toHaveBeenCalledTimes(1);
		expect(revoke).toHaveBeenCalledWith("blob:first");
	});
});
