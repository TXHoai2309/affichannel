import { z } from "zod";
import {
	analyticsMetricFamilySchema,
	analyticsSourceTypeSchema,
} from "./types";
import {
	analyticsColumnMappingSchema,
	analyticsFixedMappingSchema,
} from "./validation";

export const analyticsImportMappingSchema = z
	.object({
		columns: analyticsColumnMappingSchema,
		fixed: analyticsFixedMappingSchema.optional(),
	})
	.strict();

export const analyticsPreviewInputSchema = z
	.object({
		fileName: z.string().trim().min(1).max(255),
		fileBase64: z.string().min(1).max(7_500_000),
		sourceType: analyticsSourceTypeSchema,
		sourceIdentity: z.string().trim().max(160).optional(),
		mapping: analyticsImportMappingSchema.optional(),
	})
	.strict();

export const analyticsFinalizeInputSchema = z
	.object({
		fileName: z.string().trim().min(1).max(255),
		fileBase64: z.string().min(1).max(7_500_000),
		sourceType: analyticsSourceTypeSchema,
		sourceIdentity: z.string().trim().max(160).optional(),
		mapping: analyticsImportMappingSchema,
		previewFileSha256: z.string().regex(/^[a-f0-9]{64}$/),
		previewMappingFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
		idempotencyKey: z.string().trim().min(8).max(200),
	})
	.strict();

export const analyticsReadModelFilterSchema = z
	.object({
		startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		metricFamily: analyticsMetricFamilySchema.optional(),
		sourceType: analyticsSourceTypeSchema.optional(),
		sourceIdentity: z.string().trim().max(160).optional(),
		contentType: z.enum(["ORGANIC", "AFFILIATE"]).optional(),
		pillarId: z.string().trim().max(200).optional(),
		seriesId: z.string().trim().max(200).optional(),
		contentFormatKey: z.string().trim().max(120).optional(),
		creationPath: z.enum(["QUICK_IMAGE", "SCRIPTED", "MEDIA_FIRST"]).optional(),
		productId: z.string().trim().max(200).optional(),
	})
	.strict();
