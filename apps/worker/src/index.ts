import { randomUUID } from "node:crypto";
import { createProductionRenderWorkerDependencies } from "@affichannel/api/services/render-worker-production";
import { runNextRenderAttempt } from "@affichannel/api/services/render-worker-service";
import { INTERNAL_WORKSPACE_ID } from "@affichannel/core/workspace";
import { env } from "@affichannel/env/server";
import { createRenderWorkerLoop } from "./worker-loop";

const workerId = `render-worker-${randomUUID()}`;
const actor = {
	workspaceId: INTERNAL_WORKSPACE_ID,
	userId: "render-worker",
};
const dependencies = createProductionRenderWorkerDependencies();

function log(event: string, details: Record<string, unknown> = {}) {
	console.info(JSON.stringify({ event, workerId, ...details }));
}

async function main() {
	void env;
	const loop = createRenderWorkerLoop({
		workerId,
		runIteration: () => runNextRenderAttempt(actor, workerId, dependencies),
		onResult: (result) =>
			log("render-worker.iteration", {
				kind: result.kind,
				persisted: result.persisted,
				...(result.reason ? { reason: result.reason } : {}),
			}),
		onError: (error) =>
			log("render-worker.iteration-error", {
				error: error instanceof Error ? error.message : "unknown",
			}),
	});
	const requestShutdown = (signal: string) => {
		log("render-worker.shutdown-requested", { signal });
		loop.stop();
	};
	process.once("SIGINT", () => requestShutdown("SIGINT"));
	process.once("SIGTERM", () => requestShutdown("SIGTERM"));
	log("render-worker.started", { workspaceId: actor.workspaceId });
	await loop.run();
	log("render-worker.stopped");
}

main().catch((error: unknown) => {
	console.error(
		JSON.stringify({
			event: "render-worker.fatal",
			workerId,
			error: error instanceof Error ? error.message : "unknown",
		}),
	);
	process.exitCode = 1;
});
