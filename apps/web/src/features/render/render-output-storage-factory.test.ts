import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createR2RenderOutputStorage } from "@affichannel/api/storage/render-output-storage-factory";
import { afterEach, describe, expect, it } from "vitest";

describe("AFF-US-021 EN001 21D R2 storage factory", () => {
	let root = "";

	afterEach(async () => {
		if (root) await rm(root, { recursive: true, force: true });
		root = "";
	});

	it("builds the actual PutObjectCommand with IfNoneMatch=*, without live R2", async () => {
		root = await mkdtemp(join(tmpdir(), "affichannel-r2-factory-"));
		const commands: unknown[] = [];
		const client = {
			async send(command: unknown) {
				commands.push(command);
				if (
					command &&
					typeof command === "object" &&
					"input" in command &&
					(command as { input?: { Key?: string } }).input?.Key
				)
					return {
						Body: Readable.from([Buffer.from([1, 2, 3])]),
						ContentLength: 3,
						ContentType: "video/mp4",
					};
				return {};
			},
		} as never;
		const storage = createR2RenderOutputStorage(
			{
				endpoint: "https://r2.example.test",
				bucket: "bucket",
				accessKeyId: "access",
				secretAccessKey: "secret",
			},
			{ client, tempRoot: root },
		);

		await storage.createOnce({
			storageKey: "render-artifacts/v1/w1/p1/job1/attempt1/reservation1.mp4",
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array([1, 2, 3]));
					controller.close();
				},
			}),
		});
		const put = commands.find(
			(command) =>
				command &&
				typeof command === "object" &&
				"input" in command &&
				(command as { input?: { IfNoneMatch?: string } }).input?.IfNoneMatch,
		) as { input?: { IfNoneMatch?: string } } | undefined;
		expect(put?.input?.IfNoneMatch).toBe("*");
	});
});
