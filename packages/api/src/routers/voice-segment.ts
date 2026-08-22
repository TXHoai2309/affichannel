import {
	FactLockError,
	VoiceConfigError,
	VoiceSegmentError,
} from "@affichannel/core";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
	generateVoiceSegment,
	getVoiceSegmentState,
	listVoiceSegmentStates,
} from "../services/voice-segment-runtime-service";
import { getVoiceStepWorkflowEvaluation } from "../services/voice-step-workflow-service";
import { requireWorkspaceActor } from "../services/workspace";

const idSchema = z.string().trim().min(1).max(120);
const projectSchema = z.object({ projectId: idSchema }).strict();
const stateSchema = z
	.object({ projectId: idSchema, segmentKey: idSchema })
	.strict();
const generateSchema = stateSchema
	.extend({ idempotencyKey: z.string().trim().min(8).max(200) })
	.strict();

function toVoiceSegmentOrpcError(error: unknown): never {
	if (error instanceof FactLockError) {
		throw new ORPCError(
			error.code === "FACT_LOCK_NOT_FOUND" ? "NOT_FOUND" : "CONFLICT",
			{ message: error.code, data: { code: error.code, ...error.metadata } },
		);
	}
	if (error instanceof VoiceConfigError) {
		throw new ORPCError(
			error.code === "VOICE_CONFIG_NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST",
			{ message: error.code, data: { code: error.code, ...error.metadata } },
		);
	}
	if (error instanceof VoiceSegmentError) {
		const notFound = error.code === "VOICE_SEGMENT_NOT_FOUND";
		const conflict =
			error.code === "VOICE_SEGMENT_IDEMPOTENCY_CONFLICT" ||
			error.code === "VOICE_SEGMENT_ALREADY_PENDING" ||
			error.code === "VOICE_SEGMENT_CONTEXT_STALE";
		throw new ORPCError(
			notFound ? "NOT_FOUND" : conflict ? "CONFLICT" : "BAD_REQUEST",
			{
				message: error.code,
				data: { code: error.code, ...error.metadata },
			},
		);
	}
	throw error;
}

export const voiceSegmentRouter = {
	list: protectedProcedure
		.input(projectSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await listVoiceSegmentStates(actor, input.projectId);
			} catch (error) {
				return toVoiceSegmentOrpcError(error);
			}
		}),
	getState: protectedProcedure
		.input(stateSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await getVoiceSegmentState(
					actor,
					input.projectId,
					input.segmentKey,
				);
			} catch (error) {
				return toVoiceSegmentOrpcError(error);
			}
		}),
	getSummary: protectedProcedure
		.input(projectSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				const evaluation = await getVoiceStepWorkflowEvaluation(
					actor,
					input.projectId,
				);
				return evaluation?.summary ?? null;
			} catch (error) {
				return toVoiceSegmentOrpcError(error);
			}
		}),
	generate: protectedProcedure
		.input(generateSchema)
		.handler(async ({ context, input }) => {
			const actor = await requireWorkspaceActor(context.session.user.id);
			try {
				return await generateVoiceSegment(actor, input);
			} catch (error) {
				return toVoiceSegmentOrpcError(error);
			}
		}),
};
