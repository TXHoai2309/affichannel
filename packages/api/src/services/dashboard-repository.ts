import type {
	DashboardFactFreshnessRecord,
	DashboardProjectRecord,
	DashboardRepository,
} from "@affichannel/core/dashboard/dashboard-types";
import {
	db,
	product,
	productFact,
	project,
	projectStepStatus,
} from "@affichannel/db";
import { and, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";

export function createDashboardRepository(): DashboardRepository {
	return {
		async countActiveProjects({ workspaceId }) {
			const [result] = await db
				.select({ value: count() })
				.from(project)
				.where(
					and(
						eq(project.workspaceId, workspaceId),
						isNull(project.archivedAt),
						ne(project.currentStepKey, "completed"),
					),
				);

			return Number(result?.value ?? 0);
		},

		async listRecentProjects({ workspaceId, limit }) {
			const records = await db
				.select({
					id: project.id,
					name: project.name,
					productName: product.name,
					currentStepKey: project.currentStepKey,
					createdAt: project.createdAt,
					updatedAt: project.updatedAt,
				})
				.from(project)
				.innerJoin(product, eq(project.productId, product.id))
				.where(
					and(eq(project.workspaceId, workspaceId), isNull(project.archivedAt)),
				)
				.orderBy(desc(project.updatedAt))
				.limit(limit);

			if (records.length === 0) {
				return [];
			}

			const statuses = await db
				.select({
					projectId: projectStepStatus.projectId,
					stepKey: projectStepStatus.stepKey,
					status: projectStepStatus.status,
				})
				.from(projectStepStatus)
				.where(
					inArray(
						projectStepStatus.projectId,
						records.map((record) => record.id),
					),
				);

			const statusesByProject = new Map<
				string,
				DashboardProjectRecord["stepStatuses"]
			>();

			for (const status of statuses) {
				const projectStatuses = statusesByProject.get(status.projectId) ?? [];
				projectStatuses.push({
					stepKey:
						status.stepKey as DashboardProjectRecord["stepStatuses"][number]["stepKey"],
					status:
						status.status as DashboardProjectRecord["stepStatuses"][number]["status"],
				});
				statusesByProject.set(status.projectId, projectStatuses);
			}

			return records.map((record) => ({
				id: record.id,
				name: record.name,
				productName: record.productName,
				currentStepKey:
					record.currentStepKey as DashboardProjectRecord["currentStepKey"],
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
				stepStatuses: statusesByProject.get(record.id) ?? [],
			}));
		},

		async listFactFreshnessRecords({ workspaceId }) {
			const records = await db
				.select({
					productId: productFact.productId,
					productName: product.name,
					type: productFact.type,
					status: productFact.status,
					sourceType: productFact.sourceType,
					sourceLabel: productFact.sourceLabel,
					sourceUrl: productFact.sourceUrl,
					confirmedAt: productFact.confirmedAt,
					expiresAt: productFact.expiresAt,
				})
				.from(productFact)
				.innerJoin(product, eq(product.id, productFact.productId))
				.where(
					and(
						eq(productFact.workspaceId, workspaceId),
						eq(product.workspaceId, workspaceId),
						inArray(productFact.type, ["price", "promotion"]),
					),
				);

			return records.map(
				(record) =>
					({
						...record,
						type: record.type as DashboardFactFreshnessRecord["type"],
						status: record.status as DashboardFactFreshnessRecord["status"],
						sourceType:
							record.sourceType as DashboardFactFreshnessRecord["sourceType"],
					}) satisfies DashboardFactFreshnessRecord,
			);
		},
	};
}
