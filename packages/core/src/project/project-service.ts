import type { ContentFormatRegistry } from "../content-format/registry";
import type { LegacyProjectExceptionReason } from "./legacy-affiliate-compatibility";
import {
	type PersistedProjectStepStatus,
	PROJECT_STEP_KEYS,
	type ProjectStepKey,
} from "./project-types";
import type {
	CreateProjectInput,
	UpdateProjectInput,
} from "./project-validation";
import {
	classifyPersistedProjectIdentity,
	classifyProjectWriteIdentity,
	type PersistedProjectIdentityState,
	type ProjectWriteIdentity,
	type ProjectWriteIdentityClassification,
	type ProjectWriteIdentityRejectionReason,
} from "./project-write-contract";

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

export type ProjectServiceErrorCode =
	| "PROJECT_NOT_FOUND"
	| "PRODUCT_NOT_FOUND"
	| "INVALID_PROJECT_WRITE_IDENTITY";

export type ProjectServiceErrorMetadata = {
	reasonCode?:
		| ProjectWriteIdentityRejectionReason
		| LegacyProjectExceptionReason
		| "PROJECT_IDENTITY_CHANGED_DURING_UPDATE";
};

export class ProjectServiceError extends Error {
	constructor(
		public readonly code: ProjectServiceErrorCode,
		public readonly metadata: ProjectServiceErrorMetadata = {},
	) {
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
		identity: ProjectWriteIdentity;
		workflow: ProjectWorkflowState;
	}): Promise<TProject>;
	findProject(input: {
		workspaceId: string;
		projectId: string;
		includeArchived?: boolean;
	}): Promise<TProject | undefined>;
	findProjectIdentity(input: {
		workspaceId: string;
		projectId: string;
	}): Promise<PersistedProjectIdentityState | undefined>;
	listProjects(input: { workspaceId: string }): Promise<TProject[]>;
	updateProjectBundle(input: {
		actor: ProjectActor;
		input: UpdateProjectInput;
		identityUpdate: ProjectIdentityUpdate;
	}): Promise<TProject | undefined>;
	archiveProject(input: {
		workspaceId: string;
		projectId: string;
	}): Promise<TProject | undefined>;
};

export type ProjectIdentityUpdate =
	| {
			strategy: "preserve";
			expectedIdentity: PersistedProjectIdentityState;
	  }
	| {
			strategy: "set";
			expectedIdentity: PersistedProjectIdentityState;
			desiredIdentity: ProjectWriteIdentity;
			requireExpectedProductLinkage: boolean;
	  };

export type ProjectIdentityUpdateResolution =
	| { success: true; identityUpdate: ProjectIdentityUpdate }
	| {
			success: false;
			reasonCode:
				| LegacyProjectExceptionReason
				| ProjectWriteIdentityRejectionReason;
	  };

/** Pure update planner with a registry seam for persisted deprecated fixtures. */
export function resolveProjectIdentityUpdate(
	requestClassification: ProjectWriteIdentityClassification,
	persistedIdentity: PersistedProjectIdentityState,
	registry?: ContentFormatRegistry,
): ProjectIdentityUpdateResolution {
	if (requestClassification.kind === "rejected") {
		return {
			success: false,
			reasonCode: requestClassification.reasonCode,
		};
	}
	const persistedClassification = classifyPersistedProjectIdentity(
		persistedIdentity,
		registry,
	);
	if (persistedClassification.kind === "rejected") {
		return {
			success: false,
			reasonCode: persistedClassification.reasonCode,
		};
	}

	return {
		success: true,
		identityUpdate:
			requestClassification.kind === "canonical"
				? {
						strategy: "set",
						expectedIdentity: persistedIdentity,
						desiredIdentity: requestClassification.identity,
						requireExpectedProductLinkage:
							persistedClassification.kind === "legacy",
					}
				: persistedClassification.kind === "legacy"
					? {
							strategy: "set",
							expectedIdentity: persistedIdentity,
							desiredIdentity: persistedClassification.effectiveIdentity,
							requireExpectedProductLinkage: true,
						}
					: {
							strategy: "preserve",
							expectedIdentity: persistedIdentity,
						},
	};
}

export async function createProject<TProject>(
	repository: ProjectRepository<TProject>,
	actor: ProjectActor,
	input: CreateProjectInput,
) {
	const classification = classifyProjectWriteIdentity(input);
	if (classification.kind === "rejected") {
		throw new ProjectServiceError("INVALID_PROJECT_WRITE_IDENTITY", {
			reasonCode: classification.reasonCode,
		});
	}
	const identity =
		classification.kind === "legacy"
			? classification.effectiveIdentity
			: classification.identity;

	if (input.productId !== null) {
		const product = await repository.findAccessibleProduct({
			workspaceId: actor.workspaceId,
			productId: input.productId,
		});

		if (!product) {
			throw new ProjectServiceError("PRODUCT_NOT_FOUND");
		}
	} else if (identity.contentType !== "ORGANIC") {
		throw new ProjectServiceError("PRODUCT_NOT_FOUND");
	}

	return repository.createProjectBundle({
		actor,
		input,
		identity,
		workflow: createInitialProjectWorkflowState(),
	});
}

export async function updateProject<TProject>(
	repository: ProjectRepository<TProject>,
	actor: ProjectActor,
	input: UpdateProjectInput,
) {
	const classification = classifyProjectWriteIdentity(input);
	if (classification.kind === "rejected") {
		throw new ProjectServiceError("INVALID_PROJECT_WRITE_IDENTITY", {
			reasonCode: classification.reasonCode,
		});
	}

	const existingProject = await repository.findProject({
		workspaceId: actor.workspaceId,
		projectId: input.id,
	});

	if (!existingProject) {
		throw new ProjectServiceError("PROJECT_NOT_FOUND");
	}

	if (input.productId !== null) {
		const product = await repository.findAccessibleProduct({
			workspaceId: actor.workspaceId,
			productId: input.productId,
			projectId: input.id,
		});

		if (!product) {
			throw new ProjectServiceError("PRODUCT_NOT_FOUND");
		}
	} else {
		const requestedIdentity =
			classification.kind === "legacy"
				? classification.effectiveIdentity
				: classification.identity;
		if (requestedIdentity.contentType !== "ORGANIC") {
			throw new ProjectServiceError("PRODUCT_NOT_FOUND");
		}
	}

	const persistedIdentity = await repository.findProjectIdentity({
		workspaceId: actor.workspaceId,
		projectId: input.id,
	});
	if (!persistedIdentity) {
		throw new ProjectServiceError("PROJECT_NOT_FOUND");
	}

	const identityResolution = resolveProjectIdentityUpdate(
		classification,
		persistedIdentity,
	);
	if (!identityResolution.success) {
		throw new ProjectServiceError("INVALID_PROJECT_WRITE_IDENTITY", {
			reasonCode: identityResolution.reasonCode,
		});
	}

	return repository.updateProjectBundle({
		actor,
		input,
		identityUpdate: identityResolution.identityUpdate,
	});
}
