import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({
	path: resolve(process.cwd(), "apps/web/.env"),
	override: true,
});

const { db, product, project } = await import("@affichannel/db");
const { eq } = await import("drizzle-orm");
const { createProject, updateProject } = await import(
	"@affichannel/core/project/project-service"
);
const { ProductServiceError } = await import(
	"@affichannel/core/product/product-errors"
);
const {
	archiveProduct,
	createProduct,
	deleteProduct,
	getProduct,
	listMinimalProducts,
	listProducts,
	restoreProduct,
} = await import("../packages/api/src/services/product-service.ts");
const { createProjectRepository } = await import(
	"../packages/api/src/services/project-repository.ts"
);
const { getWorkspaceActor } = await import(
	"../packages/api/src/services/workspace.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

const email = process.env.E2E_AUTH_EMAIL?.trim();
if (!email) {
	throw new Error(
		"Set E2E_AUTH_EMAIL before running product integration tests.",
	);
}

const actor = await (async () => {
	const user = await import("@affichannel/db");
	const { eq: equals } = await import("drizzle-orm");
	const [record] = await user.db
		.select({ id: user.user.id })
		.from(user.user)
		.where(equals(user.user.email, email))
		.limit(1);
	if (!record) {
		throw new Error("E2E_AUTH_EMAIL does not exist in the database.");
	}
	const workspaceActor = await getWorkspaceActor(record.id);
	if (!workspaceActor) {
		throw new Error("The fixed account has no internal workspace membership.");
	}
	return workspaceActor;
})();

const repository = createProjectRepository();
const prefix = `US005_${Date.now()}_${randomUUID().slice(0, 8)}`;
const productIds: string[] = [];
const projectIds: string[] = [];

try {
	const reusableProduct = await createProduct(actor, {
		name: `${prefix}_Reusable Product`,
		category: `${prefix}_Audio`,
		status: "active",
		thumbnailUrl: undefined,
		sourceUrl: "https://example.com/source",
		affiliateUrl: "https://example.com/affiliate",
		priceAmount: 129000,
		currency: "VND",
	});
	productIds.push(reusableProduct.id);
	const cursorProduct = await createProduct(actor, {
		name: `${prefix}_Cursor Product`,
		category: `${prefix}_Cursor`,
		status: "active",
		thumbnailUrl: undefined,
		sourceUrl: undefined,
		affiliateUrl: undefined,
		priceAmount: null,
		currency: "VND",
	});
	productIds.push(cursorProduct.id);

	const projectInput = (name: string) => ({
		name,
		productId: reusableProduct.id,
		platform: "tiktok" as const,
		goal: "Kiểm tra Product Management",
		durationSeconds: 30,
		angle: "Kiểm thử luồng tái sử dụng Product",
		description: undefined,
	});

	const firstProject = await createProject(
		repository,
		actor,
		projectInput(`${prefix}_Project_A`),
	);
	const secondProject = await createProject(
		repository,
		actor,
		projectInput(`${prefix}_Project_B`),
	);
	projectIds.push(firstProject.id, secondProject.id);

	const searchable = await listProducts(actor, {
		search: `${prefix}_Reusable`,
		category: `${prefix}_Audio`,
		archiveScope: "activeOnly",
		limit: 50,
	});
	assert(searchable.kind === "success", "Product search should succeed.");
	assert(
		searchable.items.some((item) => item.id === reusableProduct.id),
		"Product search/filter failed.",
	);

	const firstCursorPage = await listProducts(actor, {
		search: prefix,
		archiveScope: "activeOnly",
		limit: 1,
	});
	assert(
		firstCursorPage.kind === "success" && firstCursorPage.nextCursor !== null,
		"Product list should return a cursor when more items are available.",
	);
	const secondCursorPage = await listProducts(actor, {
		search: prefix,
		archiveScope: "activeOnly",
		limit: 1,
		cursor: firstCursorPage.nextCursor,
	});
	assert(
		secondCursorPage.kind === "success" &&
			secondCursorPage.items.length === 1 &&
			secondCursorPage.items[0]?.id !== firstCursorPage.items[0]?.id,
		"Product list cursor should return the next item without duplication.",
	);

	await archiveProduct(actor, reusableProduct.id);
	const archived = await getProduct(actor, reusableProduct.id);
	assert(Boolean(archived.archivedAt), "Product should be archived.");
	assert(
		archived.usage.referenceCount === 2,
		"Archive must preserve both project references.",
	);

	const selectableProducts = await listMinimalProducts(actor);
	assert(
		!selectableProducts.some((item) => item.id === reusableProduct.id),
		"Archived Product must not be selectable for a new Project.",
	);
	const archivedProducts = await listProducts(actor, {
		archiveScope: "archivedOnly",
		limit: 50,
	});
	assert(
		archivedProducts.kind === "success",
		"Archived Product filter should succeed.",
	);
	assert(
		archivedProducts.items.some((item) => item.id === reusableProduct.id),
		"Archived Product should be discoverable in archive filter.",
	);

	await restoreProduct(actor, reusableProduct.id);
	const restoredSelectable = await listMinimalProducts(actor);
	assert(
		restoredSelectable.some((item) => item.id === reusableProduct.id),
		"Restored Product should be selectable again.",
	);
	await archiveProduct(actor, reusableProduct.id);

	await repository.archiveProject({
		workspaceId: actor.workspaceId,
		projectId: firstProject.id,
	});
	const afterProjectArchive = await getProduct(actor, reusableProduct.id);
	assert(
		afterProjectArchive.usage.referenceCount === 2,
		"Archived Project still counts as a reference.",
	);
	assert(
		afterProjectArchive.usage.activeProjectCount === 1,
		"Active project count should exclude archived Projects.",
	);

	const savedProject = await updateProject(repository, actor, {
		id: secondProject.id,
		name: `${prefix}_Project_B_Updated`,
		productId: reusableProduct.id,
		platform: "tiktok",
		goal: "Giữ Product đã archive",
		durationSeconds: 30,
		angle: "Project cũ vẫn giữ liên kết",
		description: undefined,
	});
	assert(
		savedProject?.product.id === reusableProduct.id,
		"Existing Project must remain editable with archived Product.",
	);

	try {
		await deleteProduct(actor, reusableProduct.id);
		throw new Error("Referenced Product was deleted unexpectedly.");
	} catch (error) {
		assert(
			error instanceof ProductServiceError && error.code === "PRODUCT_IN_USE",
			"Referenced Product deletion must return PRODUCT_IN_USE.",
		);
	}

	const inactiveProduct = await createProduct(actor, {
		name: `${prefix}_Inactive Product`,
		category: `${prefix}_Inactive`,
		status: "inactive",
		thumbnailUrl: undefined,
		sourceUrl: undefined,
		affiliateUrl: undefined,
		priceAmount: null,
		currency: "VND",
	});
	productIds.push(inactiveProduct.id);
	const selectableAfterInactive = await listMinimalProducts(actor);
	assert(
		!selectableAfterInactive.some((item) => item.id === inactiveProduct.id),
		"Inactive Product must not be selectable for a new Project.",
	);

	const unusedProduct = await createProduct(actor, {
		name: `${prefix}_Unused Product`,
		category: `${prefix}_Unused`,
		status: "active",
		thumbnailUrl: undefined,
		sourceUrl: undefined,
		affiliateUrl: undefined,
		priceAmount: null,
		currency: "VND",
	});
	productIds.push(unusedProduct.id);
	await deleteProduct(actor, unusedProduct.id);
	try {
		await getProduct(actor, unusedProduct.id);
		throw new Error("Unused Product still exists after deletion.");
	} catch (error) {
		assert(
			error instanceof ProductServiceError &&
				error.code === "PRODUCT_NOT_FOUND",
			"Unused Product should be deleted.",
		);
	}

	const otherWorkspace = {
		workspaceId: `us005-other-${randomUUID()}`,
		userId: actor.userId,
	};
	try {
		await getProduct(otherWorkspace, reusableProduct.id);
		throw new Error("Cross-workspace Product read unexpectedly succeeded.");
	} catch (error) {
		assert(
			error instanceof ProductServiceError &&
				error.code === "PRODUCT_NOT_FOUND",
			"Cross-workspace Product read must be blocked.",
		);
	}

	console.log("Product management integration test passed.");
} finally {
	for (const projectId of projectIds) {
		await db.delete(project).where(eq(project.id, projectId));
	}
	for (const productId of productIds) {
		await db.delete(product).where(eq(product.id, productId));
	}
}
