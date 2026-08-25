import {
	type BuiltClaimManifest,
	buildClaimManifestFromScriptVersion,
	ClaimManifestError,
	classifyPersistedProjectIdentity,
} from "@affichannel/core";
import { db, product, project, scriptVersion } from "@affichannel/db";
import { and, eq, isNull } from "drizzle-orm";

import {
	type CreateOrReuseClaimManifestResult,
	createOrReuseClaimManifestInTransaction,
} from "./claim-manifest-repository";
import type { WorkspaceActor } from "./workspace";

export const claimManifestServiceErrorCodes = [
	"CLAIM_MANIFEST_PROJECT_NOT_FOUND",
	"CLAIM_MANIFEST_SOURCE_NOT_FOUND",
	"CLAIM_MANIFEST_SOURCE_SCOPE_MISMATCH",
	"CLAIM_MANIFEST_SOURCE_REVISION_CONFLICT",
	"CLAIM_MANIFEST_SOURCE_NOT_USABLE",
	"CLAIM_MANIFEST_PRODUCT_REQUIRED",
	"CLAIM_MANIFEST_CONTENT_FORMAT_UNSUPPORTED",
] as const;

export type ClaimManifestServiceErrorCode =
	(typeof claimManifestServiceErrorCodes)[number];

export class ClaimManifestServiceError extends Error {
	readonly code: ClaimManifestServiceErrorCode;
	readonly retryable: boolean;

	constructor(code: ClaimManifestServiceErrorCode, retryable = false) {
		super(code);
		this.name = "ClaimManifestServiceError";
		this.code = code;
		this.retryable = retryable;
	}
}

export type CreateClaimManifestFromScriptVersionInput = Readonly<{
	actor: WorkspaceActor;
	projectId: string;
	scriptVersionId: string;
	expectedScriptVersionRevision: number;
}>;

function assertServiceInput(
	input: CreateClaimManifestFromScriptVersionInput,
): void {
	if (
		!input.actor.workspaceId.trim() ||
		!input.actor.userId.trim() ||
		!input.projectId.trim() ||
		!input.scriptVersionId.trim()
	) {
		throw new ClaimManifestServiceError("CLAIM_MANIFEST_SOURCE_NOT_FOUND");
	}
	if (
		!Number.isFinite(input.expectedScriptVersionRevision) ||
		!Number.isInteger(input.expectedScriptVersionRevision) ||
		input.expectedScriptVersionRevision < 1
	) {
		throw new ClaimManifestServiceError(
			"CLAIM_MANIFEST_SOURCE_REVISION_CONFLICT",
			true,
		);
	}
}

function activeScriptedAffiliateIdentityResult(record: {
	productId: string | null;
	contentType: string | null;
	creationPath: string | null;
	contentFormatKey: string | null;
	contentFormatVersion: number | null;
}): "active" | "product_required" | "unsupported" {
	const classification = classifyPersistedProjectIdentity(record);
	if (
		classification.kind === "canonical" &&
		classification.identity.contentType === "AFFILIATE" &&
		classification.identity.creationPath === "SCRIPTED" &&
		classification.identity.contentFormat.key === "SCRIPTED_STANDARD" &&
		classification.identity.contentFormat.version === 1
	) {
		return "active";
	}
	if (
		classification.kind === "rejected" &&
		classification.reasonCode === "AFFILIATE_PRODUCT_MISSING" &&
		record.contentType === "AFFILIATE" &&
		record.creationPath === "SCRIPTED" &&
		record.contentFormatKey === "SCRIPTED_STANDARD" &&
		record.contentFormatVersion === 1
	) {
		return "product_required";
	}
	return "unsupported";
}

export async function createClaimManifestFromScriptVersion(
	input: CreateClaimManifestFromScriptVersionInput,
): Promise<CreateOrReuseClaimManifestResult> {
	assertServiceInput(input);

	return db.transaction(async (transaction) => {
		const [projectRecord] = await transaction
			.select({
				id: project.id,
				productId: project.productId,
				contentType: project.contentType,
				creationPath: project.creationPath,
				contentFormatKey: project.contentFormatKey,
				contentFormatVersion: project.contentFormatVersion,
			})
			.from(project)
			.where(
				and(
					eq(project.id, input.projectId),
					eq(project.workspaceId, input.actor.workspaceId),
					isNull(project.archivedAt),
				),
			)
			.limit(1)
			.for("update", { of: project });
		if (!projectRecord) {
			throw new ClaimManifestServiceError("CLAIM_MANIFEST_PROJECT_NOT_FOUND");
		}
		const activeIdentity = activeScriptedAffiliateIdentityResult(projectRecord);
		if (activeIdentity === "product_required") {
			throw new ClaimManifestServiceError("CLAIM_MANIFEST_PRODUCT_REQUIRED");
		}
		if (activeIdentity === "unsupported") {
			throw new ClaimManifestServiceError(
				"CLAIM_MANIFEST_CONTENT_FORMAT_UNSUPPORTED",
			);
		}
		if (!projectRecord.productId) {
			throw new ClaimManifestServiceError("CLAIM_MANIFEST_PRODUCT_REQUIRED");
		}

		const [accessibleProduct] = await transaction
			.select({ id: product.id })
			.from(product)
			.where(
				and(
					eq(product.id, projectRecord.productId),
					eq(product.workspaceId, input.actor.workspaceId),
				),
			)
			.limit(1);
		if (!accessibleProduct) {
			throw new ClaimManifestServiceError("CLAIM_MANIFEST_PRODUCT_REQUIRED");
		}

		const [source] = await transaction
			.select({
				id: scriptVersion.id,
				revision: scriptVersion.revision,
				status: scriptVersion.status,
				editableSnapshot: scriptVersion.editableSnapshotJson,
			})
			.from(scriptVersion)
			.where(
				and(
					eq(scriptVersion.id, input.scriptVersionId),
					eq(scriptVersion.workspaceId, input.actor.workspaceId),
					eq(scriptVersion.projectId, projectRecord.id),
				),
			)
			.limit(1)
			.for("update", { of: scriptVersion });
		if (!source) {
			throw new ClaimManifestServiceError("CLAIM_MANIFEST_SOURCE_NOT_FOUND");
		}
		if (source.revision !== input.expectedScriptVersionRevision) {
			throw new ClaimManifestServiceError(
				"CLAIM_MANIFEST_SOURCE_REVISION_CONFLICT",
				true,
			);
		}
		if (source.status !== "draft") {
			throw new ClaimManifestServiceError("CLAIM_MANIFEST_SOURCE_NOT_USABLE");
		}

		let builtManifest: BuiltClaimManifest;
		try {
			builtManifest = await buildClaimManifestFromScriptVersion({
				workspaceId: input.actor.workspaceId,
				projectId: projectRecord.id,
				productId: accessibleProduct.id,
				scriptVersionId: source.id,
				scriptVersionRevision: source.revision,
				snapshot: source.editableSnapshot,
			});
		} catch (error) {
			if (error instanceof ClaimManifestError) {
				throw new ClaimManifestServiceError("CLAIM_MANIFEST_SOURCE_NOT_USABLE");
			}
			throw error;
		}

		return createOrReuseClaimManifestInTransaction(transaction, {
			workspaceId: input.actor.workspaceId,
			projectId: projectRecord.id,
			builtManifest,
			createdByUserId: input.actor.userId,
		});
	});
}
