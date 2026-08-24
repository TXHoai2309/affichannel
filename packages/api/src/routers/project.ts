import {
	createProject,
	ProjectServiceError,
	updateProject,
} from "@affichannel/core/project/project-service";
import {
	createProjectInputSchema,
	projectIdInputSchema,
	updateProjectInputSchema,
} from "@affichannel/core/project/project-validation";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../index";
import { observeProjectApplicabilityShadow } from "../services/applicability-shadow-service";
import {
	createProjectRepository as createDatabaseProjectRepository,
	getProjectDetails,
	listProjectItems,
} from "../services/project-repository";
import { requireWorkspaceActor } from "../services/workspace";

function toOrpcError(error: unknown): never {
	if (error instanceof ProjectServiceError) {
		if (error.code === "INVALID_PROJECT_WRITE_IDENTITY") {
			const reasonCode = error.metadata.reasonCode ?? error.code;
			throw new ORPCError("BAD_REQUEST", {
				message: reasonCode,
				data: { code: error.code, reasonCode },
			});
		}

		throw new ORPCError("NOT_FOUND", {
			message: error.message,
			data: { code: error.code },
		});
	}

	throw error;
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

			await observeProjectApplicabilityShadow(actor, project);
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
};
