import { randomUUID } from "node:crypto";
import {
	getCurrentChannelStrategy,
	saveCurrentChannelStrategy,
} from "@affichannel/api/services/channel-strategy-repository";
import {
	createPlannedContentItemRepository,
	PlannedContentItemError,
} from "@affichannel/api/services/planned-content-repository";
import { db, product, user, workspace } from "@affichannel/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled =
	process.env.AFFICHANNEL_M1_TEST_DATABASE_URL?.trim() !== undefined;
const suite = enabled ? describe : describe.skip;

const strategyInput = {
	niche: "Nhà cửa gọn gàng",
	targetAudience: "Người thuê nhà bận rộn",
	presenceMode: "FACELESS" as const,
	tone: "Thực tế",
	contentPillars: ["Không gian nhỏ", "Routine", "Test sản phẩm"],
	contentSeries: ["Reset 7 phút", "Trước và sau"],
	preferredCreationPaths: ["SCRIPTED" as const, "QUICK_IMAGE" as const],
	preferredContentFormats: [
		{ key: "SCRIPTED_STANDARD", version: 1 },
		{ key: "QUICK_IMAGE_STANDARD", version: 1 },
	],
	postingFrequency: { postsPerWeek: 3, preferredDays: [0, 2, 4] },
	visualStyle: "Sạch",
	organicAffiliateMixTarget: { organicPercentage: 67, affiliatePercentage: 33 },
};

suite("AFF-US-026 trusted PostgreSQL integration", () => {
	const workspaceA = `us26-a-${randomUUID()}`;
	const workspaceB = `us26-b-${randomUUID()}`;
	const userA = `us26-user-a-${randomUUID()}`;
	const userB = `us26-user-b-${randomUUID()}`;
	const productA = randomUUID();
	const productB = randomUUID();
	const actorA = { workspaceId: workspaceA, userId: userA };
	const actorB = { workspaceId: workspaceB, userId: userB };
	const repository = createPlannedContentItemRepository();

	beforeAll(async () => {
		await db.insert(user).values([
			{ id: userA, name: "US26 A", email: `${userA}@example.test` },
			{ id: userB, name: "US26 B", email: `${userB}@example.test` },
		]);
		await db.insert(workspace).values([
			{ id: workspaceA, name: "US26 A", timezone: "Asia/Ho_Chi_Minh" },
			{ id: workspaceB, name: "US26 B", timezone: "Pacific/Kiritimati" },
		]);
		await db.insert(product).values([
			{
				id: productA,
				workspaceId: workspaceA,
				name: "Product A",
				createdByUserId: userA,
			},
			{
				id: productB,
				workspaceId: workspaceB,
				name: "Product B",
				createdByUserId: userB,
			},
		]);
		await saveCurrentChannelStrategy(actorA, {
			...strategyInput,
			expectedVersion: null,
		});
	});

	afterAll(async () => {
		await db
			.delete(workspace)
			.where(inArray(workspace.id, [workspaceA, workspaceB]));
		await db.delete(user).where(inArray(user.id, [userA, userB]));
	});

	it("generates in local-day range, protects moves, converts once, and isolates workspaces", async () => {
		const generated = await repository.generate(actorA, "2026-01-02", 1);
		expect(generated.window).toMatchObject({
			startDate: "2026-01-02",
			endDate: "2026-01-08",
			timezone: "Asia/Ho_Chi_Minh",
		});
		expect(generated.items).toHaveLength(3);
		expect(generated.items.every((item) => item.strategyVersion === 1)).toBe(
			true,
		);

		const first = generated.items[0];
		if (!first) throw new Error("Expected generated item");
		const second = generated.items[1];
		if (!second) throw new Error("Expected second generated item");
		await repository.update(
			actorA,
			second.id,
			{
				scheduledDate: second.scheduledDate,
				scheduledTime: second.scheduledTime,
				timezone: second.timezone,
				contentType: "AFFILIATE",
				creationPath: second.creationPath,
				contentFormat: second.contentFormat,
				pillar: second.pillar,
				series: second.series,
				title: second.title,
				brief: second.brief,
				productId: null,
			},
			second.version,
		);
		const deviated = await repository.getCalendar(actorA, "2026-01-02");
		expect(deviated.mix.deviates).toBe(true);
		expect(
			deviated.items.find((item) => item.id === second.id)?.contentType,
		).toBe("AFFILIATE");
		const moved = await repository.move(
			actorA,
			first.id,
			"2026-01-08",
			first.scheduledTime,
			first.version,
		);
		expect(moved.version).toBe(2);
		await expect(
			repository.move(actorA, first.id, "2026-01-07", first.scheduledTime, 1),
		).rejects.toMatchObject({ code: "PLANNED_CONTENT_ITEM_VERSION_CONFLICT" });

		const concurrent = await Promise.allSettled([
			repository.move(actorA, first.id, "2026-01-06", first.scheduledTime, 2),
			repository.move(actorA, first.id, "2026-01-05", first.scheduledTime, 2),
		]);
		expect(
			concurrent.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			concurrent.filter((result) => result.status === "rejected"),
		).toHaveLength(1);
		await saveCurrentChannelStrategy(actorA, {
			...strategyInput,
			niche: "Nhà cửa v2",
			expectedVersion: 1,
		});

		const withProduct = await repository.update(
			actorA,
			first.id,
			{
				scheduledDate: first.scheduledDate,
				scheduledTime: first.scheduledTime,
				timezone: first.timezone,
				contentType: first.contentType,
				creationPath: first.creationPath,
				contentFormat: first.contentFormat,
				pillar: first.pillar,
				series: first.series,
				title: first.title,
				brief: first.brief,
				productId: productA,
			},
			3,
		);
		const converted = await repository.convert(
			actorA,
			first.id,
			withProduct.version,
		);
		const repeated = await repository.convert(actorA, first.id, 1);
		expect(converted.status).toBe("CONVERTED");
		expect(converted.project.channelStrategySnapshot?.version).toBe(1);
		expect(repeated.status).toBe("ALREADY_CONVERTED");
		expect(repeated.project.id).toBe(converted.project.id);

		const movedAfterConversion = await repository.move(
			actorA,
			first.id,
			"2026-01-04",
			withProduct.scheduledTime,
			withProduct.version + 1,
		);
		expect(movedAfterConversion.conversionProjectId).toBe(converted.project.id);
		expect(
			(await repository.getCalendar(actorA, "2026-01-02")).items.find(
				(item) => item.id === first.id,
			)?.conversionProjectId,
		).toBe(converted.project.id);

		const isolated = await repository.getCalendar(actorB, "2026-01-02");
		expect(isolated.items).toHaveLength(0);
		await expect(
			repository.move(actorB, first.id, "2026-01-03", "10:00", 1),
		).rejects.toMatchObject({ code: "PLANNED_CONTENT_ITEM_NOT_FOUND" });
		await expect(
			repository.update(
				actorA,
				first.id,
				{
					scheduledDate: first.scheduledDate,
					scheduledTime: first.scheduledTime,
					timezone: first.timezone,
					contentType: first.contentType,
					creationPath: first.creationPath,
					contentFormat: first.contentFormat,
					pillar: first.pillar,
					series: first.series,
					title: first.title,
					brief: first.brief,
					productId: productB,
				},
				movedAfterConversion.version,
			),
		).rejects.toMatchObject({ code: "PLANNED_CONTENT_ITEM_PRODUCT_NOT_FOUND" });
	});

	it("keeps a planned item stable when Channel Strategy advances", async () => {
		const before = await repository.getCalendar(actorA, "2026-01-02");
		const item = before.items.find(
			(candidate) => candidate.strategyVersion === 1,
		);
		expect(item).toBeDefined();
		const manual = await repository.create(actorA, {
			scheduledDate: "2026-01-03",
			scheduledTime: "23:30",
			timezone: "UTC",
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
			pillar: "Không gian nhỏ",
			series: null,
			title: "Manual local-time item",
			brief: "Manual test item",
			productId: null,
		});
		expect(manual.timezone).toBe("Asia/Ho_Chi_Minh");
		await saveCurrentChannelStrategy(actorA, {
			...strategyInput,
			niche: "Nhà cửa v3",
			expectedVersion: 2,
		});
		const after = await repository.getCalendar(actorA, "2026-01-02");
		const stable = after.items.find((candidate) => candidate.id === item?.id);
		expect(stable?.strategyVersion).toBe(1);
		expect(stable?.pillar).toBe(item?.pillar);
	});

	it("does not fabricate a plan without a strategy", async () => {
		const calendar = await repository.getCalendar(actorB, "2026-01-02");
		expect(calendar.strategyVersion).toBeNull();
		expect(calendar.items).toEqual([]);
		await expect(
			repository.generate(actorB, "2026-01-02"),
		).rejects.toBeInstanceOf(PlannedContentItemError);
	});

	it("reads the current strategy version after the controlled change", async () => {
		expect((await getCurrentChannelStrategy(actorA))?.version).toBe(3);
	});
});
