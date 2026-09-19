import { randomUUID } from "node:crypto";
import {
	getCurrentChannelStrategy,
	saveCurrentChannelStrategy,
} from "@affichannel/api/services/channel-strategy-repository";
import { createProjectRepository } from "@affichannel/api/services/project-repository";
import { createProject } from "@affichannel/core/project/project-service";
import { db, user, workspace } from "@affichannel/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled =
	process.env.AFFICHANNEL_M1_TEST_DATABASE_URL?.trim() !== undefined;

const strategyInput = {
	niche: "Sức khỏe đời sống",
	targetAudience: "Người đi làm bận rộn",
	presenceMode: "FACELESS" as const,
	tone: "Thực tế, rõ ràng",
	contentPillars: ["Thói quen", "Dinh dưỡng", "Vận động"],
	contentSeries: ["Một phút khỏe hơn"],
	preferredCreationPaths: ["SCRIPTED" as const],
	preferredContentFormats: [{ key: "SCRIPTED_STANDARD", version: 1 }],
	postingFrequency: { postsPerWeek: 3, preferredDays: [1, 3, 5] },
	visualStyle: "Tối giản, sáng, dễ đọc",
	organicAffiliateMixTarget: {
		organicPercentage: 70,
		affiliatePercentage: 30,
	},
};

const suite = enabled ? describe : describe.skip;

suite("AFF-US-025 trusted PostgreSQL integration", () => {
	const workspaceA = `us25-a-${randomUUID()}`;
	const workspaceB = `us25-b-${randomUUID()}`;
	const workspaceC = `us25-c-${randomUUID()}`;
	const workspaceD = `us25-d-${randomUUID()}`;
	const userA = `us25-user-a-${randomUUID()}`;
	const userB = `us25-user-b-${randomUUID()}`;
	const userC = `us25-user-c-${randomUUID()}`;
	const userD = `us25-user-d-${randomUUID()}`;
	const actorA = { workspaceId: workspaceA, userId: userA };
	const actorB = { workspaceId: workspaceB, userId: userB };
	const actorC = { workspaceId: workspaceC, userId: userC };
	const actorD = { workspaceId: workspaceD, userId: userD };

	beforeAll(async () => {
		await db.insert(user).values([
			{ id: userA, name: "US25 A", email: `${userA}@example.test` },
			{ id: userB, name: "US25 B", email: `${userB}@example.test` },
			{ id: userC, name: "US25 C", email: `${userC}@example.test` },
			{ id: userD, name: "US25 D", email: `${userD}@example.test` },
		]);
		await db.insert(workspace).values([
			{ id: workspaceA, name: "US25 Workspace A" },
			{ id: workspaceB, name: "US25 Workspace B" },
			{ id: workspaceC, name: "US25 Workspace C" },
			{ id: workspaceD, name: "US25 Workspace D" },
		]);
	});

	afterAll(async () => {
		await db
			.delete(workspace)
			.where(
				inArray(workspace.id, [workspaceA, workspaceB, workspaceC, workspaceD]),
			);
		await db.delete(user).where(inArray(user.id, [userA, userB, userC, userD]));
	});

	it("creates, reads, versions, isolates, and rejects stale updates", async () => {
		expect(await getCurrentChannelStrategy(actorA)).toBeNull();
		const first = await saveCurrentChannelStrategy(actorA, {
			...strategyInput,
			expectedVersion: null,
		});
		expect(first?.version).toBe(1);
		expect(first?.contentPillars).toEqual(strategyInput.contentPillars);

		const workspaceBStrategy = await saveCurrentChannelStrategy(actorB, {
			...strategyInput,
			expectedVersion: null,
		});
		expect(workspaceBStrategy?.workspaceId).toBe(workspaceB);
		expect((await getCurrentChannelStrategy(actorA))?.workspaceId).toBe(
			workspaceA,
		);
		expect((await getCurrentChannelStrategy(actorB))?.workspaceId).toBe(
			workspaceB,
		);

		const second = await saveCurrentChannelStrategy(actorA, {
			...strategyInput,
			niche: "Sức khỏe đời sống v2",
			expectedVersion: 1,
		});
		expect(second?.version).toBe(2);
		await expect(
			saveCurrentChannelStrategy(actorA, {
				...strategyInput,
				expectedVersion: 1,
			}),
		).rejects.toMatchObject({
			code: "CHANNEL_STRATEGY_VERSION_CONFLICT",
		});
	});

	it("snapshots S1 and S2 into new Projects without mutating Project A", async () => {
		const first = await saveCurrentChannelStrategy(actorC, {
			...strategyInput,
			expectedVersion: null,
		});
		const repository = createProjectRepository();
		const projectInput = (name: string) => ({
			name,
			productId: null,
			platform: "tiktok" as const,
			goal: "Kiểm tra snapshot",
			durationSeconds: 30,
			angle: "Góc thử nghiệm",
			description: undefined,
			contentType: "ORGANIC" as const,
			creationPath: "SCRIPTED" as const,
			contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
		});

		const projectA = await createProject(
			repository,
			actorC,
			projectInput("US25 Project A"),
		);
		expect(first?.version).toBe(1);
		expect(projectA.channelStrategySnapshot?.version).toBe(1);

		await saveCurrentChannelStrategy(actorC, {
			...strategyInput,
			niche: "Sức khỏe đời sống v2",
			expectedVersion: 1,
		});
		const projectB = await createProject(
			repository,
			actorC,
			projectInput("US25 Project B"),
		);
		const reloadedA = await repository.findProject({
			workspaceId: workspaceC,
			projectId: projectA.id,
		});
		expect(reloadedA?.channelStrategySnapshot?.version).toBe(1);
		expect(projectB.channelStrategySnapshot?.version).toBe(2);
	});

	it("keeps no-strategy project creation valid without a phantom snapshot", async () => {
		const repository = createProjectRepository();
		const project = await createProject(repository, actorD, {
			name: "US25 No Strategy Project",
			productId: null,
			platform: "tiktok",
			goal: "Không có strategy",
			durationSeconds: 30,
			angle: "Góc mặc định",
			description: undefined,
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
		});
		expect(project.channelStrategySnapshot).toBeNull();
	});
});
