import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { db, mediaAsset, mediaAssetLink, project, user } from "@affichannel/db";
import { expect, type Page, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { sha256Bytes } from "../../../../packages/api/src/media/media-asset-checksum";
import { createMediaAssetStorage } from "../../../../packages/api/src/media/media-asset-storage-factory";
import { findMediaAssetByIdForWorkspace } from "../../../../packages/api/src/services/media-asset-repository";
import {
	finalizeMediaAssetUpload,
	linkMediaAssetToProject,
	prepareMediaAssetUpload,
} from "../../../../packages/api/src/services/media-asset-service";
import { createProjectRepository } from "../../../../packages/api/src/services/project-repository";
import { getWorkspaceActor } from "../../../../packages/api/src/services/workspace";
import { createProject } from "../../../../packages/core/src/project/project-service";

const fixedAccountEmail = process.env.E2E_AUTH_EMAIL;
const fixedAccountPassword = process.env.E2E_AUTH_PASSWORD;
const evidenceRoot =
	process.env.AFFICHANNEL_EVIDENCE_DIR ??
	"C:/Users/User/.codex/visualizations/2026/09/07/aff-us-020-project-media-preview";
const imageBytes = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

type MediaFixture = {
	assetId: string;
	projectId: string;
	storageKey: string;
	displayName: string;
	actor: { workspaceId: string; userId: string };
};

test.describe("AFF-US-020 project media preview", () => {
	test.beforeEach(async () => {
		test.skip(
			!fixedAccountEmail || !fixedAccountPassword,
			"Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD.",
		);
	});

	test("opens protected linked image preview, closes it, and preserves the link", async ({
		page,
	}) => {
		const fixture = await seedMediaFixture();
		try {
			await signIn(page);
			await page.goto(`/projects/${fixture.projectId}`);
			await expect(
				page.getByRole("button", { name: "Xem", exact: true }),
			).toBeVisible();

			const downloadResponse = page.waitForResponse(
				(response) =>
					response.request().method() === "POST" &&
					response.url().includes("/api/rpc/media/getDownload"),
			);
			const protectedPreviewResponse = page.waitForResponse(
				(response) =>
					response.request().method() === "GET" &&
					response.url().includes("/api/media/download/"),
			);
			await page.getByRole("button", { name: "Xem", exact: true }).click();
			const [download, protectedPreview] = await Promise.all([
				downloadResponse,
				protectedPreviewResponse,
			]);
			expect(download.ok()).toBe(true);
			expect(protectedPreview.ok()).toBe(true);
			expect((await protectedPreview.body()).byteLength).toBeGreaterThan(0);

			const dialog = page.getByRole("dialog");
			await expect(dialog).toBeVisible();
			const image = dialog.locator(
				`img[alt="Xem trước ${fixture.displayName}"]`,
			);
			await expect(image).toBeVisible();
			await expect
				.poll(async () =>
					image.evaluate((element) => {
						const preview = element as HTMLImageElement;
						return preview.complete && preview.naturalWidth > 0;
					}),
				)
				.toBe(true);
			await captureEvidence(page, "project-media-preview-open");

			const dialogMarkup = await dialog.innerHTML();
			expect(dialogMarkup).not.toContain(fixture.storageKey);
			expect(dialogMarkup).not.toContain("storageKey");
			const previewSrc = await image.getAttribute("src");
			expect(previewSrc).toMatch(/\/api\/media\/download\//u);
			expect(previewSrc).not.toContain(fixture.storageKey);

			await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
			await expect(dialog).toHaveCount(0);
			await expect(
				page.getByText(fixture.displayName, { exact: true }),
			).toBeVisible();

			const links = await db
				.select({ id: mediaAssetLink.id })
				.from(mediaAssetLink)
				.where(
					and(
						eq(mediaAssetLink.projectId, fixture.projectId),
						eq(mediaAssetLink.mediaAssetId, fixture.assetId),
					),
				);
			expect(links).toHaveLength(1);
			const [asset] = await db
				.select({
					displayName: mediaAsset.displayName,
					status: mediaAsset.status,
					storageKey: mediaAsset.storageKey,
					usageRights: mediaAsset.usageRights,
				})
				.from(mediaAsset)
				.where(eq(mediaAsset.id, fixture.assetId));
			expect(asset).toEqual({
				displayName: fixture.displayName,
				status: "ready",
				storageKey: fixture.storageKey,
				usageRights: "owned",
			});
		} finally {
			await cleanupMediaFixture(fixture);
		}
	});

	test("shows a safe visible error when protected preview download fails", async ({
		page,
	}) => {
		const fixture = await seedMediaFixture();
		try {
			await signIn(page);
			await page.route("**/api/rpc/media/getDownload", (route) =>
				route.abort(),
			);
			await page.goto(`/projects/${fixture.projectId}`);
			await page.getByRole("button", { name: "Xem", exact: true }).click();

			const dialog = page.getByRole("dialog");
			await expect(dialog).toBeVisible();
			await expect(
				dialog.getByText("Không thể tải bản xem trước.", { exact: true }),
			).toBeVisible();
			await captureEvidence(page, "project-media-preview-error");
			const dialogMarkup = await dialog.innerHTML();
			expect(dialogMarkup).not.toContain(fixture.storageKey);
			expect(dialogMarkup).not.toContain("R2");
		} finally {
			await page.unroute("**/api/rpc/media/getDownload");
			await cleanupMediaFixture(fixture);
		}
	});
});

async function captureEvidence(page: Page, name: string) {
	await mkdir(evidenceRoot, { recursive: true });
	await page.screenshot({
		path: `${evidenceRoot}/${name}.png`,
		fullPage: false,
	});
}

async function seedMediaFixture(): Promise<MediaFixture> {
	const actor = await requireActor();
	const projectRecord = await createProject(createProjectRepository(), actor, {
		name: `US020 preview ${Date.now()}`,
		productId: null,
		platform: "tiktok",
		goal: "Kiểm tra project media preview",
		durationSeconds: 30,
		angle: "Hiển thị media đã liên kết",
		description: "Disposable project media preview fixture.",
		contentType: "ORGANIC",
		creationPath: "SCRIPTED",
		contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
	});
	const displayName = `UAT preview ${Date.now()}`;
	const prepared = await prepareMediaAssetUpload(actor, {
		mediaType: "image",
		originalFilename: "uat-preview.png",
		displayName,
		declaredMimeType: "image/png",
		declaredByteSize: imageBytes.byteLength,
		usageRights: "owned",
		tags: ["uat", "preview"],
		idempotencyKey: `us020-preview-${randomUUID()}`,
	});
	const pending = await findMediaAssetByIdForWorkspace(actor, prepared.assetId);
	if (!pending) throw new Error("Media preview fixture was not prepared.");
	await createMediaAssetStorage("local").put({
		storageKey: pending.storageKey,
		body: imageBytes,
		contentType: "image/png",
		checksumSha256: sha256Bytes(imageBytes),
	});
	const finalized = await finalizeMediaAssetUpload(actor, {
		assetId: prepared.assetId,
		uploadSessionId: prepared.uploadSessionId,
	});
	if (finalized.outcome !== "ready") {
		throw new Error(
			`Media preview fixture finalization failed: ${finalized.outcome}`,
		);
	}
	await linkMediaAssetToProject(actor, {
		assetId: prepared.assetId,
		projectId: projectRecord.id,
	});
	return {
		actor,
		assetId: prepared.assetId,
		displayName,
		projectId: projectRecord.id,
		storageKey: pending.storageKey,
	};
}

async function cleanupMediaFixture(fixture: MediaFixture) {
	await db
		.delete(mediaAssetLink)
		.where(
			and(
				eq(mediaAssetLink.projectId, fixture.projectId),
				eq(mediaAssetLink.mediaAssetId, fixture.assetId),
			),
		);
	await createMediaAssetStorage("local")
		.cleanup(fixture.storageKey)
		.catch(() => undefined);
	await db.delete(mediaAsset).where(eq(mediaAsset.id, fixture.assetId));
	await db.delete(project).where(eq(project.id, fixture.projectId));
}

async function requireActor() {
	if (!fixedAccountEmail) throw new Error("E2E_AUTH_EMAIL is required.");
	const [fixedUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, fixedAccountEmail))
		.limit(1);
	if (!fixedUser) throw new Error("The fixed E2E account does not exist.");
	const actor = await getWorkspaceActor(fixedUser.id);
	if (!actor) throw new Error("The fixed E2E account has no workspace.");
	return actor;
}

async function signIn(page: Page) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(fixedAccountEmail as string);
	await page.getByLabel("Mật khẩu").fill(fixedAccountPassword as string);
	await page.getByRole("button", { name: "Đăng nhập" }).click();
	await expect(page).toHaveURL(/\/dashboard$/u);
}
