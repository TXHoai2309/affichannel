import {
	createApprovedQuickImageExecutionAdapter,
	createDeniedQuickImageExecutionAdapter,
} from "@affichannel/api/services/quick-image-render-execution-adapter";
import {
	sha256Hex,
	T09_FFMPEG_TOOL_MANIFEST,
	US22_QUICK_IMAGE_FFMPEG_TOOL_APPROVAL,
	US22_QUICK_IMAGE_FFMPEG_TOOL_MANIFEST,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

describe("AFF-US-022-D3 Quick Image live execution authority", () => {
	it("keeps T09 history pending and binds a separate US22 approval identity", async () => {
		expect(T09_FFMPEG_TOOL_MANIFEST.approvalStatus).toBe(
			"PENDING_BINARY_APPROVAL",
		);
		expect(US22_QUICK_IMAGE_FFMPEG_TOOL_MANIFEST.approvalStatus).toBe(
			"APPROVED",
		);
		expect(await sha256Hex(US22_QUICK_IMAGE_FFMPEG_TOOL_MANIFEST)).toBe(
			"5945b177eb5d519ef9194da92969d2f4bef49b4090d024da43d6546faa45c84e",
		);
		expect(US22_QUICK_IMAGE_FFMPEG_TOOL_APPROVAL).toMatchObject({
			schemaVersion: "affichannel-quick-image-tool-approval.v1",
			executablePath:
				"C:\\Program Files\\Affichannel\\ffmpeg\\9.0.1-essentials_build\\bin\\ffmpeg.exe",
			profileId: "mp4-h264-video-only-v1",
			profileFingerprint:
				"6e72408da1c49c0f869ecb286bb89644fc6142a3a684a9f168f85f30384efb26",
			commandPlanVersion: "quick-image-command-plan.v1",
			approvedSourceMimeTypes: ["image/png", "image/jpeg"],
			approvedFrameCounts: [150, 300, 450],
			shell: false,
			pathFallback: false,
		});
	});

	it("keeps the default production boundary blocked without explicit approval", async () => {
		await expect(
			createDeniedQuickImageExecutionAdapter()({} as never),
		).resolves.toMatchObject({
			outcome: "BLOCKED",
			errorCode: "QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED",
		});
		expect(createApprovedQuickImageExecutionAdapter).toBeTypeOf("function");
	});
});
