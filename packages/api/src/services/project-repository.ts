import { randomUUID } from "node:crypto";
import {
	type ContentFormatReadModel,
	type ContentType,
	type CreationPath,
	isContentType,
	isCreationPath,
	LEGACY_AFFILIATE_IDENTITY,
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
import type { PersistedProjectIdentityState } from "@affichannel/core/project/project-write-contract";
import {
	contentBrief,
	db,
	product,
	project,
	projectStepStatus,
} from "@affichannel/db";
import { and, desc, eq, isNotNull, isNull, or } from "drizzle-orm";

export type ProjectDetails = {
	id: string;
	name: string;
	contentType: ContentType | null;
	creationPath: CreationPath | null;
	contentFormat: ContentFormatReadModel | null;
	isLegacyProjection: boolean;
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
	| "isLegacyProjection"
	| "currentStepKey"
	| "updatedAt"
> & {
	product: ProjectDetails["product"];
};

export type ProjectWorkflowSubject = {
	id: string;
	contentType: string | null;
	creationPath: string | null;
	contentFormatKey: string | null;
	contentFormatVersion: number | null;
	productId: string | null;
	productAccessible: boolean;
};

type FindProjectOptions = {
	workspaceId: string;
	projectId: string;
	includeArchived?: boolean;
};

function expectedIdentityConditions(
	expectedIdentity: PersistedProjectIdentityState,
	requireExpectedProductLinkage: boolean,
) {
	const conditions = [
		expectedIdentity.contentType === null
			? isNull(project.contentType)
			: eq(project.contentType, expectedIdentity.contentType),
		expectedIdentity.creationPath === null
			? isNull(project.creationPath)
			: eq(project.creationPath, expectedIdentity.creationPath),
		expectedIdentity.contentFormatKey === null
			? isNull(project.contentFormatKey)
			: eq(project.contentFormatKey, expectedIdentity.contentFormatKey),
		expectedIdentity.contentFormatVersion === null
			? isNull(project.contentFormatVersion)
			: eq(project.contentFormatVersion, expectedIdentity.contentFormatVersion),
	];

	if (requireExpectedProductLinkage) {
		conditions.push(isNotNull(project.productId));
	}

	return conditions;
}

function projectIdentityReadModel(input: PersistedProjectIdentityState) {
	const isDeterministicLegacy =
		input.productId !== null &&
		input.contentType === null &&
		input.creationPath === null &&
		input.contentFormatKey === null &&
		input.contentFormatVersion === null;

	if (isDeterministicLegacy) {
		return {
			contentType: LEGACY_AFFILIATE_IDENTITY.contentType,
			creationPath: LEGACY_AFFILIATE_IDENTITY.creationPath,
			contentFormat: resolveContentFormatRef(
				LEGACY_AFFILIATE_IDENTITY.contentFormat.key,
				LEGACY_AFFILIATE_IDENTITY.contentFormat.version,
			),
			isLegacyProjection: true,
		};
	}

	return {
		contentType:
			input.contentType !== null && isContentType(input.contentType)
				? input.contentType
				: null,
		creationPath:
			input.creationPath !== null && isCreationPath(input.creationPath)
				? input.creationPath
				: null,
		contentFormat: resolveContentFormatRef(
			input.contentFormatKey,
			input.contentFormatVersion,
		),
		isLegacyProjection: false,
	};
}

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
	const identity = projectIdentityReadModel({
		productId: record.productId,
		contentType: record.contentType,
		creationPath: record.creationPath,
		contentFormatKey: record.contentFormatKey,
		contentFormatVersion: record.contentFormatVersion,
	});

	return {
		id: record.id,
		name: record.name,
		...identity,
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
				...projectIdentityReadModel(record),
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
		async createProjectBundle({ actor, input, identity, workflow }) {
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
					contentType: identity.contentType,
					creationPath: identity.creationPath,
					contentFormatKey: identity.contentFormat.key,
					contentFormatVersion: identity.contentFormat.version,
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
		async findProjectIdentity({ workspaceId, projectId }) {
			const [record] = await db
				.select({
					productId: project.productId,
					contentType: project.contentType,
					creationPath: project.creationPath,
					contentFormatKey: project.contentFormatKey,
					contentFormatVersion: project.contentFormatVersion,
				})
				.from(project)
				.where(
					and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)),
				)
				.limit(1);

			return record;
		},
		listProjects({ workspaceId }) {
			return listProjectDetails(workspaceId);
		},
		async updateProjectBundle({ actor, input, identityUpdate }) {
			const didUpdate = await db.transaction(async (transaction) => {
				const identityValues =
					identityUpdate.strategy === "set"
						? {
								contentType: identityUpdate.desiredIdentity.contentType,
								creationPath: identityUpdate.desiredIdentity.creationPath,
								contentFormatKey:
									identityUpdate.desiredIdentity.contentFormat.key,
								contentFormatVersion:
									identityUpdate.desiredIdentity.contentFormat.version,
							}
						: {};
				const expectedConditions = expectedIdentityConditions(
					identityUpdate.expectedIdentity,
					identityUpdate.strategy === "set" &&
						identityUpdate.requireExpectedProductLinkage,
				);

				const [updatedProject] = await transaction
					.update(project)
					.set({
						name: input.name,
						productId: input.productId,
						...identityValues,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(project.id, input.id),
							eq(project.workspaceId, actor.workspaceId),
							...expectedConditions,
						),
					)
					.returning({ id: project.id });

				if (!updatedProject) {
					throw new ProjectServiceError("INVALID_PROJECT_WRITE_IDENTITY", {
						reasonCode: "PROJECT_IDENTITY_CHANGED_DURING_UPDATE",
					});
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

/** Minimal workspace-authorized Project identity for read-only workflow policy. */
export async function getProjectWorkflowSubject(
	workspaceId: string,
	projectId: string,
): Promise<ProjectWorkflowSubject | undefined> {
	const [record] = await db
		.select({
			id: project.id,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
			productId: project.productId,
			accessibleProductId: product.id,
		})
		.from(project)
		.leftJoin(
			product,
			and(
				eq(project.productId, product.id),
				eq(product.workspaceId, workspaceId),
			),
		)
		.where(
			and(
				eq(project.id, projectId),
				eq(project.workspaceId, workspaceId),
				isNull(project.archivedAt),
			),
		)
		.limit(1);

	return record
		? {
				id: record.id,
				contentType: record.contentType,
				creationPath: record.creationPath,
				contentFormatKey: record.contentFormatKey,
				contentFormatVersion: record.contentFormatVersion,
				productId: record.productId,
				productAccessible: record.accessibleProductId !== null,
			}
		: undefined;
}

export function toWorkflowState(
	projectDetails: ProjectDetails,
): ProjectWorkflowState {
	return {
		currentStepKey: projectDetails.currentStepKey,
		stepStatuses: projectDetails.stepStatuses,
	};
}
