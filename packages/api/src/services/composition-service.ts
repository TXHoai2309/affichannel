import { CompositionError } from "@affichannel/core";

import { assembleCompositionInputV1 } from "./composition-assembly-service";
import { insertCompositionVersionRecord } from "./composition-version-repository";
import type { WorkspaceActor } from "./workspace";

export async function createCompositionVersion(
	actor: WorkspaceActor,
	projectId: string,
) {
	const result = await assembleCompositionInputV1(actor, projectId);
	if (!result.ok)
		throw new CompositionError(result.code, result.code, {
			issues: result.issues,
		});
	return insertCompositionVersionRecord({
		actor,
		projectId,
		compositionInput: result.input,
		compositionFingerprint: result.fingerprint,
	});
}

export {
	findCompositionVersionRecord,
	listCompositionVersionRecords,
} from "./composition-version-repository";
