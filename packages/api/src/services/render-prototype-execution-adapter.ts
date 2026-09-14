import { spawn as nodeSpawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type {
	RenderAttemptExecutionSnapshot,
	RenderExecutionAdapter,
	RenderExecutionAdapterResult,
	T09OutputReady,
} from "@affichannel/core";
import { t09OutputReadySchema } from "@affichannel/core";
import type { T09FfmpegCommandPlan } from "./render-prototype-command-plan";
import {
	assertT09ServerOwnedStagingPath,
	createT09AttemptOutputStagingPath,
	type T09ServerOwnedStagingPath,
} from "./render-prototype-staging";
import {
	type ResolvedT09FfmpegTool,
	revalidateT09FfmpegTool,
} from "./render-prototype-tool-resolver";

export const T09_EXECUTION_TIMEOUT_MS = 120_000;
export const T09_TERMINATION_ACK_TIMEOUT_MS = 5_000;
export const T09_PROCESS_LOG_LIMIT_BYTES = 1024 * 1024;
export const T09_MAX_OUTPUT_BYTES = 67_108_864;
const T09_OUTPUT_SIZE_POLL_MS = 50;

type T09SpawnOptions = {
	cwd: string;
	env: NodeJS.ProcessEnv;
	shell: false;
	windowsHide: true;
	stdio: ["ignore", "pipe", "pipe"];
};

type T09ChildProcess = {
	stdout: {
		on(event: "data", listener: (chunk: unknown) => void): unknown;
		removeListener(event: "data", listener: (chunk: unknown) => void): unknown;
	};
	stderr: {
		on(event: "data", listener: (chunk: unknown) => void): unknown;
		removeListener(event: "data", listener: (chunk: unknown) => void): unknown;
	};
	once(event: "error", listener: (error: unknown) => void): unknown;
	once(
		event: "close",
		listener: (code: number | null, signal: NodeJS.Signals | null) => void,
	): unknown;
	removeListener(event: "error", listener: (error: unknown) => void): unknown;
	removeListener(
		event: "close",
		listener: (code: number | null, signal: NodeJS.Signals | null) => void,
	): unknown;
	kill(): boolean;
};

export type T09Spawn = (
	executablePath: string,
	argv: readonly string[],
	options: T09SpawnOptions,
) => T09ChildProcess;

export type T09OutputProbeResult =
	| { state: "PRESENT"; byteSize: number }
	| { state: "ABSENT" }
	| { state: "UNKNOWN" };

type T09OutputPresenceProbe = (path: string) => Promise<T09OutputProbeResult>;

export type T09ProcessExecutionInput = Readonly<{
	commandPlan: T09FfmpegCommandPlan;
	outputPath: T09ServerOwnedStagingPath;
	outputReady: T09OutputReady;
	approvedTool?: ResolvedT09FfmpegTool;
	signal?: AbortSignal;
	/** Test-only shortening; production callers use the owner-locked default. */
	timeoutMs?: number;
}>;

export type T09ProcessExecutionDependencies = Readonly<{
	spawn?: T09Spawn;
	probeOutput?: T09OutputPresenceProbe;
	/** Test-only shortening of the bounded termination acknowledgement wait. */
	terminationAckTimeoutMs?: number;
}>;

export type T09ExecutionPlanResolution = Readonly<{
	commandPlan: T09FfmpegCommandPlan;
	outputPath: T09ServerOwnedStagingPath;
	approvedTool: ResolvedT09FfmpegTool;
}>;

type ProcessClose = Readonly<{
	code: number | null;
	signal: NodeJS.Signals | null;
	spawnError: unknown | null;
}>;

class BoundedProcessLog {
	private readonly chunks: Buffer[] = [];
	private byteSize = 0;
	private truncated = false;

	append(chunk: unknown) {
		if (this.byteSize >= T09_PROCESS_LOG_LIMIT_BYTES) {
			this.truncated = true;
			return;
		}
		const bytes = Buffer.isBuffer(chunk)
			? chunk
			: Buffer.from(String(chunk), "utf8");
		const remaining = T09_PROCESS_LOG_LIMIT_BYTES - this.byteSize;
		const accepted = bytes.subarray(0, remaining);
		if (accepted.byteLength > 0) {
			this.chunks.push(accepted);
			this.byteSize += accepted.byteLength;
		}
		if (accepted.byteLength < bytes.byteLength) this.truncated = true;
	}

	toString() {
		const raw = Buffer.concat(this.chunks).toString("utf8");
		const suffix = this.truncated ? "\n[process diagnostics truncated]" : "";
		return redactProcessDiagnostics(`${raw}${suffix}`);
	}
}

export function redactProcessDiagnostics(value: string) {
	return value
		.replace(
			/\b(?:DATABASE_URL(?:_DIRECT)?|RENDER_OUTPUT_R2_ACCESS_KEY_ID|RENDER_OUTPUT_R2_SECRET_ACCESS_KEY|API_KEY|APIKEY|PASSWORD|SECRET|TOKEN|AUTHORIZATION)\s*[=:]\s*[^\s,;]+/giu,
			"[REDACTED]",
		)
		.replace(
			/(?:postgres(?:ql)?|mysql|redis):\/\/[^\s:@]+:[^\s@]+@/giu,
			"[REDACTED]@",
		);
}

async function defaultProbeOutput(path: string): Promise<T09OutputProbeResult> {
	try {
		const result = await lstat(path);
		return result.isFile()
			? { state: "PRESENT", byteSize: result.size }
			: { state: "UNKNOWN" };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return { state: "ABSENT" };
		return { state: "UNKNOWN" };
	}
}

function errorCode(error: unknown) {
	if (!error || typeof error !== "object") return null;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : null;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function diagnosticsMessage(input: {
	code: string;
	detail?: string;
	logs: BoundedProcessLog;
}) {
	const diagnostics = input.logs.toString().trim();
	const parts = [input.code, input.detail].filter(Boolean);
	if (diagnostics) parts.push(`diagnostics=${diagnostics}`);
	return redactProcessDiagnostics(parts.join("; "));
}

function failure(input: {
	errorCode: string;
	classification: "DETERMINISTIC" | "RETRYABLE";
	sideEffectFree: boolean;
	terminal?: boolean;
	message: string;
}): RenderExecutionAdapterResult {
	return {
		outcome: "FAILURE",
		classification: input.classification,
		sideEffectFree: input.sideEffectFree,
		...(input.terminal ? { terminal: true } : {}),
		errorCode: input.errorCode,
		errorMessage: input.message,
	};
}

function indeterminate(input: {
	errorCode: string;
	message: string;
}): RenderExecutionAdapterResult {
	return failure({
		errorCode: input.errorCode,
		classification: "RETRYABLE",
		sideEffectFree: false,
		message: input.message,
	});
}

function validateExecutionContract(input: T09ProcessExecutionInput) {
	const outputPath = assertT09ServerOwnedStagingPath(
		input.outputPath,
		"T09 output path",
	);
	const parsedOutputReady = t09OutputReadySchema.parse(input.outputReady);
	const expectedOutputPath = createT09AttemptOutputStagingPath({
		rootPath: input.outputPath.rootPath,
		jobId: parsedOutputReady.jobId,
		attemptId: parsedOutputReady.attemptId,
		attemptNumber: parsedOutputReady.attemptNumber,
		outputReservationId: parsedOutputReady.outputReservationId,
	});
	if (!isAbsolute(input.commandPlan.executablePath))
		throw new Error("T09 executable path must be absolute.");
	if (expectedOutputPath.absolutePath !== outputPath)
		throw new Error(
			"T09 output identity does not match its server-owned path.",
		);
	if (input.commandPlan.outputPath !== outputPath)
		throw new Error("T09 command output does not match server-owned staging.");
	if (input.commandPlan.argv.at(-1) !== outputPath)
		throw new Error("T09 command must publish to its server-owned output.");
	if (!input.commandPlan.argv.includes("-n"))
		throw new Error("T09 command must use no-overwrite mode.");
	if (input.commandPlan.argv.includes("-y"))
		throw new Error("T09 command must not use overwrite mode.");
	return parsedOutputReady;
}

async function validateRealExecutionAuthority(input: T09ProcessExecutionInput) {
	if (!input.approvedTool)
		throw new Error("T09_FFMPEG_BINARY_APPROVAL_REQUIRED");
	await revalidateT09FfmpegTool({
		tool: input.approvedTool,
		expectedExecutablePath: input.commandPlan.executablePath,
		expectedManifestIdentity: input.commandPlan.toolManifestIdentity,
		expectedBinarySha256: input.commandPlan.toolBinarySha256,
	});
}

function outputReadyForSnapshot(
	snapshot: RenderAttemptExecutionSnapshot,
): T09OutputReady {
	return {
		schemaVersion: "t09-output-ready.v1",
		kind: "OUTPUT_READY",
		jobId: snapshot.jobId,
		attemptId: snapshot.attemptId,
		attemptNumber: snapshot.attemptNumber,
		outputReservationId: snapshot.execution.outputReservationId,
	};
}

/**
 * FFmpeg does not need application secrets or PATH lookup. SystemRoot is the
 * only Windows runtime value intentionally forwarded for native loader
 * behavior. The explicit allowlist is also part of the binary boundary.
 */
export function createT09ChildEnvironment(): NodeJS.ProcessEnv {
	const environment: Record<string, string> = {};
	const systemRoot = process.env.SystemRoot;
	if (systemRoot) environment.SystemRoot = systemRoot;
	return Object.freeze(environment) as NodeJS.ProcessEnv;
}

type ObservedProcess = Readonly<{
	close: Promise<ProcessClose>;
	detach: () => void;
}>;

function observeProcess(
	child: T09ChildProcess,
	logs: BoundedProcessLog,
): ObservedProcess {
	const onStdout = (chunk: unknown) => logs.append(chunk);
	const onStderr = (chunk: unknown) => logs.append(chunk);
	child.stdout.on("data", onStdout);
	child.stderr.on("data", onStderr);
	let detach = () => undefined;
	const close = new Promise<ProcessClose>((resolve) => {
		let spawnError: unknown | null = null;
		const onError = (error: unknown) => {
			spawnError = error;
		};
		const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
			detach();
			resolve({ code, signal, spawnError });
		};
		child.once("error", onError);
		child.once("close", onClose);
		detach = () => {
			child.stdout.removeListener("data", onStdout);
			child.stderr.removeListener("data", onStderr);
			child.removeListener("error", onError);
			child.removeListener("close", onClose);
		};
	});
	return { close, detach };
}

type TerminationRequest = Readonly<{
	reason: "TIMEOUT" | "CANCELLED" | "OUTPUT_SIZE_LIMIT";
	killReturned: boolean | null;
	killError: unknown | null;
}>;

function terminationMessage(request: TerminationRequest) {
	return `Process termination was requested for ${request.reason}; direct-child kill result=${request.killReturned === null ? "unknown" : String(request.killReturned)}. Windows descendant termination is not proven.`;
}

function outputSizeLimitFailure(byteSize: number, logs: BoundedProcessLog) {
	return failure({
		errorCode: "OUTPUT_SIZE_LIMIT_EXCEEDED",
		classification: "DETERMINISTIC",
		sideEffectFree: false,
		terminal: true,
		message: diagnosticsMessage({
			code: "OUTPUT_SIZE_LIMIT_EXCEEDED",
			detail: `T09 candidate output was ${byteSize} bytes; the maximum is ${T09_MAX_OUTPUT_BYTES}.`,
			logs,
		}),
	});
}

/**
 * Runs the approved T09 command plan without owning output proof. This function
 * is intentionally dependency-injectable so contract tests never execute a
 * real binary. The default 120-second timeout is the Owner-locked policy.
 */
export async function executeT09FfmpegProcess(
	input: T09ProcessExecutionInput,
	dependencies: T09ProcessExecutionDependencies = {},
): Promise<RenderExecutionAdapterResult> {
	const logs = new BoundedProcessLog();
	let outputReady: T09OutputReady;
	try {
		outputReady = validateExecutionContract(input);
	} catch (error) {
		return failure({
			errorCode: "T09_EXECUTION_CONTRACT_INVALID",
			classification: "DETERMINISTIC",
			sideEffectFree: true,
			message: diagnosticsMessage({
				code: "T09_EXECUTION_CONTRACT_INVALID",
				detail: errorMessage(error),
				logs,
			}),
		});
	}
	if (input.approvedTool || !dependencies.spawn) {
		try {
			await validateRealExecutionAuthority(input);
		} catch (error) {
			const code = errorCode(error);
			return failure({
				errorCode: code ?? "T09_FFMPEG_BINARY_APPROVAL_REQUIRED",
				classification: "DETERMINISTIC",
				sideEffectFree: true,
				message: diagnosticsMessage({
					code: code ?? "T09_FFMPEG_BINARY_APPROVAL_REQUIRED",
					detail: errorMessage(error),
					logs,
				}),
			});
		}
	}

	const spawn: T09Spawn =
		dependencies.spawn ??
		((executablePath, argv, options) =>
			nodeSpawn(
				executablePath,
				[...argv],
				options,
			) as unknown as T09ChildProcess);
	let child: T09ChildProcess;
	try {
		child = spawn(input.commandPlan.executablePath, input.commandPlan.argv, {
			cwd: input.outputPath.rootPath,
			env: createT09ChildEnvironment(),
			shell: false,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const code = errorCode(error);
		return failure({
			errorCode:
				code === "ENOENT" ? "T09_BINARY_NOT_FOUND" : "T09_PROCESS_SPAWN_FAILED",
			classification:
				code === "ENOENT" || code === "EACCES" ? "DETERMINISTIC" : "RETRYABLE",
			sideEffectFree: true,
			message: diagnosticsMessage({
				code: "T09_PROCESS_SPAWN_FAILED",
				detail: errorMessage(error),
				logs,
			}),
		});
	}

	let termination: TerminationRequest | null = null;
	let requestTermination!: (request: TerminationRequest) => void;
	const terminationRequested = new Promise<TerminationRequest>((resolve) => {
		requestTermination = resolve;
	});
	const terminateFor = (
		reason: "TIMEOUT" | "CANCELLED" | "OUTPUT_SIZE_LIMIT",
	) => {
		if (termination !== null) return;
		let killReturned: boolean | null = null;
		let killError: unknown | null = null;
		try {
			killReturned = child.kill();
		} catch (error) {
			killError = error;
		}
		termination = { reason, killReturned, killError };
		requestTermination(termination);
	};
	const timeoutMs = input.timeoutMs ?? T09_EXECUTION_TIMEOUT_MS;
	const timeout = setTimeout(() => terminateFor("TIMEOUT"), timeoutMs);
	const abort = () => terminateFor("CANCELLED");
	if (input.signal?.aborted) abort();
	else input.signal?.addEventListener("abort", abort, { once: true });
	const probeOutput = dependencies.probeOutput ?? defaultProbeOutput;
	let sizeProbeInFlight = false;
	const sizeMonitor = setInterval(() => {
		if (termination !== null || sizeProbeInFlight) return;
		sizeProbeInFlight = true;
		void probeOutput(input.outputPath.absolutePath)
			.then((probe) => {
				if (probe.state === "PRESENT" && probe.byteSize > T09_MAX_OUTPUT_BYTES)
					terminateFor("OUTPUT_SIZE_LIMIT");
			})
			.catch(() => undefined)
			.finally(() => {
				sizeProbeInFlight = false;
			});
	}, T09_OUTPUT_SIZE_POLL_MS);
	const observed = observeProcess(child, logs);
	const initialObservation = await Promise.race([
		observed.close.then((result) => ({ kind: "CLOSED" as const, result })),
		terminationRequested.then((request) => ({
			kind: "TERMINATION" as const,
			request,
		})),
	]);
	let result: ProcessClose | null;
	let terminationAcknowledged = false;
	if (initialObservation.kind === "CLOSED") {
		result = initialObservation.result;
		terminationAcknowledged = termination === null;
	} else {
		const acknowledged = await Promise.race([
			observed.close.then((close) => ({ kind: "CLOSED" as const, close })),
			new Promise<{ kind: "UNCONFIRMED" }>((resolve) =>
				setTimeout(
					() => resolve({ kind: "UNCONFIRMED" }),
					dependencies.terminationAckTimeoutMs ??
						T09_TERMINATION_ACK_TIMEOUT_MS,
				),
			),
		]);
		if (acknowledged.kind === "CLOSED") {
			result = acknowledged.close;
			terminationAcknowledged = true;
		} else {
			result = null;
			observed.detach();
		}
	}
	clearTimeout(timeout);
	clearInterval(sizeMonitor);
	input.signal?.removeEventListener("abort", abort);
	if (result === null)
		return indeterminate({
			errorCode: "T09_PROCESS_TERMINATION_UNCONFIRMED",
			message: diagnosticsMessage({
				code: "T09_PROCESS_TERMINATION_UNCONFIRMED",
				detail: termination
					? terminationMessage(termination)
					: "Process termination acknowledgement timed out.",
				logs,
			}),
		});

	let presence: T09OutputProbeResult;
	try {
		presence = await probeOutput(input.outputPath.absolutePath);
	} catch (error) {
		return indeterminate({
			errorCode: "T09_OUTPUT_PRESENCE_UNKNOWN",
			message: diagnosticsMessage({
				code: "T09_OUTPUT_PRESENCE_UNKNOWN",
				detail: errorMessage(error),
				logs,
			}),
		});
	}
	if (presence.state === "UNKNOWN")
		return indeterminate({
			errorCode: "T09_OUTPUT_PRESENCE_UNKNOWN",
			message: diagnosticsMessage({
				code: "T09_OUTPUT_PRESENCE_UNKNOWN",
				detail:
					"Output existence could not be proven after process termination.",
				logs,
			}),
		});
	if (presence.state === "PRESENT" && presence.byteSize > T09_MAX_OUTPUT_BYTES)
		return outputSizeLimitFailure(presence.byteSize, logs);

	if (result.spawnError) {
		const code = errorCode(result.spawnError);
		if (presence.state === "PRESENT")
			return indeterminate({
				errorCode: "T09_SPAWN_OUTCOME_UNKNOWN",
				message: diagnosticsMessage({
					code: "T09_SPAWN_OUTCOME_UNKNOWN",
					detail: errorMessage(result.spawnError),
					logs,
				}),
			});
		return failure({
			errorCode:
				code === "ENOENT" ? "T09_BINARY_NOT_FOUND" : "T09_PROCESS_SPAWN_FAILED",
			classification:
				code === "ENOENT" || code === "EACCES" ? "DETERMINISTIC" : "RETRYABLE",
			sideEffectFree: true,
			message: diagnosticsMessage({
				code: "T09_PROCESS_SPAWN_FAILED",
				detail: errorMessage(result.spawnError),
				logs,
			}),
		});
	}

	const terminationState = termination as TerminationRequest | null;
	if (terminationState !== null) {
		const terminationReason = terminationState.reason;
		if (terminationReason === "OUTPUT_SIZE_LIMIT")
			return outputSizeLimitFailure(
				presence.state === "PRESENT"
					? presence.byteSize
					: T09_MAX_OUTPUT_BYTES + 1,
				logs,
			);
		return indeterminate({
			errorCode:
				terminationReason === "TIMEOUT"
					? "T09_PROCESS_TIMEOUT_TERMINATION_UNCERTAIN"
					: "T09_PROCESS_CANCELLED_TERMINATION_UNCERTAIN",
			message: diagnosticsMessage({
				code: "T09_PROCESS_TERMINATION_AMBIGUOUS",
				detail: `${terminationMessage(terminationState)} closeObserved=${String(terminationAcknowledged)} outputState=${presence.state}.`,
				logs,
			}),
		});
	}

	if (result.code === 0) {
		if (presence.state === "PRESENT")
			return { outcome: "SUCCESS", outputReady };
		return failure({
			errorCode: "T09_OUTPUT_MISSING_AFTER_SUCCESS",
			classification: "DETERMINISTIC",
			sideEffectFree: true,
			message: diagnosticsMessage({
				code: "T09_OUTPUT_MISSING_AFTER_SUCCESS",
				detail: "The process exited successfully but produced no output file.",
				logs,
			}),
		});
	}

	if (presence.state === "PRESENT")
		return indeterminate({
			errorCode: "T09_PROCESS_FAILED_OUTPUT_PRESENT",
			message: diagnosticsMessage({
				code: "T09_PROCESS_FAILED_OUTPUT_PRESENT",
				detail: `Process exited with code ${String(result.code)}.`,
				logs,
			}),
		});
	return failure({
		errorCode: "T09_PROCESS_NON_ZERO_EXIT",
		classification: "DETERMINISTIC",
		sideEffectFree: true,
		message: diagnosticsMessage({
			code: "T09_PROCESS_NON_ZERO_EXIT",
			detail: `Process exited with code ${String(result.code)}${result.signal ? ` (${result.signal})` : ""}.`,
			logs,
		}),
	});
}

/**
 * Binds the process contract to the existing 21C adapter boundary. The plan
 * resolver is server-side and attempt-specific; the returned OUTPUT_READY is
 * derived only from the claimed snapshot identity.
 */
export function createT09RenderExecutionAdapter(
	input: Readonly<{
		resolvePlan: (
			snapshot: RenderAttemptExecutionSnapshot,
		) => Promise<T09ExecutionPlanResolution>;
	}>,
): RenderExecutionAdapter {
	return async ({ snapshot, signal }) => {
		let processInvoked = false;
		try {
			const resolved = await input.resolvePlan(snapshot);
			processInvoked = true;
			return await executeT09FfmpegProcess({
				commandPlan: resolved.commandPlan,
				outputPath: resolved.outputPath,
				outputReady: outputReadyForSnapshot(snapshot),
				approvedTool: resolved.approvedTool,
				signal,
			});
		} catch (error) {
			if (processInvoked)
				return indeterminate({
					errorCode: "T09_POST_SPAWN_EXCEPTION",
					message: redactProcessDiagnostics(
						`T09_POST_SPAWN_EXCEPTION; ${errorMessage(error)}`,
					),
				});
			return failure({
				errorCode: "T09_EXECUTION_PLAN_RESOLUTION_FAILED",
				classification: "DETERMINISTIC",
				sideEffectFree: true,
				message: redactProcessDiagnostics(
					`T09_EXECUTION_PLAN_RESOLUTION_FAILED; ${errorMessage(error)}`,
				),
			});
		}
	};
}

/** Test-only seam. It cannot be supplied to the production/default factory. */
export function createT09TestRenderExecutionAdapter(
	input: Readonly<{
		resolvePlan: (
			snapshot: RenderAttemptExecutionSnapshot,
		) => Promise<T09ExecutionPlanResolution>;
		process: (
			input: T09ProcessExecutionInput,
			dependencies?: T09ProcessExecutionDependencies,
		) => Promise<RenderExecutionAdapterResult>;
		processDependencies?: T09ProcessExecutionDependencies;
	}>,
): RenderExecutionAdapter {
	return async ({ snapshot, signal }) => {
		let processInvoked = false;
		try {
			const resolved = await input.resolvePlan(snapshot);
			processInvoked = true;
			return await input.process(
				{
					commandPlan: resolved.commandPlan,
					outputPath: resolved.outputPath,
					outputReady: outputReadyForSnapshot(snapshot),
					approvedTool: resolved.approvedTool,
					signal,
				},
				input.processDependencies,
			);
		} catch (error) {
			if (processInvoked)
				return indeterminate({
					errorCode: "T09_POST_SPAWN_EXCEPTION",
					message: redactProcessDiagnostics(
						`T09_POST_SPAWN_EXCEPTION; ${errorMessage(error)}`,
					),
				});
			return failure({
				errorCode: "T09_EXECUTION_PLAN_RESOLUTION_FAILED",
				classification: "DETERMINISTIC",
				sideEffectFree: true,
				message: redactProcessDiagnostics(
					`T09_EXECUTION_PLAN_RESOLUTION_FAILED; ${errorMessage(error)}`,
				),
			});
		}
	};
}
