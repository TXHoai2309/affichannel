import {
	evaluateFactGenerationUsability,
	factRequiresEvidence,
	hasFactEvidence,
	hasSensitiveFactChanges,
	isValidFactDateRange,
	ProductFactServiceError,
	resolveBusinessToday,
	resolveFactStatusAfterEdit,
} from "@affichannel/core";
import type {
	CreateProductFactInput,
	DeleteProductFactInput,
	ListProductFactInput,
	ProductFactFields,
	UpdateProductFactInput,
} from "@affichannel/core/product-fact/validation";

import {
	deleteProductFactRecord,
	findProductFactRecord,
	insertProductFactRecord,
	listProductFactHistoryRecords,
	listProductFactRecords,
	updateProductFactRecord,
} from "./product-fact-repository";
import type { WorkspaceActor } from "./workspace";

function validateFactForPersistence(data: ProductFactFields) {
	if (!isValidFactDateRange(data.confirmedAt, data.expiresAt)) {
		throw new ProductFactServiceError("FACT_INVALID_DATE_RANGE");
	}
	if (
		data.status === "verified" &&
		factRequiresEvidence(data.type) &&
		!hasFactEvidence(data)
	) {
		throw new ProductFactServiceError("FACT_EVIDENCE_REQUIRED");
	}
}

function withFactAssessment<
	T extends Awaited<ReturnType<typeof findProductFactRecord>>,
>(record: T, today: ReturnType<typeof resolveBusinessToday>) {
	if (!record) return record;
	const evaluated = evaluateFactGenerationUsability(record, today);
	return {
		...record,
		assessment: evaluated.assessment,
		generationUsability: evaluated.usability,
	};
}

export async function listProductFacts(
	actor: WorkspaceActor,
	input: ListProductFactInput,
) {
	const result = await listProductFactRecords(actor, input);
	if (result.kind === "invalid_cursor") {
		throw new ProductFactServiceError("INVALID_CURSOR");
	}
	if (result.kind === "product_not_found") {
		throw new ProductFactServiceError("PRODUCT_NOT_FOUND");
	}
	const today = resolveBusinessToday();
	return {
		...result,
		items: result.items.map((item) => withFactAssessment(item, today)),
	};
}

export async function getProductFact(actor: WorkspaceActor, factId: string) {
	const record = await findProductFactRecord(actor, factId);
	if (!record) {
		throw new ProductFactServiceError("FACT_NOT_FOUND");
	}
	return withFactAssessment(record, resolveBusinessToday());
}

export async function createProductFact(
	actor: WorkspaceActor,
	input: CreateProductFactInput,
) {
	validateFactForPersistence(input.data);
	const result = await insertProductFactRecord(
		actor,
		input.productId,
		input.data,
	);
	if (result.kind === "product_not_found") {
		throw new ProductFactServiceError("PRODUCT_NOT_FOUND");
	}
	return result.record;
}

export async function updateProductFact(
	actor: WorkspaceActor,
	input: UpdateProductFactInput,
) {
	const current = await findProductFactRecord(actor, input.id);
	if (!current) {
		throw new ProductFactServiceError("FACT_NOT_FOUND");
	}

	const sensitiveChanged = hasSensitiveFactChanges(current, input.data);
	const data: ProductFactFields = {
		...input.data,
		status: resolveFactStatusAfterEdit(
			current.status,
			input.data.status,
			sensitiveChanged,
			input.verificationIntent,
		),
	};
	validateFactForPersistence(data);

	const result = await updateProductFactRecord(
		actor,
		input.id,
		data,
		input.expectedRevision,
	);
	if (result.kind === "not_found") {
		throw new ProductFactServiceError("FACT_NOT_FOUND");
	}
	if (result.kind === "concurrent_modification") {
		throw new ProductFactServiceError("FACT_CONCURRENT_MODIFICATION");
	}
	return result.record;
}

export async function deleteProductFact(
	actor: WorkspaceActor,
	input: DeleteProductFactInput,
) {
	const result = await deleteProductFactRecord(
		actor,
		input.id,
		input.expectedRevision,
	);
	if (result.kind === "not_found") {
		throw new ProductFactServiceError("FACT_NOT_FOUND");
	}
	if (result.kind === "concurrent_modification") {
		throw new ProductFactServiceError("FACT_CONCURRENT_MODIFICATION");
	}
	return { deleted: true, productId: result.productId };
}

export async function listProductFactHistory(
	actor: WorkspaceActor,
	input: { productId: string; factId?: string; limit: number },
) {
	const result = await listProductFactHistoryRecords(actor, input);
	if (result.kind === "product_not_found") {
		throw new ProductFactServiceError("PRODUCT_NOT_FOUND");
	}
	return result;
}
