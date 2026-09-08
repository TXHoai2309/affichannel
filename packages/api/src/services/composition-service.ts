import type { CompositionInputBuilderSource } from "@affichannel/core";
import { buildCompositionInputV1, CompositionError } from "@affichannel/core";

import { insertCompositionVersionRecord } from "./composition-version-repository";
import type { WorkspaceActor } from "./workspace";

export async function createCompositionVersion(
	actor: WorkspaceActor,
	source: CompositionInputBuilderSource,
) {
	const result = await buildCompositionInputV1(source);
	if (!result.ok)
		throw new CompositionError(result.code, result.code, {
			issues: result.issues,
		});
	return insertCompositionVersionRecord({
		actor,
		projectId: result.input.projectId,
		compositionInput: result.input,
		compositionFingerprint: result.fingerprint,
	});
}

export {
	findCompositionVersionRecord,
	listCompositionVersionRecords,
} from "./composition-version-repository";
