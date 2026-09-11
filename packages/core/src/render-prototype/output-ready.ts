import { z } from "zod";

export const t09OutputReadySchema = z
	.object({
		schemaVersion: z.literal("t09-output-ready.v1"),
		kind: z.literal("OUTPUT_READY"),
		jobId: z.string().trim().min(1),
		attemptId: z.string().trim().min(1),
		attemptNumber: z.number().int().positive(),
		outputReservationId: z.string().trim().min(1),
	})
	.strict();

export type T09OutputReady = z.infer<typeof t09OutputReadySchema>;
