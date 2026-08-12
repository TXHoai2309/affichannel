import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({
	path: resolve(process.cwd(), "apps/web/.env"),
	override: true,
});

const { db, product, productFact, productFactHistory, user } = await import(
	"@affichannel/db"
);
const { eq } = await import("drizzle-orm");
const { ProductFactServiceError } = await import(
	"@affichannel/core/product-fact/errors"
);
const { ProductServiceError } = await import(
	"@affichannel/core/product/product-errors"
);
const { createProduct, deleteProduct, getProduct, archiveProduct } =
	await import("../packages/api/src/services/product-service.ts");
const {
	createProductFact,
	deleteProductFact,
	getProductFact,
	listProductFactHistory,
	listProductFacts,
	updateProductFact,
} = await import("../packages/api/src/services/product-fact-service.ts");
const { getWorkspaceActor } = await import(
	"../packages/api/src/services/workspace.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const email = process.env.E2E_AUTH_EMAIL?.trim();
if (!email)
	throw new Error(
		"Set E2E_AUTH_EMAIL before running Product Facts integration tests.",
	);
const [fixedUser] = await db
	.select({ id: user.id })
	.from(user)
	.where(eq(user.email, email))
	.limit(1);
if (!fixedUser)
	throw new Error("E2E_AUTH_EMAIL does not exist in the database.");
const actor = await getWorkspaceActor(fixedUser.id);
if (!actor)
	throw new Error("The fixed account has no internal workspace membership.");

const prefix = `US006_${Date.now()}_${randomUUID().slice(0, 8)}`;
let productId: string | undefined;

try {
	const createdProduct = await createProduct(actor, {
		name: `${prefix}_Product`,
		category: "Audio",
		status: "active",
		thumbnailUrl: undefined,
		sourceUrl: undefined,
		affiliateUrl: undefined,
		priceAmount: null,
		currency: "VND",
	});
	productId = createdProduct.id;

	const draft = await createProductFact(actor, {
		productId,
		data: {
			content: "Pin có thời lượng 20 giờ",
			type: "feature",
			status: "draft",
			sourceType: null,
			sourceLabel: null,
			sourceUrl: null,
			confirmedAt: null,
			expiresAt: null,
			notes: null,
		},
	});
	assert(draft.status === "draft", "Feature Fact should be created as draft.");

	try {
		await createProductFact(actor, {
			productId,
			data: {
				content: "Giá 129.000đ",
				type: "price",
				status: "verified",
				sourceType: null,
				sourceLabel: null,
				sourceUrl: null,
				confirmedAt: null,
				expiresAt: null,
				notes: null,
			},
		});
		throw new Error("Verified price without evidence was accepted.");
	} catch (error) {
		assert(
			error instanceof ProductFactServiceError &&
				error.code === "FACT_EVIDENCE_REQUIRED",
			"Missing evidence should be rejected.",
		);
	}

	const verified = await createProductFact(actor, {
		productId,
		data: {
			content: "Giá 129.000đ",
			type: "price",
			status: "verified",
			sourceType: "official",
			sourceLabel: "Website thương hiệu",
			sourceUrl: "https://example.com/price",
			confirmedAt: "2026-08-12",
			expiresAt: "2026-08-20",
			notes: "Đã đối chiếu",
		},
	});
	assert(
		verified.status === "verified",
		"Verified Fact should be stored as verified.",
	);

	const notesOnly = await updateProductFact(actor, {
		id: verified.id,
		data: {
			content: verified.content,
			type: verified.type,
			status: "verified",
			sourceType: verified.sourceType,
			sourceLabel: verified.sourceLabel,
			sourceUrl: verified.sourceUrl,
			confirmedAt: verified.confirmedAt,
			expiresAt: verified.expiresAt,
			notes: "Ghi chú đã cập nhật",
		},
		verificationIntent: "preserve",
	});
	assert(
		notesOnly.status === "verified",
		"Notes-only verified edit should remain verified.",
	);

	const edited = await updateProductFact(actor, {
		id: verified.id,
		data: {
			content: "Giá 149.000đ",
			type: "price",
			status: "verified",
			sourceType: "official",
			sourceLabel: "Website thương hiệu",
			sourceUrl: "https://example.com/price",
			confirmedAt: "2026-08-12",
			expiresAt: "2026-08-20",
			notes: "Đã đổi giá",
		},
		verificationIntent: "preserve",
	});
	assert(
		edited.status === "draft",
		"Sensitive verified edit should demote to draft.",
	);
	const reverified = await updateProductFact(actor, {
		id: edited.id,
		data: {
			content: edited.content,
			type: edited.type,
			status: "verified",
			sourceType: edited.sourceType,
			sourceLabel: edited.sourceLabel,
			sourceUrl: edited.sourceUrl,
			confirmedAt: edited.confirmedAt,
			expiresAt: edited.expiresAt,
			notes: edited.notes,
		},
		verificationIntent: "verify",
	});
	assert(
		reverified.status === "verified",
		"A valid evidence-backed Fact should be reverified.",
	);

	const second = await createProductFact(actor, {
		productId,
		data: {
			content: "Có chế độ chống ồn",
			type: "feature",
			status: "draft",
			sourceType: null,
			sourceLabel: null,
			sourceUrl: null,
			confirmedAt: null,
			expiresAt: null,
			notes: null,
		},
	});
	const typeChanged = await updateProductFact(actor, {
		id: second.id,
		data: {
			content: "Price without evidence",
			type: "price",
			status: "verified",
			sourceType: null,
			sourceLabel: null,
			sourceUrl: null,
			confirmedAt: null,
			expiresAt: null,
			notes: null,
		},
		verificationIntent: "preserve",
	});
	assert(
		typeChanged.status === "draft",
		"Feature-to-price edit should default to draft.",
	);
	try {
		await updateProductFact(actor, {
			id: second.id,
			data: { ...typeChanged, status: "verified" },
			verificationIntent: "verify",
		});
		throw new Error("Explicit verification without evidence was accepted.");
	} catch (error) {
		assert(
			error instanceof ProductFactServiceError &&
				error.code === "FACT_EVIDENCE_REQUIRED",
			"Explicit verification must validate evidence for the new type.",
		);
	}
	const secondVerified = await updateProductFact(actor, {
		id: second.id,
		data: {
			...typeChanged,
			status: "verified",
			sourceType: "official",
			sourceLabel: "Official source",
			sourceUrl: "https://example.com/second",
			confirmedAt: "2026-08-12",
		},
		verificationIntent: "verify",
	});
	assert(
		secondVerified.status === "verified",
		"Explicit verification with evidence should succeed.",
	);
	const inactive = await updateProductFact(actor, {
		id: second.id,
		data: { ...secondVerified, status: "inactive" },
		verificationIntent: "preserve",
	});
	assert(
		inactive.status === "inactive",
		"Fact should support inactive status.",
	);
	try {
		await updateProductFact(actor, {
			id: second.id,
			data: {
				...inactive,
				status: "verified",
				sourceType: null,
				sourceLabel: null,
				sourceUrl: null,
				confirmedAt: null,
			},
			verificationIntent: "verify",
		});
		throw new Error("Inactive Fact was verified without evidence.");
	} catch (error) {
		assert(
			error instanceof ProductFactServiceError &&
				error.code === "FACT_EVIDENCE_REQUIRED",
			"Inactive Fact verification must validate evidence.",
		);
	}
	await updateProductFact(actor, {
		id: second.id,
		data: { ...secondVerified, status: "verified" },
		verificationIntent: "verify",
	});
	await updateProductFact(actor, {
		id: second.id,
		data: {
			content: "Có chế độ chống ồn",
			type: "feature",
			status: "draft",
			sourceType: null,
			sourceLabel: null,
			sourceUrl: null,
			confirmedAt: null,
			expiresAt: null,
			notes: null,
		},
		verificationIntent: "preserve",
	});
	const firstPage = await listProductFacts(actor, { productId, limit: 1 });
	assert(
		firstPage.kind === "success" && firstPage.nextCursor,
		"Fact pagination should return a cursor.",
	);
	const secondPage = await listProductFacts(actor, {
		productId,
		limit: 1,
		cursor: firstPage.nextCursor,
	});
	assert(
		secondPage.kind === "success" &&
			secondPage.items.length === 1 &&
			secondPage.items[0]?.id !== firstPage.items[0]?.id,
		"Fact cursor should advance without duplication.",
	);
	const filtered = await listProductFacts(actor, {
		productId,
		type: "feature",
		search: "chống ồn",
		limit: 30,
	});
	assert(
		filtered.kind === "success" &&
			filtered.items.some((item) => item.id === second.id),
		"Fact type/search filter failed.",
	);

	const beforeDeleteHistory = await listProductFactHistory(actor, {
		productId,
		factId: draft.id,
		limit: 20,
	});
	assert(
		beforeDeleteHistory.kind === "success" &&
			beforeDeleteHistory.items.some((item) => item.action === "created"),
		"Create history snapshot missing.",
	);
	await deleteProductFact(actor, draft.id);
	const afterDeleteHistory = await listProductFactHistory(actor, {
		productId,
		factId: draft.id,
		limit: 20,
	});
	assert(
		afterDeleteHistory.kind === "success" &&
			afterDeleteHistory.items.some(
				(item) => item.action === "deleted" && item.productFactId === draft.id,
			),
		"Deleted Fact history must retain the original Fact id.",
	);

	try {
		await getProductFact(
			{ ...actor, workspaceId: `other-${randomUUID()}` },
			verified.id,
		);
		throw new Error("Cross-workspace Fact read unexpectedly succeeded.");
	} catch (error) {
		assert(
			error instanceof ProductFactServiceError &&
				error.code === "FACT_NOT_FOUND",
			"Cross-workspace Fact access must be blocked.",
		);
	}

	try {
		await deleteProduct(actor, productId);
		throw new Error("Product with Facts was deleted unexpectedly.");
	} catch (error) {
		assert(
			error instanceof ProductServiceError && error.code === "PRODUCT_IN_USE",
			"Product with Facts must not be hard deleted.",
		);
	}
	await archiveProduct(actor, productId);
	const archived = await getProduct(actor, productId);
	assert(
		archived.usage.factCount === 2 && archived.usage.factHistoryCount > 0,
		"Archive must preserve Facts and history counts.",
	);

	console.log("Product Facts integration test passed.");
} finally {
	if (productId) {
		await db
			.delete(productFactHistory)
			.where(eq(productFactHistory.productId, productId));
		await db.delete(productFact).where(eq(productFact.productId, productId));
		await db.delete(product).where(eq(product.id, productId));
	}
}
