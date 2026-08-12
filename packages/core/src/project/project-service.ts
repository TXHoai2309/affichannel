import {
	type PersistedProjectStepStatus,
	PROJECT_STEP_KEYS,
	type ProjectStepKey,
} from "./project-types";
import type {
	CreateProjectInput,
	UpdateProjectInput,
} from "./project-validation";

export type ProjectActor = {
	workspaceId: string;
	userId: string;
};

export type ProjectWorkflowState = {
	currentStepKey: ProjectStepKey;
	stepStatuses: Array<{
		stepKey: ProjectStepKey;
		status: PersistedProjectStepStatus;
	}>;
};

export type ProjectServiceErrorCode = "PROJECT_NOT_FOUND" | "PRODUCT_NOT_FOUND";

export class ProjectServiceError extends Error {
	constructor(public readonly code: ProjectServiceErrorCode) {
		super(code);
	}
}

export function createInitialProjectWorkflowState(): ProjectWorkflowState {
	return {
		currentStepKey: "product",
		stepStatuses: PROJECT_STEP_KEYS.map((stepKey) => ({
			stepKey,
			status: "not_started",
		})),
	};
}

export type ProjectRepository<TProject> = {
	findAccessibleProduct(input: {
		workspaceId: string;
		productId: string;
		projectId?: string;
	}): Promise<{ id: string } | undefined>;
	createProjectBundle(input: {
		actor: ProjectActor;
		input: CreateProjectInput;
		workflow: ProjectWorkflowState;
	}): Promise<TProject>;
	findProject(input: {
		workspaceId: string;
		projectId: string;
		includeArchived?: boolean;
	}): Promise<TProject | undefined>;
	listProjects(input: { workspaceId: string }): Promise<TProject[]>;
	updateProjectBundle(input: {
		actor: ProjectActor;
		input: UpdateProjectInput;
	}): Promise<TProject | undefined>;
	archiveProject(input: {
		workspaceId: string;
		projectId: string;
	}): Promise<TProject | undefined>;
};

export async function createProject<TProject>(
	repository: ProjectRepository<TProject>,
	actor: ProjectActor,
	input: CreateProjectInput,
) {
	const product = await repository.findAccessibleProduct({
		workspaceId: actor.workspaceId,
		productId: input.productId,
	});

	if (!product) {
		throw new ProjectServiceError("PRODUCT_NOT_FOUND");
	}

	return repository.createProjectBundle({
		actor,
		input,
		workflow: createInitialProjectWorkflowState(),
	});
}

export async function updateProject<TProject>(
	repository: ProjectRepository<TProject>,
	actor: ProjectActor,
	input: UpdateProjectInput,
) {
	const existingProject = await repository.findProject({
		workspaceId: actor.workspaceId,
		projectId: input.id,
	});

	if (!existingProject) {
		throw new ProjectServiceError("PROJECT_NOT_FOUND");
	}

	const product = await repository.findAccessibleProduct({
		workspaceId: actor.workspaceId,
		productId: input.productId,
		projectId: input.id,
	});

	if (!product) {
		throw new ProjectServiceError("PRODUCT_NOT_FOUND");
	}

	return repository.updateProjectBundle({ actor, input });
}
