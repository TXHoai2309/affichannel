import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRenderWorkerLoop } from "./worker-loop";

const idle = { kind: "IDLE", persisted: false } as const;
const completed = { kind: "COMPLETED", persisted: true } as const;

describe("render worker loop", () => {
	it("waits after no work instead of busy-spinning", async () => {
		let calls = 0;
		const delays: number[] = [];
		const loop = createRenderWorkerLoop({
			workerId: "test-worker",
			maxIterations: 2,
			runIteration: async () => {
				calls += 1;
				return idle;
			},
			sleep: async (milliseconds) => {
				delays.push(milliseconds);
			},
		});
		await loop.run();
		assert.equal(calls, 2);
		assert.deepEqual(delays, [1_000, 1_000]);
	});

	it("continues after work and stops before a new claim", async () => {
		let calls = 0;
		const loop = createRenderWorkerLoop({
			workerId: "test-worker",
			runIteration: async () => {
				calls += 1;
				return calls === 1 ? completed : idle;
			},
			sleep: async () => undefined,
			onResult: (result) => {
				if (result.kind === "IDLE") loop.stop();
			},
		});
		await loop.run();
		assert.equal(calls, 2);
	});

	it("backs off after an orchestration error and keeps lifecycle ownership external", async () => {
		const delays: number[] = [];
		let calls = 0;
		const loop = createRenderWorkerLoop({
			workerId: "test-worker",
			maxIterations: 2,
			runIteration: async () => {
				calls += 1;
				if (calls === 1) throw new Error("controlled failure");
				return idle;
			},
			errorDelayMs: 2_000,
			sleep: async (milliseconds) => {
				delays.push(milliseconds);
			},
		});
		await loop.run();
		assert.equal(calls, 2);
		assert.deepEqual(delays, [2_000, 1_000]);
	});
});
