export type RenderWorkerIterationResult = Readonly<{
	kind: string;
	persisted: boolean;
	reason?: string;
}>;

export type RenderWorkerLoopOptions = Readonly<{
	workerId: string;
	runIteration: () => Promise<RenderWorkerIterationResult>;
	idleDelayMs?: number;
	errorDelayMs?: number;
	sleep?: (milliseconds: number) => Promise<void>;
	onResult?: (result: RenderWorkerIterationResult) => void;
	onError?: (error: unknown) => void;
	maxIterations?: number;
}>;

export type RenderWorkerLoop = Readonly<{
	stop: () => void;
	run: () => Promise<void>;
}>;

function boundedDelay(value: number, fallback: number) {
	if (!Number.isSafeInteger(value) || value < 0 || value > 60_000)
		return fallback;
	return value;
}

function defaultSleep(milliseconds: number) {
	return new Promise<void>((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

/**
 * Single-concurrency polling loop. It never claims work after stop() has been
 * requested and delegates every lifecycle mutation to the injected EN-001
 * iteration.
 */
export function createRenderWorkerLoop(
	options: RenderWorkerLoopOptions,
): RenderWorkerLoop {
	const idleDelayMs = boundedDelay(options.idleDelayMs ?? 1_000, 1_000);
	const errorDelayMs = boundedDelay(options.errorDelayMs ?? 5_000, 5_000);
	const sleep = options.sleep ?? defaultSleep;
	let stopping = false;
	let iterations = 0;

	return {
		stop() {
			stopping = true;
		},
		async run() {
			while (!stopping) {
				if (
					options.maxIterations !== undefined &&
					iterations >= options.maxIterations
				)
					return;
				iterations += 1;
				try {
					const result = await options.runIteration();
					options.onResult?.(result);
					if (result.kind === "IDLE" && !stopping) await sleep(idleDelayMs);
				} catch (error) {
					options.onError?.(error);
					if (!stopping) await sleep(errorDelayMs);
				}
			}
		},
	};
}
