import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({
	path: resolve(process.cwd(), "apps/web/.env"),
	override: true,
});

const {
	db,
	factDependency,
	factInvalidationEvent,
	product,
	productFact,
	productFactHistory,
	user,
} = await import("@affichannel/db");
const { and, eq, inArray, like } = await import("drizzle-orm");
const { addBusinessDays, resolveBusinessToday } = await import(
	"@affichannel/core/product-fact/freshness"
);
const { ProductFactServiceError } = await import(
	"@affichannel/core/product-fact/errors"
);
const { createProduct } = await import(
	"../packages/api/src/services/product-service.ts"
);
const {
	createProductFact,
	deleteProductFact,
	getProductFact,
	listProductFacts,
	updateProductFact,
} = await import("../packages/api/src/services/product-fact-service.ts");
const {
	listFactDependenciesForDependent,
	listFactInvalidationEventsForDependent,
	registerFactDependency,
	replaceFactDependencies,
} = await import("../packages/api/src/services/fact-dependency-repository.ts");
const { getWorkspaceActor } = await import(
	"../packages/api/src/services/workspace.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function assertRaceResultsAreSafe(
	results: PromiseSettledResult<unknown>[],
	message: string,
) {
	assert(
		results.every(
			(result) =>
				result.status === "fulfilled" ||
				(result.reason instanceof ProductFactServiceError &&
					result.reason.code === "FACT_CONCURRENT_MODIFICATION"),
		),
		message,
	);
}

const email = process.env.E2E_AUTH_EMAIL?.trim();
if (!email) throw new Error("Set E2E_AUTH_EMAIL before running US007 tests.");
const [fixedUser] = await db
	.select({ id: user.id })
	.from(user)
	.where(eq(user.email, email))
	.limit(1);
if (!fixedUser)
	throw new Error("E2E_AUTH_EMAIL does not exist in the database.");
const actor = await getWorkspaceActor(fixedUser.id);
if (!actor) throw new Error("The fixed account has no workspace membership.");

const prefix = `US007_${Date.now()}_${randomUUID().slice(0, 8)}`;
const productIds: string[] = [];
const factIds: string[] = [];

try {
	const today = resolveBusinessToday();
	const staleConfirmedAt = addBusinessDays(today, -8);
	const yesterday = addBusinessDays(today, -1);
	assert(staleConfirmedAt && yesterday, "Could not derive business dates.");

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
	productIds.push(createdProduct.id);

	const createRaceFact = async (content: string) => {
		const fact = await createProductFact(actor, {
			productId: createdProduct.id,
			data: {
				content,
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
		factIds.push(fact.id);
		return fact;
	};

	const price = await createProductFact(actor, {
		productId: createdProduct.id,
		data: {
			content: "Giá cũ cần kiểm tra",
			type: "price",
			status: "verified",
			sourceType: "official",
			sourceLabel: "Website hãng",
			sourceUrl: "https://example.com/price",
			confirmedAt: staleConfirmedAt,
			expiresAt: null,
			notes: null,
		},
	});
	factIds.push(price.id);
	const promotion = await createProductFact(actor, {
		productId: createdProduct.id,
		data: {
			content: "Khuyến mãi đã hết hạn",
			type: "promotion",
			status: "verified",
			sourceType: "official",
			sourceLabel: "Website hãng",
			sourceUrl: "https://example.com/promotion",
			confirmedAt: yesterday,
			expiresAt: yesterday,
			notes: null,
		},
	});
	factIds.push(promotion.id);

	const listed = await listProductFacts(actor, {
		productId: createdProduct.id,
		limit: 30,
	});
	assert(listed.kind === "success", "Freshness list query failed.");
	const listedPrice = listed.items.find((item) => item.id === price.id);
	const listedPromotion = listed.items.find((item) => item.id === promotion.id);
	assert(
		listedPrice?.assessment.freshness === "needs_update" &&
			listedPrice.generationUsability === "allowed_with_warning",
		"Stale price assessment or usability is incorrect.",
	);
	assert(
		listedPromotion?.assessment.freshness === "expired" &&
			listedPromotion.generationUsability === "blocked",
		"Expired promotion assessment or usability is incorrect.",
	);

	const firstRegistration = await registerFactDependency(actor, {
		productFactId: price.id,
		dependentType: "script",
		dependentId: `${prefix}_idempotent`,
	});
	const secondRegistration = await registerFactDependency(actor, {
		productFactId: price.id,
		dependentType: "script",
		dependentId: `${prefix}_idempotent`,
	});
	assert(
		firstRegistration.kind === "success" &&
			secondRegistration.kind === "success" &&
			firstRegistration.dependency.id === secondRegistration.dependency.id,
		"Dependency registration must be idempotent.",
	);

	const replaceDependentId = `${prefix}_replace`;
	await replaceFactDependencies(actor, {
		dependentType: "fact_lock",
		dependentId: replaceDependentId,
		productFactIds: [price.id, promotion.id],
	});
	await replaceFactDependencies(actor, {
		dependentType: "fact_lock",
		dependentId: replaceDependentId,
		productFactIds: [promotion.id],
	});
	const replacedDependencies = await listFactDependenciesForDependent(actor, {
		dependentType: "fact_lock",
		dependentId: replaceDependentId,
	});
	assert(
		replacedDependencies.some(
			(dependency) =>
				dependency.productFactId === price.id && dependency.detachedAt,
		),
		"Replacing dependencies must retain the old row as detached.",
	);

	const invalidationDependentId = `${prefix}_invalidation`;
	await registerFactDependency(actor, {
		productFactId: price.id,
		dependentType: "video",
		dependentId: invalidationDependentId,
	});
	const currentPrice = await getProductFact(actor, price.id);
	const editedPrice = await updateProductFact(actor, {
		id: price.id,
		expectedRevision: currentPrice.revision,
		data: {
			content: "Giá mới cần duyệt",
			type: currentPrice.type,
			status: "verified",
			sourceType: currentPrice.sourceType,
			sourceLabel: currentPrice.sourceLabel,
			sourceUrl: currentPrice.sourceUrl,
			confirmedAt: currentPrice.confirmedAt,
			expiresAt: currentPrice.expiresAt,
			notes: currentPrice.notes,
		},
		verificationIntent: "preserve",
	});
	assert(
		editedPrice.revision === currentPrice.revision + 1 &&
			editedPrice.status === "draft",
		"Sensitive Fact edit must bump revision and require re-verification.",
	);
	const invalidationEvents = await listFactInvalidationEventsForDependent(
		actor,
		{
			dependentType: "video",
			dependentId: invalidationDependentId,
		},
	);
	assert(
		invalidationEvents.length === 1 &&
			invalidationEvents[0]?.reason === "fact_changed",
		"Fact change must create exactly one invalidation event.",
	);
	const invalidatedDependencies = await listFactDependenciesForDependent(
		actor,
		{
			dependentType: "video",
			dependentId: invalidationDependentId,
		},
	);
	assert(
		invalidatedDependencies[0]?.invalidatedAt &&
			invalidatedDependencies[0].invalidationReason === "fact_changed",
		"Changed Fact dependency was not invalidated.",
	);

	const currentRevisionDependentId = `${prefix}_current_revision`;
	const currentRevisionRegistration = await registerFactDependency(actor, {
		productFactId: price.id,
		dependentType: "script",
		dependentId: currentRevisionDependentId,
	});
	assert(
		currentRevisionRegistration.kind === "success" &&
			currentRevisionRegistration.dependency.factRevision ===
				editedPrice.revision,
		"New dependency must capture the current Fact revision.",
	);
	const notesOnly = await updateProductFact(actor, {
		id: price.id,
		expectedRevision: editedPrice.revision,
		data: {
			content: editedPrice.content,
			type: editedPrice.type,
			status: editedPrice.status,
			sourceType: editedPrice.sourceType,
			sourceLabel: editedPrice.sourceLabel,
			sourceUrl: editedPrice.sourceUrl,
			confirmedAt: editedPrice.confirmedAt,
			expiresAt: editedPrice.expiresAt,
			notes: "Ghi chú không làm đổi revision",
		},
		verificationIntent: "preserve",
	});
	assert(
		notesOnly.revision === editedPrice.revision,
		"Notes-only edit must not bump Fact revision.",
	);
	const notesDependencies = await listFactDependenciesForDependent(actor, {
		dependentType: "script",
		dependentId: currentRevisionDependentId,
	});
	assert(
		notesDependencies[0]?.invalidatedAt === null,
		"Notes-only edit must keep the current revision dependency active.",
	);

	const registerRaceFact = await createRaceFact("Register race baseline");
	const registerRaceDependentId = `${prefix}_register_race`;
	const registerRaceResults = await Promise.allSettled([
		registerFactDependency(actor, {
			productFactId: registerRaceFact.id,
			dependentType: "script",
			dependentId: registerRaceDependentId,
		}),
		updateProductFact(actor, {
			id: registerRaceFact.id,
			expectedRevision: registerRaceFact.revision,
			data: {
				content: "Register race updated",
				type: registerRaceFact.type,
				status: "draft",
				sourceType: registerRaceFact.sourceType,
				sourceLabel: registerRaceFact.sourceLabel,
				sourceUrl: registerRaceFact.sourceUrl,
				confirmedAt: registerRaceFact.confirmedAt,
				expiresAt: registerRaceFact.expiresAt,
				notes: registerRaceFact.notes,
			},
			verificationIntent: "preserve",
		}),
	]);
	assertRaceResultsAreSafe(
		registerRaceResults,
		"Register dependency race produced an unexpected failure.",
	);
	const registerRaceCurrent = await getProductFact(actor, registerRaceFact.id);
	const registerRaceDependencies = await listFactDependenciesForDependent(
		actor,
		{
			dependentType: "script",
			dependentId: registerRaceDependentId,
		},
	);
	const activeRegisterRaceDependencies = registerRaceDependencies.filter(
		(dependency) =>
			dependency.detachedAt === null && dependency.invalidatedAt === null,
	);
	assert(
		activeRegisterRaceDependencies.every(
			(dependency) => dependency.factRevision === registerRaceCurrent.revision,
		),
		"Register dependency race left a stale active dependency.",
	);

	const replaceRaceFact = await createRaceFact("Replace race baseline");
	const replaceRaceDependentId = `${prefix}_replace_race`;
	await registerFactDependency(actor, {
		productFactId: replaceRaceFact.id,
		dependentType: "script",
		dependentId: replaceRaceDependentId,
	});
	const replaceRaceResults = await Promise.allSettled([
		replaceFactDependencies(actor, {
			dependentType: "script",
			dependentId: replaceRaceDependentId,
			productFactIds: [replaceRaceFact.id],
		}),
		updateProductFact(actor, {
			id: replaceRaceFact.id,
			expectedRevision: replaceRaceFact.revision,
			data: {
				content: "Replace race updated",
				type: replaceRaceFact.type,
				status: "draft",
				sourceType: replaceRaceFact.sourceType,
				sourceLabel: replaceRaceFact.sourceLabel,
				sourceUrl: replaceRaceFact.sourceUrl,
				confirmedAt: replaceRaceFact.confirmedAt,
				expiresAt: replaceRaceFact.expiresAt,
				notes: replaceRaceFact.notes,
			},
			verificationIntent: "preserve",
		}),
	]);
	assertRaceResultsAreSafe(
		replaceRaceResults,
		"Replace dependency race produced an unexpected failure.",
	);
	const replaceRaceCurrent = await getProductFact(actor, replaceRaceFact.id);
	const replaceRaceDependencies = await listFactDependenciesForDependent(
		actor,
		{
			dependentType: "script",
			dependentId: replaceRaceDependentId,
		},
	);
	const activeReplaceRaceDependencies = replaceRaceDependencies.filter(
		(dependency) =>
			dependency.detachedAt === null && dependency.invalidatedAt === null,
	);
	assert(
		activeReplaceRaceDependencies.every(
			(dependency) => dependency.factRevision === replaceRaceCurrent.revision,
		),
		"Replace dependency race left a stale active dependency.",
	);

	const crossWorkspace = await registerFactDependency(
		{ ...actor, workspaceId: `other-${randomUUID()}` },
		{
			productFactId: price.id,
			dependentType: "script",
			dependentId: `${prefix}_cross_workspace`,
		},
	);
	assert(
		crossWorkspace.kind === "fact_not_found",
		"Cross-workspace dependency registration must be rejected.",
	);

	const concurrencyBase = await getProductFact(actor, price.id);
	const concurrentData = (content: string) => ({
		content,
		type: concurrencyBase.type,
		status: concurrencyBase.status,
		sourceType: concurrencyBase.sourceType,
		sourceLabel: concurrencyBase.sourceLabel,
		sourceUrl: concurrencyBase.sourceUrl,
		confirmedAt: concurrencyBase.confirmedAt,
		expiresAt: concurrencyBase.expiresAt,
		notes: concurrencyBase.notes,
	});
	const concurrentResults = await Promise.allSettled([
		updateProductFact(actor, {
			id: price.id,
			expectedRevision: concurrencyBase.revision,
			data: concurrentData("Cập nhật đồng thời A"),
			verificationIntent: "preserve",
		}),
		updateProductFact(actor, {
			id: price.id,
			expectedRevision: concurrencyBase.revision,
			data: concurrentData("Cập nhật đồng thời B"),
			verificationIntent: "preserve",
		}),
	]);
	assert(
		concurrentResults.filter((result) => result.status === "fulfilled")
			.length === 1 &&
			concurrentResults.filter(
				(result) =>
					result.status === "rejected" &&
					result.reason instanceof ProductFactServiceError &&
					result.reason.code === "FACT_CONCURRENT_MODIFICATION",
			).length === 1,
		"Concurrent updates must produce one success and one safe conflict.",
	);

	const deleteDependentId = `${prefix}_delete`;
	await registerFactDependency(actor, {
		productFactId: promotion.id,
		dependentType: "render",
		dependentId: deleteDependentId,
	});
	const currentPromotion = await getProductFact(actor, promotion.id);
	await deleteProductFact(actor, {
		id: promotion.id,
		expectedRevision: currentPromotion.revision,
	});
	const deleteEvents = await listFactInvalidationEventsForDependent(actor, {
		dependentType: "render",
		dependentId: deleteDependentId,
	});
	assert(
		deleteEvents.length === 1 && deleteEvents[0]?.reason === "fact_deleted",
		"Fact deletion must create a deletion invalidation event.",
	);

	console.log(
		"US007 Product Fact freshness, revision, dependency and concurrency checks passed.",
	);
} finally {
	await db
		.delete(factInvalidationEvent)
		.where(
			and(
				eq(factInvalidationEvent.workspaceId, actor.workspaceId),
				like(factInvalidationEvent.dependentId, `${prefix}%`),
			),
		);
	await db
		.delete(factDependency)
		.where(
			and(
				eq(factDependency.workspaceId, actor.workspaceId),
				like(factDependency.dependentId, `${prefix}%`),
			),
		);
	if (factIds.length > 0) {
		await db
			.delete(productFactHistory)
			.where(inArray(productFactHistory.productFactId, factIds));
		await db.delete(productFact).where(inArray(productFact.id, factIds));
	}
	if (productIds.length > 0) {
		await db.delete(product).where(inArray(product.id, productIds));
	}
}
