import {
	createProject,
	ProjectServiceError,
	updateProject,
} from "@affichannel/core/project/project-service";
import {
	createProjectInputSchema,
	projectIdInputSchema,
	updateProjectInputSchema,
	updateProjectWorkflowInputSchema,
} from "@affichannel/core/project/project-validation";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../index";
import {
	createProjectRepository as createDatabaseProjectRepository,
	getProjectDetails,
	listProjectItems,
} from "../services/project-repository";
import { getWorkspaceActor } from "../services/workspace";

function toOrpcError(error: unknown): never {
	if (error instanceof ProjectServiceError) {
		throw new ORPCError("NOT_FOUND", { message: error.message });
	}

	throw error;
}

async function requireWorkspaceActor(userId: string) {
	const actor = await getWorkspaceActor(userId);

	if (!actor) {
		throw new ORPCError("FORBIDDEN", {
			message: "Your account does not belong to an AffiChannel workspace.",
		});
	}

	return actor;
}

const repository = createDatabaseProjectRepository();

export const projectRouter = {
	list: protectedProcedure.handler(async ({ context }) => {
		const actor = await requireWorkspaceActor(context.session.user.id);
		return listProjectItems(actor.workspaceId);
	}),
	get: protectedProcedure
		.input(projectIdInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			const project = await getProjectDetails(actor.workspaceId, input.id);

			if (!project) {
				throw new ORPCError("NOT_FOUND");
			}

			return project;
		}),
	create: protectedProcedure
		.input(createProjectInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);

			try {
				return await createProject(repository, actor, input);
			} catch (error) {
				return toOrpcError(error);
			}
		}),
	update: protectedProcedure
		.input(updateProjectInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);

			try {
				return await updateProject(repository, actor, input);
			} catch (error) {
				return toOrpcError(error);
			}
		}),
	archive: protectedProcedure
		.input(projectIdInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			const archived = await repository.archiveProject({
				workspaceId: actor.workspaceId,
				projectId: input.id,
			});

			if (!archived) {
				throw new ORPCError("NOT_FOUND");
			}

			return archived;
		}),
	updateWorkflow: protectedProcedure
		.input(updateProjectWorkflowInputSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			const updated = await repository.updateWorkflow({
				workspaceId: actor.workspaceId,
				projectId: input.id,
				currentStepKey: input.currentStepKey,
			});

			if (!updated) {
				throw new ORPCError("NOT_FOUND");
			}

			return updated;
		}),
};
