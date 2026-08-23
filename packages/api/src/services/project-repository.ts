import { randomUUID } from "node:crypto";
import {
	type ContentFormatReadModel,
	type ContentType,
	type CreationPath,
	resolveContentFormatRef,
} from "@affichannel/core";
import type {
	ProjectRepository,
	ProjectWorkflowState,
} from "@affichannel/core/project/project-service";
import { ProjectServiceError } from "@affichannel/core/project/project-service";
import type {
	PersistedProjectStepStatus,
	ProjectStepKey,
} from "@affichannel/core/project/project-types";
import {
	contentBrief,
	db,
	product,
	project,
	projectStepStatus,
} from "@affichannel/db";
import { and, desc, eq, isNull, or } from "drizzle-orm";

export type ProjectDetails = {
	id: string;
	name: string;
	contentType: ContentType | null;
	creationPath: CreationPath | null;
	contentFormat: ContentFormatReadModel | null;
	product: {
		id: string;
		name: string;
	};
	currentStepKey: ProjectStepKey;
	brief: {
		platform: "tiktok";
		goal: string;
		durationSeconds: number;
		angle: string;
		description: string | null;
	};
	stepStatuses: Array<{
		stepKey: ProjectStepKey;
		status: PersistedProjectStepStatus;
	}>;
	archivedAt: Date | null;
	updatedAt: Date;
};

export type ProjectListItem = Pick<
	ProjectDetails,
	| "id"
	| "name"
	| "contentType"
	| "creationPath"
	| "contentFormat"
	| "currentStepKey"
	| "updatedAt"
> & {
	product: ProjectDetails["product"];
};

type FindProjectOptions = {
	workspaceId: string;
	projectId: string;
	includeArchived?: boolean;
};

async function findProjectDetails(
	options: FindProjectOptions,
): Promise<ProjectDetails | undefined> {
	const conditions = [
		eq(project.workspaceId, options.workspaceId),
		eq(project.id, options.projectId),
	];

	if (!options.includeArchived) {
		conditions.push(isNull(project.archivedAt));
	}

	const [record] = await db
		.select({
			id: project.id,
			name: project.name,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
			currentStepKey: project.currentStepKey,
			archivedAt: project.archivedAt,
			updatedAt: project.updatedAt,
			productId: product.id,
			productName: product.name,
			platform: contentBrief.platform,
			goal: contentBrief.goal,
			durationSeconds: contentBrief.durationSeconds,
			angle: contentBrief.angle,
			description: contentBrief.description,
		})
		.from(project)
		.innerJoin(product, eq(project.productId, product.id))
		.innerJoin(contentBrief, eq(contentBrief.projectId, project.id))
		.where(and(...conditions))
		.limit(1);

	if (!record) {
		return undefined;
	}

	const stepStatuses = await db
		.select({
			stepKey: projectStepStatus.stepKey,
			status: projectStepStatus.status,
		})
		.from(projectStepStatus)
		.where(eq(projectStepStatus.projectId, record.id));

	return {
		id: record.id,
		name: record.name,
		contentType: record.contentType as ContentType | null,
		creationPath: record.creationPath as CreationPath | null,
		contentFormat: resolveContentFormatRef(
			record.contentFormatKey,
			record.contentFormatVersion,
		),
		product: {
			id: record.productId,
			name: record.productName,
		},
		currentStepKey: record.currentStepKey as ProjectStepKey,
		brief: {
			platform: record.platform as "tiktok",
			goal: record.goal,
			durationSeconds: record.durationSeconds,
			angle: record.angle,
			description: record.description,
		},
		stepStatuses: stepStatuses.map((step) => ({
			stepKey: step.stepKey as ProjectStepKey,
			status: step.status as PersistedProjectStepStatus,
		})),
		archivedAt: record.archivedAt,
		updatedAt: record.updatedAt,
	};
}

export async function listProjectItems(
	workspaceId: string,
): Promise<ProjectListItem[]> {
	return db
		.select({
			id: project.id,
			name: project.name,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
			currentStepKey: project.currentStepKey,
			updatedAt: project.updatedAt,
			productId: product.id,
			productName: product.name,
		})
		.from(project)
		.innerJoin(product, eq(project.productId, product.id))
		.where(
			and(eq(project.workspaceId, workspaceId), isNull(project.archivedAt)),
		)
		.orderBy(desc(project.updatedAt))
		.then((records) =>
			records.map((record) => ({
				id: record.id,
				name: record.name,
				contentType: record.contentType as ContentType | null,
				creationPath: record.creationPath as CreationPath | null,
				contentFormat: resolveContentFormatRef(
					record.contentFormatKey,
					record.contentFormatVersion,
				),
				currentStepKey: record.currentStepKey as ProjectStepKey,
				updatedAt: record.updatedAt,
				product: { id: record.productId, name: record.productName },
			})),
		);
}

export function createProjectRepository(): ProjectRepository<ProjectDetails> {
	return {
		async findAccessibleProduct({ workspaceId, productId, projectId }) {
			if (projectId) {
				const [existingProjectProduct] = await db
					.select({ id: product.id })
					.from(product)
					.leftJoin(project, eq(project.productId, product.id))
					.where(
						and(
							eq(product.id, productId),
							eq(product.workspaceId, workspaceId),
							or(
								and(eq(product.status, "active"), isNull(product.archivedAt)),
								and(
									eq(project.id, projectId),
									eq(project.workspaceId, workspaceId),
								),
							),
						),
					)
					.limit(1);

				return existingProjectProduct;
			}

			const [existingProduct] = await db
				.select({ id: product.id })
				.from(product)
				.where(
					and(
						eq(product.id, productId),
						eq(product.workspaceId, workspaceId),
						eq(product.status, "active"),
						isNull(product.archivedAt),
					),
				)
				.limit(1);

			return existingProduct;
		},
		async createProjectBundle({ actor, input, workflow }) {
			const projectId = randomUUID();

			await db.transaction(async (transaction) => {
				const [availableProduct] = await transaction
					.select({ id: product.id })
					.from(product)
					.where(
						and(
							eq(product.id, input.productId),
							eq(product.workspaceId, actor.workspaceId),
							eq(product.status, "active"),
							isNull(product.archivedAt),
						),
					)
					.limit(1);

				if (!availableProduct) {
					throw new ProjectServiceError("PRODUCT_NOT_FOUND");
				}

				await transaction.insert(project).values({
					id: projectId,
					workspaceId: actor.workspaceId,
					name: input.name,
					productId: input.productId,
					currentStepKey: workflow.currentStepKey,
					createdByUserId: actor.userId,
				});

				await transaction.insert(contentBrief).values({
					id: randomUUID(),
					projectId,
					platform: input.platform,
					goal: input.goal,
					durationSeconds: input.durationSeconds,
					angle: input.angle,
					description: input.description,
				});

				await transaction.insert(projectStepStatus).values(
					workflow.stepStatuses.map((step) => ({
						id: randomUUID(),
						projectId,
						stepKey: step.stepKey,
						status: step.status,
					})),
				);
			});

			const createdProject = await findProjectDetails({
				workspaceId: actor.workspaceId,
				projectId,
			});

			if (!createdProject) {
				throw new Error("Could not load the created project.");
			}

			return createdProject;
		},
		findProject: findProjectDetails,
		listProjects({ workspaceId }) {
			return listProjectDetails(workspaceId);
		},
		async updateProjectBundle({ actor, input }) {
			const didUpdate = await db.transaction(async (transaction) => {
				const [updatedProject] = await transaction
					.update(project)
					.set({
						name: input.name,
						productId: input.productId,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(project.id, input.id),
							eq(project.workspaceId, actor.workspaceId),
						),
					)
					.returning({ id: project.id });

				if (!updatedProject) {
					return false;
				}

				await transaction
					.update(contentBrief)
					.set({
						platform: input.platform,
						goal: input.goal,
						durationSeconds: input.durationSeconds,
						angle: input.angle,
						description: input.description,
						updatedAt: new Date(),
					})
					.where(eq(contentBrief.projectId, input.id));

				return true;
			});

			if (!didUpdate) {
				return undefined;
			}

			return findProjectDetails({
				workspaceId: actor.workspaceId,
				projectId: input.id,
			});
		},
		async archiveProject({ workspaceId, projectId }) {
			const [archivedProject] = await db
				.update(project)
				.set({ archivedAt: new Date(), updatedAt: new Date() })
				.where(
					and(
						eq(project.id, projectId),
						eq(project.workspaceId, workspaceId),
						isNull(project.archivedAt),
					),
				)
				.returning({ id: project.id });

			if (!archivedProject) {
				return undefined;
			}

			return findProjectDetails({
				workspaceId,
				projectId,
				includeArchived: true,
			});
		},
	};
}

export async function listProjectDetails(
	workspaceId: string,
): Promise<ProjectDetails[]> {
	const records = await db
		.select({ id: project.id })
		.from(project)
		.where(
			and(eq(project.workspaceId, workspaceId), isNull(project.archivedAt)),
		)
		.orderBy(desc(project.updatedAt));

	const details = await Promise.all(
		records.map((record) =>
			findProjectDetails({ workspaceId, projectId: record.id }),
		),
	);

	return details.filter((item): item is ProjectDetails => Boolean(item));
}

export async function getProjectDetails(
	workspaceId: string,
	projectId: string,
) {
	return findProjectDetails({ workspaceId, projectId });
}

export function toWorkflowState(
	projectDetails: ProjectDetails,
): ProjectWorkflowState {
	return {
		currentStepKey: projectDetails.currentStepKey,
		stepStatuses: projectDetails.stepStatuses,
	};
}
