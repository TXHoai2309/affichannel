import { describe, expect, it, vi } from "vitest";

import { requestVoicePreview } from "./voice-preview-client";

describe("voice preview binary client", () => {
	it("requests the protected endpoint and accepts audio/mpeg", async () => {
		const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(new Uint8Array([0xff, 0xfb, 0x90]), {
				status: 200,
				headers: { "content-type": "audio/mpeg; charset=binary" },
			}),
		);

		const blob = await requestVoicePreview(
			"project/with spaces",
			fetchImplementation,
		);

		expect(blob.type).toBe("audio/mpeg");
		expect(blob.size).toBe(3);
		expect(fetchImplementation).toHaveBeenCalledWith(
			"/api/projects/project%2Fwith%20spaces/voice/preview",
			expect.objectContaining({
				method: "POST",
				credentials: "include",
				headers: { Accept: "audio/mpeg" },
			}),
		);
	});

	it("surfaces the server code for non-2xx JSON responses", async () => {
		const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				JSON.stringify({
					code: "FACT_LOCK_REQUIRED",
					reason: "SCRIPT_CLAIMS_NOT_CURRENT",
				}),
				{
					status: 409,
					headers: { "content-type": "application/json" },
				},
			),
		);

		await expect(
			requestVoicePreview("project-1", fetchImplementation),
		).rejects.toMatchObject({
			code: "FACT_LOCK_REQUIRED",
			reason: "SCRIPT_CLAIMS_NOT_CURRENT",
		});
	});

	it.each([
		["text/html", new Uint8Array([1])],
		["audio/wav", new Uint8Array([1])],
		["audio/mpeg", new Uint8Array()],
	] as const)(
		"rejects an unsafe preview response (%s)",
		async (contentType, body) => {
			const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
				new Response(body, {
					status: 200,
					headers: { "content-type": contentType },
				}),
			);

			await expect(
				requestVoicePreview("project-1", fetchImplementation),
			).rejects.toMatchObject({
				name: "VoicePreviewClientError",
				code: "TTS_PREVIEW_FAILED",
			});
		},
	);
});
