import {
	calendarLocalDateSchema,
	calendarLocalTimeSchema,
	plannedContentItemSemanticSchema,
} from "@affichannel/core";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
	PlannedContentItemError,
	plannedContentItemRepository,
} from "../services/planned-content-repository";
import { requireWorkspaceActor } from "../services/workspace";

const calendarDateSchema = calendarLocalDateSchema;

const calendarQuerySchema = z
	.object({ startDate: calendarDateSchema.optional() })
	.strict();

const generateSchema = calendarQuerySchema.extend({
	expectedStrategyVersion: z.number().int().positive().optional(),
});

const itemIdSchema = z.object({ id: z.string().uuid() }).strict();

const createItemSchema = plannedContentItemSemanticSchema;

const updateItemSchema = z.intersection(
	z
		.object({
			id: z.string().uuid(),
			expectedVersion: z.number().int().positive(),
		})
		.strict(),
	plannedContentItemSemanticSchema,
);

const moveItemSchema = z
	.object({
		id: z.string().uuid(),
		scheduledDate: calendarDateSchema,
		scheduledTime: calendarLocalTimeSchema,
		expectedVersion: z.number().int().positive(),
	})
	.strict();

const convertItemSchema = z
	.object({
		id: z.string().uuid(),
		expectedVersion: z.number().int().positive(),
	})
	.strict();

const attachProductSchema = z
	.object({
		id: z.string().uuid(),
		productId: z.string().uuid().nullable(),
		expectedVersion: z.number().int().positive(),
	})
	.strict();

function toOrpcError(error: unknown): never {
	if (!(error instanceof PlannedContentItemError)) throw error;
	if (error.code === "PLANNED_CONTENT_ITEM_NOT_FOUND") {
		throw new ORPCError("NOT_FOUND", { message: error.code });
	}
	if (
		error.code === "PLANNED_CONTENT_ITEM_VERSION_CONFLICT" ||
		error.code === "PLANNED_CONTENT_ITEM_STRATEGY_VERSION_CONFLICT"
	) {
		throw new ORPCError("CONFLICT", { message: error.code });
	}
	throw new ORPCError("BAD_REQUEST", { message: error.code });
}

export const contentCalendarRouter = {
	get7DayPlan: protectedProcedure
		.input(calendarQuerySchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			return plannedContentItemRepository.getCalendar(actor, input.startDate);
		}),
	generatePlan: protectedProcedure
		.input(generateSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await plannedContentItemRepository.generate(
					actor,
					input.startDate,
					input.expectedStrategyVersion,
				);
			} catch (error) {
				return toOrpcError(error);
			}
		}),
	createItem: protectedProcedure
		.input(createItemSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await plannedContentItemRepository.create(actor, input);
			} catch (error) {
				return toOrpcError(error);
			}
		}),
	updateItem: protectedProcedure
		.input(updateItemSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				const { id, expectedVersion, ...semantic } = input;
				return await plannedContentItemRepository.update(
					actor,
					id,
					semantic,
					expectedVersion,
				);
			} catch (error) {
				return toOrpcError(error);
			}
		}),
	moveItem: protectedProcedure
		.input(moveItemSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await plannedContentItemRepository.move(
					actor,
					input.id,
					input.scheduledDate,
					input.scheduledTime,
					input.expectedVersion,
				);
			} catch (error) {
				return toOrpcError(error);
			}
		}),
	attachProduct: protectedProcedure
		.input(attachProductSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await plannedContentItemRepository.attachProduct(
					actor,
					input.id,
					input.productId,
					input.expectedVersion,
				);
			} catch (error) {
				return toOrpcError(error);
			}
		}),
	convertToProject: protectedProcedure
		.input(convertItemSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await plannedContentItemRepository.convert(
					actor,
					input.id,
					input.expectedVersion,
				);
			} catch (error) {
				return toOrpcError(error);
			}
		}),
	getItem: protectedProcedure
		.input(itemIdSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			const calendar = await plannedContentItemRepository.getCalendar(actor);
			const item = calendar.items.find(
				(candidate) => candidate.id === input.id,
			);
			if (!item) throw new ORPCError("NOT_FOUND");
			return item;
		}),
};
