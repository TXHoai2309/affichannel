import {
	buildClaimManifestFromQuickImageSource,
	CONTENT_FORMAT_DEFAULTS,
	classifyPersistedProjectIdentity,
} from "@affichannel/core";
import { db, project } from "@affichannel/db";
import { and, eq, isNull } from "drizzle-orm";

import {
	type CreateOrReuseClaimManifestResult,
	createOrReuseClaimManifestInTransaction,
} from "./claim-manifest-repository";
import { getQuickImageClaimSourceInTransaction } from "./quick-image-claim-source-service";

function isCanonicalQuickImageProject(record: {
	productId: string | null;
	contentType: string | null;
	creationPath: string | null;
	contentFormatKey: string | null;
	contentFormatVersion: number | null;
}) {
	const classification = classifyPersistedProjectIdentity(record);
	return (
		classification.kind === "canonical" &&
		classification.identity.creationPath === "QUICK_IMAGE" &&
		classification.identity.contentFormat.key ===
			CONTENT_FORMAT_DEFAULTS.QUICK_IMAGE.key &&
		classification.identity.contentFormat.version ===
			CONTENT_FORMAT_DEFAULTS.QUICK_IMAGE.version
	);
}

export async function createQuickImageClaimManifest(input: {
	workspaceId: string;
	projectId: string;
	createdByUserId: string;
}): Promise<CreateOrReuseClaimManifestResult> {
	return db.transaction(async (transaction) => {
		const [projectRecord] = await transaction
			.select({
				id: project.id,
				workspaceId: project.workspaceId,
				productId: project.productId,
				contentType: project.contentType,
				creationPath: project.creationPath,
				contentFormatKey: project.contentFormatKey,
				contentFormatVersion: project.contentFormatVersion,
				archivedAt: project.archivedAt,
			})
			.from(project)
			.where(
				and(
					eq(project.workspaceId, input.workspaceId),
					eq(project.id, input.projectId),
					isNull(project.archivedAt),
				),
			)
			.limit(1)
			.for("update", { of: project });
		if (!projectRecord || !isCanonicalQuickImageProject(projectRecord))
			throw new Error("QUICK_IMAGE_CLAIM_SOURCE_IDENTITY_INVALID");

		const source = await getQuickImageClaimSourceInTransaction(transaction, {
			workspaceId: input.workspaceId,
			projectId: input.projectId,
		});
		if (!source) throw new Error("QUICK_IMAGE_CLAIM_SOURCE_NOT_FOUND");
		const builtManifest = await buildClaimManifestFromQuickImageSource({
			workspaceId: input.workspaceId,
			projectId: input.projectId,
			productId: projectRecord.productId,
			source: source.document,
			sourceRevision: source.revision,
			sourceContentHashSha256: source.sourceContentHashSha256,
		});
		return createOrReuseClaimManifestInTransaction(transaction, {
			workspaceId: input.workspaceId,
			projectId: input.projectId,
			builtManifest,
			createdByUserId: input.createdByUserId,
		});
	});
}
