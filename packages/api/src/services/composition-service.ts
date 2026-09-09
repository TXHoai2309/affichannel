import { CompositionError } from "@affichannel/core";

import { assembleCompositionInputV1 } from "./composition-assembly-service";
import { insertCompositionVersionRecord } from "./composition-version-repository";
import type { WorkspaceActor } from "./workspace";

export type CompositionVersionCreationDependencies = {
	assemble?: typeof assembleCompositionInputV1;
	insert?: typeof insertCompositionVersionRecord;
};

export async function createCompositionVersion(
	actor: WorkspaceActor,
	projectId: string,
	dependencies: CompositionVersionCreationDependencies = {},
) {
	const result = await (dependencies.assemble ?? assembleCompositionInputV1)(
		actor,
		projectId,
	);
	if (!result.ok)
		throw new CompositionError(result.code, result.code, {
			issues: result.issues,
		});
	return (dependencies.insert ?? insertCompositionVersionRecord)({
		actor,
		projectId,
		compositionInput: result.input,
		compositionFingerprint: result.fingerprint,
	});
}

export { createCompositionPreviewDescriptor } from "./composition-preview-descriptor";
export {
	CompositionPreviewAccessError,
	createCompositionPreviewDependencyGrant,
	readCompositionPreviewDependency,
} from "./composition-preview-grants";
export { technicalPreflightCompositionVersion } from "./composition-technical-preflight-service";
export {
	findCompositionVersionRecord,
	findCompositionVersionTechnicalRecord,
	listCompositionVersionRecords,
} from "./composition-version-repository";
