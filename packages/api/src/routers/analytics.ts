import {
	analyticsFinalizeInputSchema,
	analyticsPreviewInputSchema,
	analyticsReadModelFilterSchema,
} from "@affichannel/core";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../index";
import {
	AnalyticsImportError,
	finalizeAnalyticsImport,
	getAnalyticsReadModel,
	listAnalyticsImports,
	previewAnalyticsImport,
} from "../services/analytics-service";
import { requireWorkspaceActor } from "../services/workspace";

function toAnalyticsError(error: unknown): never {
	if (!(error instanceof AnalyticsImportError)) throw error;
	const badRequestCodes = new Set([
		"ANALYTICS_FILENAME_INVALID",
		"ANALYTICS_FILE_TYPE_MISMATCH",
		"ANALYTICS_FILE_ENCODING_INVALID",
		"ANALYTICS_FILE_EMPTY",
		"ANALYTICS_FILE_SIZE_LIMIT_EXCEEDED",
		"ANALYTICS_CSV_ENCODING_INVALID",
		"ANALYTICS_CSV_MALFORMED",
		"ANALYTICS_XLSX_MALFORMED",
		"ANALYTICS_FORMULA_UNSUPPORTED",
		"ANALYTICS_SHEET_LIMIT_EXCEEDED",
		"ANALYTICS_ROW_LIMIT_EXCEEDED",
		"ANALYTICS_COLUMN_LIMIT_EXCEEDED",
		"ANALYTICS_CELL_TOO_LARGE",
		"ANALYTICS_HEADER_INVALID",
		"ANALYTICS_DUPLICATE_HEADERS",
		"ANALYTICS_MAPPING_INVALID",
		"METRIC_FAMILY_INVALID",
		"METRIC_KEY_INVALID",
		"METRIC_UNIT_INVALID",
		"METRIC_VALUE_INVALID",
		"RECORDED_DATE_INVALID",
		"CONTENT_ATTRIBUTION_UNMAPPED",
		"CONTENT_ATTRIBUTION_CONFLICT",
		"PRODUCT_ATTRIBUTION_UNMAPPED",
		"PRODUCT_ATTRIBUTION_CONFLICT",
		"CONTENT_TYPE_INVALID",
		"CONTENT_TYPE_CONFLICT",
		"CREATION_PATH_INVALID",
		"CONTENT_FORMAT_INVALID",
		"PILLAR_UNMAPPED",
		"SERIES_UNMAPPED",
		"PILLAR_ATTRIBUTION_CONFLICT",
		"SERIES_ATTRIBUTION_CONFLICT",
		"COST_USAGE_UNAVAILABLE",
		"ANALYTICS_IMPORT_VALIDATION_FAILED",
	]);
	if (badRequestCodes.has(error.code)) {
		throw new ORPCError("BAD_REQUEST", {
			message: error.code,
			data: error.details,
		});
	}
	if (error.code === "ANALYTICS_PREVIEW_STALE") {
		throw new ORPCError("CONFLICT", {
			message: error.code,
			data: error.details,
		});
	}
	if (error.code === "ANALYTICS_IDEMPOTENCY_CONFLICT") {
		throw new ORPCError("CONFLICT", {
			message: error.code,
			data: error.details,
		});
	}
	throw new ORPCError("BAD_REQUEST", { message: "ANALYTICS_IMPORT_FAILED" });
}

export const analyticsRouter = {
	previewImport: protectedProcedure
		.input(analyticsPreviewInputSchema)
		.handler(async ({ context, input }) => {
			try {
				return await previewAnalyticsImport(
					await requireWorkspaceActor(context.session.user.id),
					input,
				);
			} catch (error) {
				return toAnalyticsError(error);
			}
		}),
	finalizeImport: protectedProcedure
		.input(analyticsFinalizeInputSchema)
		.handler(async ({ context, input }) => {
			try {
				return await finalizeAnalyticsImport(
					await requireWorkspaceActor(context.session.user.id),
					input,
				);
			} catch (error) {
				return toAnalyticsError(error);
			}
		}),
	listImports: protectedProcedure.handler(async ({ context }) =>
		listAnalyticsImports(await requireWorkspaceActor(context.session.user.id)),
	),
	getReadModel: protectedProcedure
		.input(analyticsReadModelFilterSchema.optional())
		.handler(async ({ context, input }) =>
			getAnalyticsReadModel(
				await requireWorkspaceActor(context.session.user.id),
				input,
			),
		),
};
