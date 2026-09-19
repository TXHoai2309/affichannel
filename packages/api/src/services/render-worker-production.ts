import { createApprovedQuickImageExecutionAdapter } from "./quick-image-render-execution-adapter";
import type { RenderWorkerDependencies } from "./render-worker-service";

/**
 * Production composition for the dedicated worker process. The worker owns
 * the loop; EN-001 remains the only job/attempt/lease authority.
 */
export function createProductionRenderWorkerDependencies(): RenderWorkerDependencies {
	return {
		executeQuickImage: createApprovedQuickImageExecutionAdapter(),
	};
}
