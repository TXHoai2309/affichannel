import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, symlinkSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	createT09TestRenderExecutionAdapter,
	executeT09FfmpegProcess,
	T09_EXECUTION_TIMEOUT_MS,
	T09_MAX_OUTPUT_BYTES,
	T09_PROCESS_LOG_LIMIT_BYTES,
} from "@affichannel/api/services/render-prototype-execution-adapter";
import {
	assertT09FilesystemPathAuthority,
	createT09AttemptOutputStagingPath,
	createT09ServerOwnedStagingPath,
	prepareT09AttemptOutputStaging,
} from "@affichannel/api/services/render-prototype-staging";
import { assertT09StagedOutputHandoff } from "@affichannel/api/services/render-prototype-staging-handoff";
import { resolveT09FfmpegTool } from "@affichannel/api/services/render-prototype-tool-resolver";
import { executeRenderAdapterWithHeartbeat } from "@affichannel/api/services/render-worker-service";
import {
	classifyRenderExecutionOutcome,
	T09_FFMPEG_TOOL_MANIFEST,
	type T09OutputReady,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

class FakeChild extends EventEmitter {
	readonly stdout = new EventEmitter();
	readonly stderr = new EventEmitter();
	killCount = 0;

	constructor(private readonly closeOnKill = true) {
		super();
	}

	kill() {
		this.killCount += 1;
		if (this.closeOnKill)
			queueMicrotask(() => this.emit("close", null, "SIGTERM"));
		return true;
	}
}

function childAsProcess(child: FakeChild) {
	return child as unknown as ChildProcessWithoutNullStreams;
}

const testRoot = join(tmpdir(), "affichannel-t09-test-root");
mkdirSync(testRoot, { recursive: true });
const outputPath = createT09AttemptOutputStagingPath({
	rootPath: testRoot,
	jobId: "job-1",
	attemptId: "attempt-1",
	attemptNumber: 1,
	outputReservationId: "reservation-1",
});

const outputReady: T09OutputReady = {
	schemaVersion: "t09-output-ready.v1",
	kind: "OUTPUT_READY",
	jobId: "job-1",
	attemptId: "attempt-1",
	attemptNumber: 1,
	outputReservationId: "reservation-1",
};

function command(
	overrides: Partial<{
		argv: readonly string[];
		executablePath: string;
		toolManifestIdentity: string;
		toolBinarySha256: string;
	}> = {},
) {
	return {
		executablePath: overrides.executablePath ?? "C:\\approved\\ffmpeg.exe",
		toolManifestIdentity: overrides.toolManifestIdentity ?? "a".repeat(64),
		toolBinarySha256: overrides.toolBinarySha256 ?? "b".repeat(64),
		argv: overrides.argv ?? ["-hide_banner", "-n", outputPath.absolutePath],
		outputPath: outputPath.absolutePath,
		filterGraph: "[0:v]format=yuv420p[vout]",
	} as const;
}

async function approvedToolFixture() {
	const root = await mkdtemp(join(resolve("."), "t09-approved-tool-"));
	const bytes = Buffer.from("approved-test-binary");
	const executablePath = join(root, "ffmpeg.exe");
	await writeFile(executablePath, bytes);
	const binarySha256 = createHash("sha256").update(bytes).digest("hex");
	const manifest = {
		...T09_FFMPEG_TOOL_MANIFEST,
		approvalStatus: "APPROVED" as const,
		version: "pinned-test-build",
		binarySha256,
		buildIdentity: "test-build-identity",
		sourceOrDistributionReference: "owner-approved-test-fixture",
		licenseMetadata: {
			ffmpegLicense: "LGPL-2.1-or-later",
			encoderLicenses: ["x264-license-review-required"],
			noticeSha256: binarySha256,
		},
	};
	const tool = await resolveT09FfmpegTool({
		configuredPath: executablePath,
		manifest,
	});
	return { root, executablePath, tool };
}

function spawnThat(
	child: FakeChild,
	input: { exitCode: number | null; signal?: NodeJS.Signals | null },
) {
	return (
		_executablePath: string,
		_argv: readonly string[],
		_options: unknown,
	) => {
		queueMicrotask(() =>
			child.emit("close", input.exitCode, input.signal ?? null),
		);
		return childAsProcess(child);
	};
}

function wait(ms: number) {
	return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));
}

describe("AFF-US-021 EN001 21E-B T09 execution contract", () => {
	it("returns identity-only OUTPUT_READY after successful process exit", async () => {
		const child = new FakeChild();
		const result = await executeT09FfmpegProcess(
			{ commandPlan: command(), outputPath, outputReady },
			{
				spawn: spawnThat(child, { exitCode: 0 }),
				probeOutput: async () => ({
					state: "PRESENT",
					byteSize: 1024,
				}),
			},
		);

		expect(result).toEqual({ outcome: "SUCCESS", outputReady });
		expect(Object.keys(outputReady)).toEqual([
			"schemaVersion",
			"kind",
			"jobId",
			"attemptId",
			"attemptNumber",
			"outputReservationId",
		]);
		expect(classifyRenderExecutionOutcome(result)).toBe("INDETERMINATE");
	});

	it("requires resolver authority before the default real runner boundary", async () => {
		const result = await executeT09FfmpegProcess({
			commandPlan: command(),
			outputPath,
			outputReady,
		});

		expect(result).toMatchObject({
			outcome: "FAILURE",
			classification: "DETERMINISTIC",
			sideEffectFree: true,
			errorCode: "T09_FFMPEG_BINARY_APPROVAL_REQUIRED",
		});
	});

	it("revalidates approved identity immediately before a fake test spawn", async () => {
		const fixture = await approvedToolFixture();
		try {
			const child = new FakeChild();
			const result = await executeT09FfmpegProcess(
				{
					commandPlan: command({
						executablePath: fixture.executablePath,
						toolManifestIdentity: fixture.tool.manifestIdentity,
						toolBinarySha256: fixture.tool.binarySha256,
					}),
					outputPath,
					outputReady,
					approvedTool: fixture.tool,
				},
				{
					spawn: spawnThat(child, { exitCode: 0 }),
					probeOutput: async () => ({ state: "PRESENT", byteSize: 1024 }),
				},
			);
			expect(result).toMatchObject({ outcome: "SUCCESS" });
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it("rejects an executable changed after initial resolver approval", async () => {
		const fixture = await approvedToolFixture();
		try {
			await writeFile(fixture.executablePath, "changed-binary");
			let spawned = false;
			const result = await executeT09FfmpegProcess(
				{
					commandPlan: command({
						executablePath: fixture.executablePath,
						toolManifestIdentity: fixture.tool.manifestIdentity,
						toolBinarySha256: fixture.tool.binarySha256,
					}),
					outputPath,
					outputReady,
					approvedTool: fixture.tool,
				},
				{
					spawn: () => {
						spawned = true;
						throw new Error("must not spawn");
					},
				},
			);
			expect(spawned).toBe(false);
			expect(result).toMatchObject({
				outcome: "FAILURE",
				errorCode: "T09_FFMPEG_BINARY_HASH_MISMATCH",
			});
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it("rejects a plain object that attempts to copy resolver fields", async () => {
		const fixture = await approvedToolFixture();
		try {
			let spawned = false;
			const result = await executeT09FfmpegProcess(
				{
					commandPlan: command({
						executablePath: fixture.executablePath,
						toolManifestIdentity: fixture.tool.manifestIdentity,
						toolBinarySha256: fixture.tool.binarySha256,
					}),
					outputPath,
					outputReady,
					approvedTool: { ...fixture.tool },
				},
				{
					spawn: () => {
						spawned = true;
						throw new Error("must not spawn");
					},
				},
			);
			expect(spawned).toBe(false);
			expect(result).toMatchObject({
				outcome: "FAILURE",
				errorCode: "T09_FFMPEG_BINARY_APPROVAL_REQUIRED",
			});
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it("allows a candidate exactly at the 64 MiB ceiling", async () => {
		const child = new FakeChild();
		const result = await executeT09FfmpegProcess(
			{ commandPlan: command(), outputPath, outputReady },
			{
				spawn: spawnThat(child, { exitCode: 0 }),
				probeOutput: async () => ({
					state: "PRESENT",
					byteSize: T09_MAX_OUTPUT_BYTES,
				}),
			},
		);

		expect(result).toEqual({ outcome: "SUCCESS", outputReady });
	});

	it("fails closed above the 64 MiB ceiling without OUTPUT_READY", async () => {
		const child = new FakeChild();
		const result = await executeT09FfmpegProcess(
			{ commandPlan: command(), outputPath, outputReady },
			{
				spawn: spawnThat(child, { exitCode: 0 }),
				probeOutput: async () => ({
					state: "PRESENT",
					byteSize: T09_MAX_OUTPUT_BYTES + 1,
				}),
			},
		);

		expect(result).toMatchObject({
			outcome: "FAILURE",
			classification: "DETERMINISTIC",
			sideEffectFree: false,
			terminal: true,
			errorCode: "OUTPUT_SIZE_LIMIT_EXCEEDED",
		});
		expect(classifyRenderExecutionOutcome(result)).toBe("FAILED");
	});

	it("terminates a running process when the output ceiling is observed", async () => {
		const child = new FakeChild();
		const result = await executeT09FfmpegProcess(
			{ commandPlan: command(), outputPath, outputReady, timeoutMs: 1_000 },
			{
				spawn: () => childAsProcess(child),
				probeOutput: async () => ({
					state: "PRESENT",
					byteSize: T09_MAX_OUTPUT_BYTES + 1,
				}),
			},
		);

		expect(child.killCount).toBe(1);
		expect(result).toMatchObject({
			errorCode: "OUTPUT_SIZE_LIMIT_EXCEEDED",
			terminal: true,
		});
	});

	it("derives adapter OUTPUT_READY from the claimed snapshot", async () => {
		const snapshot = {
			jobId: "job-1",
			attemptId: "attempt-1",
			attemptNumber: 1,
			leaseOwner: "worker-1",
			execution: { outputReservationId: "reservation-1" },
		} as never;
		const adapter = createT09TestRenderExecutionAdapter({
			resolvePlan: async () => ({
				commandPlan: command(),
				outputPath,
				approvedTool: undefined as never,
			}),
			process: async (input) => {
				expect(input.outputReady).toEqual(outputReady);
				return { outcome: "SUCCESS", outputReady: input.outputReady };
			},
		});

		expect(await adapter({ snapshot })).toEqual({
			outcome: "SUCCESS",
			outputReady,
		});
	});

	it("maps a post-spawn injected exception to INDETERMINATE", async () => {
		const adapter = createT09TestRenderExecutionAdapter({
			resolvePlan: async () => ({
				commandPlan: command(),
				outputPath,
				approvedTool: undefined as never,
			}),
			process: async () => {
				throw new Error("output probe failed after spawn");
			},
		});
		const result = await adapter({
			snapshot: {
				jobId: "job-1",
				attemptId: "attempt-1",
				attemptNumber: 1,
				leaseOwner: "worker-1",
				execution: { outputReservationId: "reservation-1" },
			} as never,
		});

		expect(result).toMatchObject({
			outcome: "FAILURE",
			classification: "RETRYABLE",
			sideEffectFree: false,
			errorCode: "T09_POST_SPAWN_EXCEPTION",
		});
	});

	it("heartbeats during adapter execution and stops afterward", async () => {
		let heartbeatCount = 0;
		const result = await executeRenderAdapterWithHeartbeat({
			snapshot: {
				jobId: "job-1",
				attemptId: "attempt-1",
				attemptNumber: 1,
				leaseOwner: "worker-1",
			} as never,
			adapter: async () => {
				await wait(15);
				return { outcome: "SUCCESS" };
			},
			heartbeatIntervalMs: 2,
			heartbeat: async () => {
				heartbeatCount += 1;
				return true;
			},
		});
		const countAfterExecution = heartbeatCount;
		await wait(10);

		expect(result).toEqual({ outcome: "SUCCESS" });
		expect(countAfterExecution).toBeGreaterThan(0);
		expect(heartbeatCount).toBe(countAfterExecution);
	});

	it("cancels and preserves ambiguity after heartbeat lease loss", async () => {
		let aborted = false;
		const result = await executeRenderAdapterWithHeartbeat({
			snapshot: {
				jobId: "job-1",
				attemptId: "attempt-1",
				attemptNumber: 1,
				leaseOwner: "worker-1",
			} as never,
			adapter: async ({ signal }) => {
				await wait(15);
				aborted = signal?.aborted ?? false;
				return { outcome: "SUCCESS" };
			},
			heartbeatIntervalMs: 2,
			heartbeat: async () => false,
		});

		expect(aborted).toBe(true);
		expect(result).toMatchObject({
			outcome: "FAILURE",
			classification: "RETRYABLE",
			sideEffectFree: false,
			errorCode: "RENDER_LEASE_LOST_DURING_EXECUTION",
		});
		expect(classifyRenderExecutionOutcome(result)).toBe("INDETERMINATE");
	});

	it("rejects overwrite mode before spawning a child process", async () => {
		let spawned = false;
		const result = await executeT09FfmpegProcess(
			{
				commandPlan: command({ argv: ["-y", outputPath.absolutePath] }),
				outputPath,
				outputReady,
			},
			{
				spawn: () => {
					spawned = true;
					throw new Error("must not spawn");
				},
			},
		);

		expect(spawned).toBe(false);
		expect(result).toMatchObject({
			outcome: "FAILURE",
			classification: "DETERMINISTIC",
			sideEffectFree: true,
			errorCode: "T09_EXECUTION_CONTRACT_INVALID",
		});
	});

	it("rejects an output-ready identity that does not own the staging path", async () => {
		let spawned = false;
		const result = await executeT09FfmpegProcess(
			{
				commandPlan: command(),
				outputPath,
				outputReady: { ...outputReady, outputReservationId: "reservation-2" },
			},
			{
				spawn: () => {
					spawned = true;
					throw new Error("must not spawn");
				},
			},
		);

		expect(spawned).toBe(false);
		expect(result).toMatchObject({
			outcome: "FAILURE",
			errorCode: "T09_EXECUTION_CONTRACT_INVALID",
		});
	});

	it("maps a non-zero exit with proven absence to deterministic failure", async () => {
		const child = new FakeChild();
		const result = await executeT09FfmpegProcess(
			{ commandPlan: command(), outputPath, outputReady },
			{
				spawn: spawnThat(child, { exitCode: 1 }),
				probeOutput: async () => ({ state: "ABSENT" }),
			},
		);

		expect(result).toMatchObject({
			outcome: "FAILURE",
			classification: "DETERMINISTIC",
			sideEffectFree: true,
			errorCode: "T09_PROCESS_NON_ZERO_EXIT",
		});
	});

	it("classifies spawn failure without PATH fallback", async () => {
		const result = await executeT09FfmpegProcess(
			{ commandPlan: command(), outputPath, outputReady },
			{
				spawn: () => {
					const error = Object.assign(new Error("missing binary"), {
						code: "ENOENT",
					});
					throw error;
				},
			},
		);

		expect(result).toMatchObject({
			outcome: "FAILURE",
			classification: "DETERMINISTIC",
			sideEffectFree: true,
			errorCode: "T09_BINARY_NOT_FOUND",
		});
	});

	it("maps failed execution with present output to INDETERMINATE", async () => {
		const child = new FakeChild();
		const result = await executeT09FfmpegProcess(
			{ commandPlan: command(), outputPath, outputReady },
			{
				spawn: spawnThat(child, { exitCode: 1 }),
				probeOutput: async () => ({
					state: "PRESENT",
					byteSize: 1024,
				}),
			},
		);

		expect(result).toMatchObject({
			outcome: "FAILURE",
			sideEffectFree: false,
			errorCode: "T09_PROCESS_FAILED_OUTPUT_PRESENT",
		});
		expect(classifyRenderExecutionOutcome(result)).toBe("INDETERMINATE");
	});

	it("does not treat timeout termination as proof of side-effect freedom", async () => {
		const child = new FakeChild();
		const result = await executeT09FfmpegProcess(
			{ commandPlan: command(), outputPath, outputReady, timeoutMs: 1 },
			{
				spawn: () => childAsProcess(child),
				probeOutput: async () => ({
					state: "PRESENT",
					byteSize: 1024,
				}),
			},
		);

		expect(child.killCount).toBe(1);
		expect(result).toMatchObject({
			outcome: "FAILURE",
			sideEffectFree: false,
			errorCode: "T09_PROCESS_TIMEOUT_TERMINATION_UNCERTAIN",
		});
	});

	it("does not treat cancellation with output as side-effect-free", async () => {
		const child = new FakeChild();
		const controller = new AbortController();
		controller.abort();
		const result = await executeT09FfmpegProcess(
			{
				commandPlan: command(),
				outputPath,
				outputReady,
				signal: controller.signal,
			},
			{
				spawn: () => childAsProcess(child),
				probeOutput: async () => ({
					state: "PRESENT",
					byteSize: 1024,
				}),
			},
		);

		expect(result).toMatchObject({
			outcome: "FAILURE",
			sideEffectFree: false,
			errorCode: "T09_PROCESS_CANCELLED_TERMINATION_UNCERTAIN",
		});
	});

	it("maps unknown output state to INDETERMINATE", async () => {
		const child = new FakeChild();
		const result = await executeT09FfmpegProcess(
			{ commandPlan: command(), outputPath, outputReady },
			{
				spawn: spawnThat(child, { exitCode: 0 }),
				probeOutput: async () => ({ state: "UNKNOWN" }),
			},
		);

		expect(result).toMatchObject({
			outcome: "FAILURE",
			sideEffectFree: false,
			errorCode: "T09_OUTPUT_PRESENCE_UNKNOWN",
		});
		expect(classifyRenderExecutionOutcome(result)).toBe("INDETERMINATE");
	});

	it("classifies a timeout with proven absence conservatively unless retry is explicit", async () => {
		const child = new FakeChild();
		const result = await executeT09FfmpegProcess(
			{ commandPlan: command(), outputPath, outputReady, timeoutMs: 1 },
			{
				spawn: () => childAsProcess(child),
				probeOutput: async () => ({ state: "ABSENT" }),
			},
		);

		expect(result).toMatchObject({
			outcome: "FAILURE",
			classification: "RETRYABLE",
			sideEffectFree: false,
			errorCode: "T09_PROCESS_TIMEOUT_TERMINATION_UNCERTAIN",
		});
		expect(classifyRenderExecutionOutcome(result)).toBe("INDETERMINATE");
	});

	it("returns bounded indeterminate when close acknowledgement never arrives", async () => {
		const child = new FakeChild(false);
		const started = Date.now();
		const result = await executeT09FfmpegProcess(
			{ commandPlan: command(), outputPath, outputReady, timeoutMs: 1 },
			{
				spawn: () => childAsProcess(child),
				terminationAckTimeoutMs: 5,
				probeOutput: async () => ({ state: "ABSENT" }),
			},
		);

		expect(Date.now() - started).toBeLessThan(500);
		expect(result).toMatchObject({
			outcome: "FAILURE",
			classification: "RETRYABLE",
			sideEffectFree: false,
			errorCode: "T09_PROCESS_TERMINATION_UNCONFIRMED",
		});
		expect(classifyRenderExecutionOutcome(result)).toBe("INDETERMINATE");
	});

	it("bounds and redacts combined process diagnostics", async () => {
		const child = new FakeChild();
		const resultPromise = executeT09FfmpegProcess(
			{ commandPlan: command(), outputPath, outputReady },
			{
				spawn: (executablePath, argv, options) => {
					expect(executablePath).toBe("C:\\approved\\ffmpeg.exe");
					expect(argv).toEqual(command().argv);
					expect(options).toMatchObject({
						cwd: outputPath.rootPath,
						shell: false,
						windowsHide: true,
						stdio: ["ignore", "pipe", "pipe"],
					});
					expect(options.env).not.toHaveProperty("PATH");
					expect(options.env).not.toHaveProperty("DATABASE_URL");
					expect(options.env).not.toHaveProperty(
						"RENDER_OUTPUT_R2_SECRET_ACCESS_KEY",
					);
					expect(options.env).not.toHaveProperty("AUTHORIZATION");
					queueMicrotask(() => {
						child.stderr.emit(
							"data",
							`DATABASE_URL=postgres://user:secret@127.0.0.1/db ${"x".repeat(T09_PROCESS_LOG_LIMIT_BYTES + 100)}`,
						);
						child.emit("close", 1, null);
					});
					return childAsProcess(child);
				},
				probeOutput: async () => ({ state: "ABSENT" }),
			},
		);
		const result = await resultPromise;
		const message = (result as { errorMessage?: string }).errorMessage ?? "";

		expect(message).toContain("[REDACTED]");
		expect(message).not.toContain("secret@127.0.0.1");
		expect(message).toContain("process diagnostics truncated");
		expect(Buffer.byteLength(message)).toBeLessThanOrEqual(
			T09_PROCESS_LOG_LIMIT_BYTES + 256,
		);
	});

	it("keeps the owner-locked production timeout", () => {
		expect(T09_EXECUTION_TIMEOUT_MS).toBe(120_000);
	});

	it("derives attempt output staging from server identities only", () => {
		const path = createT09AttemptOutputStagingPath({
			rootPath: outputPath.rootPath,
			jobId: outputReady.jobId,
			attemptId: outputReady.attemptId,
			attemptNumber: outputReady.attemptNumber,
			outputReservationId: outputReady.outputReservationId,
		});
		expect(path.absolutePath).toContain("attempts");
		expect(path.absolutePath).toContain("output.mp4");
		expect(() =>
			createT09ServerOwnedStagingPath({
				rootPath: outputPath.rootPath,
				relativePath: "../outside.mp4",
			}),
		).toThrow("must remain inside");
	});

	it("materializes the exact attempt parent idempotently without precreating output", async () => {
		const root = await mkdtemp(join(tmpdir(), "t09-materialize-"));
		try {
			const path = createT09AttemptOutputStagingPath({
				rootPath: root,
				jobId: "job-materialize",
				attemptId: "attempt-materialize",
				attemptNumber: 2,
				outputReservationId: "reservation-materialize",
			});
			const prepared = await prepareT09AttemptOutputStaging(path);
			const parent = resolve(path.absolutePath, "..");
			expect(prepared.absolutePath).toBe(path.absolutePath);
			expect(stat(parent).then((value) => value.isDirectory())).resolves.toBe(
				true,
			);
			expect(stat(path.absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
			await expect(prepareT09AttemptOutputStaging(path)).resolves.toBe(path);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("shows the materialized parent to the fake spawn with the exact no-overwrite argv", async () => {
		let spawnParent: string | undefined;
		const child = new FakeChild();
		const result = await executeT09FfmpegProcess(
			{
				commandPlan: command({
					argv: [
						"-hide_banner",
						"-n",
						"-use_editlist",
						"0",
						outputPath.absolutePath,
					],
				}),
				outputPath,
				outputReady,
			},
			{
				spawn: (_executablePath, argv, options) => {
					spawnParent = options.cwd;
					expect(argv.at(-1)).toBe(outputPath.absolutePath);
					expect(argv).toContain("-n");
					expect(argv).toContain("-use_editlist");
					expect(argv[argv.indexOf("-use_editlist") + 1]).toBe("0");
					expect(argv).not.toContain("-y");
					expect(argv).not.toContain("-avoid_negative_ts");
					return spawnThat(child, { exitCode: 0 })(
						_executablePath,
						argv,
						options,
					);
				},
				probeOutput: async () => ({ state: "PRESENT", byteSize: 1024 }),
			},
		);

		expect(result).toMatchObject({ outcome: "SUCCESS" });
		expect(spawnParent).toBe(outputPath.rootPath);
		expect(
			stat(resolve(outputPath.absolutePath, "..")).then((value) =>
				value.isDirectory(),
			),
		).resolves.toBe(true);
		expect(stat(outputPath.absolutePath)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("freezes staging authority and rejects mutation", () => {
		expect(Object.isFrozen(outputPath)).toBe(true);
		expect(() => {
			(outputPath as { absolutePath: string }).absolutePath = "C:\\outside.mp4";
		}).toThrow();
		expect(() =>
			assertT09FilesystemPathAuthority({
				absolutePath: outputPath.absolutePath,
				rootPath: outputPath.rootPath,
				label: "T09 test path",
				allowMissingFinal: true,
			}),
		).not.toThrow();
	});

	it("rejects a final junction reparse point", async () => {
		const root = await mkdtemp(join(tmpdir(), "t09-final-reparse-"));
		try {
			const target = join(root, "target");
			const link = join(root, "link");
			mkdirSync(target, { recursive: true });
			symlinkSync(target, link, "junction");
			expect(() =>
				createT09ServerOwnedStagingPath({
					rootPath: root,
					relativePath: "link/output.mp4",
				}),
			).toThrow(/reparse|authority|filesystem/i);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a parent junction reparse point", async () => {
		const root = await mkdtemp(join(tmpdir(), "t09-parent-reparse-"));
		try {
			const target = join(root, "target");
			const link = join(root, "parent-link");
			mkdirSync(target, { recursive: true });
			symlinkSync(target, link, "junction");
			expect(() =>
				createT09ServerOwnedStagingPath({
					rootPath: root,
					relativePath: "parent-link/output.mp4",
				}),
			).toThrow(/reparse|authority|filesystem/i);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps the T09 staging handoff local and server-owned", () => {
		const localStorage = { provider: "local" } as never;
		expect(
			assertT09StagedOutputHandoff({
				outputReady,
				outputPath,
				storage: localStorage,
			}),
		).toMatchObject({ outputReady, outputPath: outputPath.absolutePath });
		expect(() =>
			assertT09StagedOutputHandoff({
				outputReady,
				outputPath,
				storage: { provider: "r2" } as never,
			}),
		).toThrow("REQUIRES_LOCAL_STORAGE");
	});
});
