import {
	type BuiltSubjectAwareClaimManifest,
	deriveFactLockRunStatus,
	FACT_LOCK_MANIFEST_INPUT_MODE,
	FactLockError,
	type FactLockStoredClaim,
	manifestFactLockInputSnapshotAnySchema,
	scriptVersionEditableSnapshotSchema,
	selectConfirmedProductManifestClaims,
} from "@affichannel/core";
import {
	db,
	factDependency,
	factLockClaim,
	factLockRun,
	product,
	productFact,
	project,
	scriptVersion,
} from "@affichannel/db";
import { and, desc, eq, inArray } from "drizzle-orm";

import { getClaimManifestByIdInTransaction } from "./claim-manifest-repository";
import { loadFactLockClaimsInTransaction } from "./fact-lock-claim-read-repository";
import {
	loadFactLockReadContext,
	toFactLockReadModel,
} from "./fact-lock-read-service";
import type { WorkspaceActor } from "./workspace";

type FactLockTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type FactLockManifestApprovalInput = Readonly<{
	projectId: string;
	factLockRunId: string;
	claimId: string;
	scriptVersionId: string;
	baseRevision: number;
	reviewNote?: string | null;
}>;

export async function isManifestFactLockResolution(
	actor: WorkspaceActor,
	input: Pick<FactLockManifestApprovalInput, "projectId" | "factLockRunId">,
) {
	const [run] = await db
		.select({ inputMode: factLockRun.inputMode })
		.from(factLockRun)
		.where(
			and(
				eq(factLockRun.workspaceId, actor.workspaceId),
				eq(factLockRun.projectId, input.projectId),
				eq(factLockRun.id, input.factLockRunId),
			),
		)
		.limit(1);
	return run?.inputMode === FACT_LOCK_MANIFEST_INPUT_MODE;
}

function staleManifest(): never {
	throw new FactLockError(
		"FACT_LOCK_STALE",
		"Manifest Fact Lock đã lỗi thời; hãy chạy lại Fact Lock.",
	);
}

async function assertManifestCurrent(
	transaction: FactLockTransaction,
	actor: WorkspaceActor,
	input: FactLockManifestApprovalInput,
	run: typeof factLockRun.$inferSelect,
) {
	if (
		run.claimManifestId === null ||
		run.claimManifestFingerprint === null ||
		run.inputMode !== FACT_LOCK_MANIFEST_INPUT_MODE
	)
		throw new FactLockError(
			"FACT_LOCK_SCRIPT_NOT_READY",
			"Fact Lock run không thuộc Manifest-first flow.",
		);

	const manifest = await getClaimManifestByIdInTransaction(transaction, {
		workspaceId: actor.workspaceId,
		projectId: input.projectId,
		claimManifestId: run.claimManifestId,
	});
	if (!manifest)
		throw new FactLockError(
			"CLAIM_MANIFEST_NOT_FOUND",
			"ClaimManifest không tồn tại trong phạm vi yêu cầu.",
		);
	if (manifest.fingerprint !== run.claimManifestFingerprint)
		throw new FactLockError(
			"CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
			"ClaimManifest integrity check failed.",
		);

	const parsedSnapshot = manifestFactLockInputSnapshotAnySchema.safeParse(
		run.inputSnapshotJson,
	);
	if (
		!parsedSnapshot.success ||
		parsedSnapshot.data.claimManifest.id !== manifest.id ||
		parsedSnapshot.data.claimManifest.fingerprint !== manifest.fingerprint ||
		parsedSnapshot.data.source.sourceType !== "SCRIPT_VERSION" ||
		manifest.source.sourceType !== "SCRIPT_VERSION"
	)
		throw new FactLockError(
			"CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
			"Manifest Fact Lock input integrity check failed.",
		);

	const [projectRecord] = await transaction
		.select({
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
			productId: project.productId,
			archivedAt: project.archivedAt,
		})
		.from(project)
		.where(
			and(
				eq(project.workspaceId, actor.workspaceId),
				eq(project.id, input.projectId),
			),
		)
		.limit(1)
		.for("update", { of: project });
	if (!projectRecord || projectRecord.archivedAt !== null) staleManifest();
	const organic = manifest.builderVersion === "claim-manifest-builder.v2";
	const [currentProduct] = projectRecord.productId
		? organic
			? await transaction
					.select({ status: product.status, archivedAt: product.archivedAt })
					.from(product)
					.where(
						and(
							eq(product.workspaceId, actor.workspaceId),
							eq(product.id, projectRecord.productId),
						),
					)
					.limit(1)
			: []
		: [];
	if (
		organic &&
		(currentProduct?.status !== "active" || currentProduct?.archivedAt !== null)
	)
		staleManifest();
	if (
		(organic && parsedSnapshot.data.inputVersion !== "fact-lock.manifest.v2") ||
		(!organic && parsedSnapshot.data.inputVersion !== "fact-lock.manifest.v1")
	)
		staleManifest();
	if (
		(!organic && manifest.builderVersion !== "claim-manifest-builder.v1") ||
		(organic
			? projectRecord.contentType !== "ORGANIC"
			: projectRecord.contentType !== "AFFILIATE") ||
		projectRecord.creationPath !== "SCRIPTED" ||
		projectRecord.contentFormatKey !== "SCRIPTED_STANDARD" ||
		projectRecord.contentFormatVersion !== 1 ||
		projectRecord.productId === null ||
		manifest.productId !== projectRecord.productId
	)
		staleManifest();

	const [currentScript] = await transaction
		.select({
			id: scriptVersion.id,
			revision: scriptVersion.revision,
			editableSnapshotJson: scriptVersion.editableSnapshotJson,
		})
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.workspaceId, actor.workspaceId),
				eq(scriptVersion.projectId, input.projectId),
				eq(scriptVersion.status, "draft"),
			),
		)
		.orderBy(desc(scriptVersion.updatedAt), desc(scriptVersion.id))
		.limit(1)
		.for("update", { of: scriptVersion });
	if (
		!currentScript ||
		currentScript.id !== input.scriptVersionId ||
		currentScript.revision !== input.baseRevision ||
		currentScript.id !== manifest.source.scriptVersionId ||
		currentScript.revision !== manifest.source.scriptVersionRevision ||
		run.scriptVersionId !== currentScript.id ||
		run.sourceScriptRevision !== currentScript.revision ||
		parsedSnapshot.data.source.scriptVersionId !== currentScript.id ||
		parsedSnapshot.data.source.scriptVersionRevision !== currentScript.revision
	)
		staleManifest();
	if (
		organic &&
		(() => {
			const parsed = scriptVersionEditableSnapshotSchema.safeParse(
				currentScript.editableSnapshotJson,
			);
			return (
				!parsed.success ||
				parsed.data.schemaVersion !== "script-draft.v3" ||
				parsed.data.claimsStatus !== "current" ||
				parsed.data.claims.some(
					(claim) =>
						claim.subjectStatus !== "CONFIRMED" ||
						(claim.subjectSource !== "USER" &&
							claim.subjectSource !== "STRUCTURED_SOURCE"),
				) ||
				parsed.data.claimsSourceRevision !==
					manifest.source.claimsSourceRevision
			);
		})()
	)
		staleManifest();
	if (organic) {
		const productClaims = selectConfirmedProductManifestClaims(
			manifest as unknown as BuiltSubjectAwareClaimManifest,
		);
		if (
			parsedSnapshot.data.inputVersion !== "fact-lock.manifest.v2" ||
			JSON.stringify(parsedSnapshot.data.productClaims) !==
				JSON.stringify(productClaims)
		)
			staleManifest();
	}

	const dependencies = await transaction
		.select()
		.from(factDependency)
		.where(
			and(
				eq(factDependency.workspaceId, actor.workspaceId),
				eq(factDependency.dependentType, "fact_lock"),
				eq(factDependency.dependentId, run.id),
			),
		);
	if (
		dependencies.some(
			(dependency) =>
				dependency.detachedAt !== null || dependency.invalidatedAt !== null,
		) ||
		dependencies.length !== parsedSnapshot.data.productFacts.length
	)
		staleManifest();
	if (parsedSnapshot.data.productFacts.length > 0) {
		const currentFacts = await transaction
			.select({ id: productFact.id, revision: productFact.revision })
			.from(productFact)
			.where(
				and(
					eq(productFact.workspaceId, actor.workspaceId),
					eq(productFact.productId, projectRecord.productId),
					inArray(
						productFact.id,
						parsedSnapshot.data.productFacts.map((fact) => fact.id),
					),
				),
			);
		if (
			!parsedSnapshot.data.productFacts.every((fact) =>
				currentFacts.some(
					(current) =>
						current.id === fact.id && current.revision === fact.revision,
				),
			)
		)
			staleManifest();
	}

	return manifest;
}

export async function manualApproveManifestFactLockClaim(
	actor: WorkspaceActor,
	input: FactLockManifestApprovalInput,
) {
	await db.transaction(async (transaction) => {
		const [run] = await transaction
			.select()
			.from(factLockRun)
			.where(
				and(
					eq(factLockRun.workspaceId, actor.workspaceId),
					eq(factLockRun.projectId, input.projectId),
					eq(factLockRun.id, input.factLockRunId),
				),
			)
			.limit(1)
			.for("update", { of: factLockRun });
		if (!run)
			throw new FactLockError(
				"FACT_LOCK_NOT_FOUND",
				"Fact Lock run không tồn tại trong project.",
			);
		if (run.status !== "review_required" && run.status !== "passed")
			throw new FactLockError(
				"FACT_LOCK_CLAIM_NOT_REVIEWABLE",
				"Fact Lock run hiện không ở trạng thái có thể duyệt.",
			);
		const manifest = await assertManifestCurrent(
			transaction,
			actor,
			input,
			run,
		);
		const [claim] = await transaction
			.select()
			.from(factLockClaim)
			.where(
				and(
					eq(factLockClaim.id, input.claimId),
					eq(factLockClaim.runId, run.id),
					eq(factLockClaim.workspaceId, actor.workspaceId),
				),
			)
			.limit(1)
			.for("update", { of: factLockClaim });
		if (!claim)
			throw new FactLockError(
				"FACT_LOCK_CLAIM_NOT_FOUND",
				"Không tìm thấy claim trong Fact Lock run.",
			);
		const reviewableClaimKeys = new Set(
			(manifest.builderVersion === "claim-manifest-builder.v2"
				? selectConfirmedProductManifestClaims(
						manifest as unknown as BuiltSubjectAwareClaimManifest,
					)
				: manifest.claims
			).map((manifestClaim) => manifestClaim.claimKey),
		);
		if (!reviewableClaimKeys.has(claim.claimKey))
			throw new FactLockError(
				"CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
				"Claim không thuộc ClaimManifest đã chọn.",
			);
		if (
			claim.classificationStatus !== "NEEDS_REVIEW" ||
			claim.reviewStatus !== "UNRESOLVED"
		)
			throw new FactLockError(
				"FACT_LOCK_CLAIM_NOT_REVIEWABLE",
				"Claim này không còn cần duyệt thủ công.",
			);

		const [updated] = await transaction
			.update(factLockClaim)
			.set({
				reviewStatus: "MANUAL_APPROVED",
				reviewedByUserId: actor.userId,
				reviewedAt: new Date(),
				reviewNote: input.reviewNote?.trim() || null,
			})
			.where(
				and(
					eq(factLockClaim.id, input.claimId),
					eq(factLockClaim.workspaceId, actor.workspaceId),
					eq(factLockClaim.reviewStatus, "UNRESOLVED"),
					eq(factLockClaim.classificationStatus, "NEEDS_REVIEW"),
				),
			)
			.returning({ id: factLockClaim.id });
		if (!updated)
			throw new FactLockError(
				"FACT_LOCK_CONFLICT",
				"Claim vừa được xử lý bởi một thao tác khác.",
			);

		const claims = await loadFactLockClaimsInTransaction(
			transaction,
			actor,
			run.id,
			manifest,
		);
		const expectedClaimCount =
			manifest.builderVersion === "claim-manifest-builder.v2"
				? selectConfirmedProductManifestClaims(
						manifest as unknown as BuiltSubjectAwareClaimManifest,
					).length
				: manifest.claimCount;
		if (claims.length !== expectedClaimCount)
			throw new FactLockError(
				"CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
				"Fact Lock claims không khớp ClaimManifest đã chọn.",
			);
		const status = deriveFactLockRunStatus(claims as FactLockStoredClaim[]);
		await transaction
			.update(factLockRun)
			.set({ status })
			.where(
				and(
					eq(factLockRun.id, run.id),
					eq(factLockRun.workspaceId, actor.workspaceId),
				),
			);
	});
	return toFactLockReadModel(
		await loadFactLockReadContext(actor, input.projectId, {
			includeArchived: true,
		}),
	);
}
