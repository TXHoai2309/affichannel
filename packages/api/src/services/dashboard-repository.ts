import type {
	DashboardFactFreshnessRecord,
	DashboardProjectRecord,
	DashboardRepository,
} from "@affichannel/core/dashboard/dashboard-types";
import { db, product, productFact, project } from "@affichannel/db";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";

import { listProjectWorkflowEntrySummaries } from "./project-workflow-entry-service";

export function createDashboardRepository(): DashboardRepository {
	return {
		async countActiveProjects({ workspaceId }) {
			const [result] = await db
				.select({ value: count() })
				.from(project)
				.where(
					and(eq(project.workspaceId, workspaceId), isNull(project.archivedAt)),
				);

			return Number(result?.value ?? 0);
		},

		async listRecentProjects({ workspaceId, userId, limit }) {
			const records = await db
				.select({
					id: project.id,
					name: project.name,
					productName: product.name,
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

			const summaries = await listProjectWorkflowEntrySummaries(
				{ workspaceId, userId },
				records.map((record) => record.id),
			);
			const summariesByProject = new Map(
				summaries.map((summary) => [summary.projectId, summary]),
			);

			return records.flatMap((record) => {
				const workflowEntry = summariesByProject.get(record.id);
				if (!workflowEntry) return [];
				return [
					{
						id: record.id,
						name: record.name,
						productName: record.productName,
						createdAt: record.createdAt,
						updatedAt: record.updatedAt,
						workflowEntry,
					} satisfies DashboardProjectRecord,
				];
			});
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
