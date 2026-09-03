import {
	type BuiltClaimManifest,
	buildClaimManifestFromScriptVersion,
	buildSubjectAwareClaimManifestFromScriptVersion,
	ClaimManifestError,
	classifyProjectWriteIdentity,
	scriptVersionEditableSnapshotSchema,
} from "@affichannel/core";
import { db, product, project, scriptVersion } from "@affichannel/db";
import { and, eq, isNull } from "drizzle-orm";

import {
	type ClaimManifestHistoryCursor,
	type ClaimManifestHistoryPage,
	type CreateOrReuseClaimManifestResult,
	createOrReuseClaimManifestInTransaction,
	getClaimManifestById as getClaimManifestByIdFromRepository,
	listClaimManifestsForProject as listClaimManifestsForProjectFromRepository,
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
	"SCRIPT_CLAIMS_NOT_CURRENT",
	"CLAIM_SUBJECT_CONFIRMATION_REQUIRED",
	"CLAIM_SUBJECT_INVALID",
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

export type GetClaimManifestInput = Readonly<{
	actor: WorkspaceActor;
	projectId: string;
	claimManifestId: string;
}>;

export type ListClaimManifestsForProjectInput = Readonly<{
	actor: WorkspaceActor;
	projectId: string;
	direction: "newest_first" | "oldest_first";
	limit: number;
	cursor?: ClaimManifestHistoryCursor;
}>;

export type ClaimManifestNotRequiredResult = Readonly<{
	kind: "not_required";
	reason: "FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS";
	scriptVersionId: string;
	scriptVersionRevision: number;
}>;

export type CreateClaimManifestResult =
	| CreateOrReuseClaimManifestResult
	| ClaimManifestNotRequiredResult;

export function isClaimManifestNotRequiredResult(
	result: CreateClaimManifestResult,
): result is ClaimManifestNotRequiredResult {
	return "kind" in result && result.kind === "not_required";
}

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

function hasActiveScriptedAffiliateIdentity(record: {
	contentType: string | null;
	creationPath: string | null;
	contentFormatKey: string | null;
	contentFormatVersion: number | null;
}): boolean {
	const classification = classifyProjectWriteIdentity({
		contentType: record.contentType,
		creationPath: record.creationPath,
		contentFormat: {
			key: record.contentFormatKey,
			version: record.contentFormatVersion,
		},
	});
	return (
		classification.kind === "canonical" &&
		classification.identity.contentType === "AFFILIATE" &&
		classification.identity.creationPath === "SCRIPTED" &&
		classification.identity.contentFormat.key === "SCRIPTED_STANDARD" &&
		classification.identity.contentFormat.version === 1
	);
}

function hasActiveScriptedOrganicIdentity(record: {
	contentType: string | null;
	creationPath: string | null;
	contentFormatKey: string | null;
	contentFormatVersion: number | null;
}): boolean {
	return (
		record.contentType === "ORGANIC" &&
		record.creationPath === "SCRIPTED" &&
		record.contentFormatKey === "SCRIPTED_STANDARD" &&
		record.contentFormatVersion === 1
	);
}

async function assertProjectReadAccess(
	actor: WorkspaceActor,
	projectId: string,
): Promise<void> {
	const [accessibleProject] = await db
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				eq(project.id, projectId),
				eq(project.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	if (!accessibleProject) {
		throw new ClaimManifestServiceError("CLAIM_MANIFEST_PROJECT_NOT_FOUND");
	}
}

export async function getClaimManifest(input: GetClaimManifestInput) {
	await assertProjectReadAccess(input.actor, input.projectId);
	return getClaimManifestByIdFromRepository({
		workspaceId: input.actor.workspaceId,
		projectId: input.projectId,
		claimManifestId: input.claimManifestId,
	});
}

export async function listClaimManifestsForProject(
	input: ListClaimManifestsForProjectInput,
): Promise<ClaimManifestHistoryPage> {
	await assertProjectReadAccess(input.actor, input.projectId);
	return listClaimManifestsForProjectFromRepository({
		workspaceId: input.actor.workspaceId,
		projectId: input.projectId,
		direction: input.direction,
		limit: input.limit,
		cursor: input.cursor,
	});
}

export async function createClaimManifestFromScriptVersion(
	input: CreateClaimManifestFromScriptVersionInput,
): Promise<CreateClaimManifestResult> {
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
		const isAffiliate = hasActiveScriptedAffiliateIdentity(projectRecord);
		const isOrganic = hasActiveScriptedOrganicIdentity(projectRecord);
		if (!isAffiliate && !isOrganic) {
			throw new ClaimManifestServiceError(
				"CLAIM_MANIFEST_CONTENT_FORMAT_UNSUPPORTED",
			);
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

		if (isOrganic) {
			const parsedSnapshot = scriptVersionEditableSnapshotSchema.safeParse(
				source.editableSnapshot,
			);
			if (
				!parsedSnapshot.success ||
				parsedSnapshot.data.schemaVersion !== "script-draft.v3"
			) {
				throw new ClaimManifestServiceError("CLAIM_SUBJECT_INVALID");
			}
			if (
				parsedSnapshot.data.claimsStatus !== "current" ||
				parsedSnapshot.data.claimsSourceRevision !== source.revision
			) {
				throw new ClaimManifestServiceError("SCRIPT_CLAIMS_NOT_CURRENT");
			}
			for (const claim of parsedSnapshot.data.claims) {
				if (claim.subjectStatus === "NEEDS_CONFIRMATION") {
					throw new ClaimManifestServiceError(
						"CLAIM_SUBJECT_CONFIRMATION_REQUIRED",
					);
				}
				if (
					claim.subjectStatus !== "CONFIRMED" ||
					(claim.subjectSource !== "USER" &&
						claim.subjectSource !== "STRUCTURED_SOURCE")
				) {
					throw new ClaimManifestServiceError("CLAIM_SUBJECT_INVALID");
				}
			}
			const hasProductClaim = parsedSnapshot.data.claims.some(
				(claim) => claim.subject?.kind === "PRODUCT",
			);
			if (!hasProductClaim) {
				return {
					kind: "not_required",
					reason: "FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
					scriptVersionId: source.id,
					scriptVersionRevision: source.revision,
				};
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
			try {
				const builtManifest =
					await buildSubjectAwareClaimManifestFromScriptVersion({
						workspaceId: input.actor.workspaceId,
						projectId: projectRecord.id,
						productId: accessibleProduct.id,
						scriptVersionId: source.id,
						scriptVersionRevision: source.revision,
						snapshot: source.editableSnapshot,
					});
				const result = await createOrReuseClaimManifestInTransaction(
					transaction,
					{
						workspaceId: input.actor.workspaceId,
						projectId: projectRecord.id,
						builtManifest,
						createdByUserId: input.actor.userId,
					},
				);
				return result;
			} catch (error) {
				if (error instanceof ClaimManifestError) {
					throw new ClaimManifestServiceError("CLAIM_SUBJECT_INVALID");
				}
				throw error;
			}
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

		const result = await createOrReuseClaimManifestInTransaction(transaction, {
			workspaceId: input.actor.workspaceId,
			projectId: projectRecord.id,
			builtManifest,
			createdByUserId: input.actor.userId,
		});
		return result;
	});
}
