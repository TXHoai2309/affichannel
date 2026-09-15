import {
	type MediaAssetStorageProvider,
	mediaAssetStorageProviders,
} from "../media/types";

export const QUICK_IMAGE_STATIC_RASTER_ANALYSIS_VERSION = "static-raster-v1";

export const QUICK_IMAGE_ELIGIBILITY_REASONS = [
	"MEDIA_NOT_READY",
	"UNSUPPORTED_MIME",
	"IMAGE_PROOF_MISSING",
	"UNSUPPORTED_ANALYSIS_VERSION",
	"NOT_SINGLE_FRAME",
	"NON_CANONICAL_ORIENTATION",
	"TRANSPARENCY_NOT_ALLOWED",
	"INVALID_MEDIA_METADATA",
] as const;

export type QuickImageEligibilityReason =
	(typeof QUICK_IMAGE_ELIGIBILITY_REASONS)[number];

export type QuickImageEligibilityMediaAsset = Readonly<{
	id: string;
	workspaceId: string;
	status: string;
	archivedAt: Date | null;
	mediaType: string;
	storageProvider: string;
	storageKey: string;
	mimeType: string | null;
	byteSize: number | null;
	checksumSha256: string | null;
	width: number | null;
	height: number | null;
	imageAnalysisVersion: string | null;
	imageFrameCount: number | null;
	imageExifOrientation: number | null;
	imageHasTransparency: boolean | null;
}>;

export type QuickImageSourceAuthority = Readonly<{
	id: string;
	workspaceId: string;
	checksumSha256: string;
	storageProvider: MediaAssetStorageProvider;
	storageKey: string;
	mimeType: "image/jpeg" | "image/png" | "image/webp";
	byteSize: number;
	width: number;
	height: number;
}>;

export type QuickImageEligibilityResult =
	| { kind: "ELIGIBLE"; source: QuickImageSourceAuthority }
	| {
			kind: "INELIGIBLE";
			reasonCode: QuickImageEligibilityReason;
	  };

const QUICK_IMAGE_MIME_TYPES = new Set<string>([
	"image/jpeg",
	"image/png",
	"image/webp",
]);

const QUICK_IMAGE_STORAGE_PROVIDERS = new Set<string>(
	mediaAssetStorageProviders,
);

function hasPositiveSafeInteger(value: number | null): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function evaluateQuickImageEligibility(
	asset: QuickImageEligibilityMediaAsset,
): QuickImageEligibilityResult {
	if (asset.status !== "ready" || asset.archivedAt !== null) {
		return { kind: "INELIGIBLE", reasonCode: "MEDIA_NOT_READY" };
	}

	if (
		asset.mediaType !== "image" ||
		typeof asset.mimeType !== "string" ||
		!QUICK_IMAGE_MIME_TYPES.has(asset.mimeType)
	) {
		return { kind: "INELIGIBLE", reasonCode: "UNSUPPORTED_MIME" };
	}

	const checksumSha256 = asset.checksumSha256;
	const byteSize = asset.byteSize;
	const width = asset.width;
	const height = asset.height;
	if (
		typeof checksumSha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(checksumSha256) ||
		!QUICK_IMAGE_STORAGE_PROVIDERS.has(asset.storageProvider) ||
		typeof asset.storageKey !== "string" ||
		asset.storageKey.trim().length === 0 ||
		!hasPositiveSafeInteger(byteSize) ||
		!hasPositiveSafeInteger(width) ||
		!hasPositiveSafeInteger(height)
	) {
		return { kind: "INELIGIBLE", reasonCode: "INVALID_MEDIA_METADATA" };
	}

	if (
		asset.imageAnalysisVersion === null ||
		asset.imageFrameCount === null ||
		asset.imageExifOrientation === null ||
		asset.imageHasTransparency === null
	) {
		return { kind: "INELIGIBLE", reasonCode: "IMAGE_PROOF_MISSING" };
	}

	if (
		asset.imageAnalysisVersion !== QUICK_IMAGE_STATIC_RASTER_ANALYSIS_VERSION
	) {
		return { kind: "INELIGIBLE", reasonCode: "UNSUPPORTED_ANALYSIS_VERSION" };
	}
	if (asset.imageFrameCount !== 1) {
		return { kind: "INELIGIBLE", reasonCode: "NOT_SINGLE_FRAME" };
	}
	if (asset.imageExifOrientation !== 1) {
		return { kind: "INELIGIBLE", reasonCode: "NON_CANONICAL_ORIENTATION" };
	}
	if (asset.imageHasTransparency) {
		return { kind: "INELIGIBLE", reasonCode: "TRANSPARENCY_NOT_ALLOWED" };
	}

	return {
		kind: "ELIGIBLE",
		source: {
			id: asset.id,
			workspaceId: asset.workspaceId,
			checksumSha256,
			storageProvider: asset.storageProvider as MediaAssetStorageProvider,
			storageKey: asset.storageKey,
			mimeType: asset.mimeType as "image/jpeg" | "image/png" | "image/webp",
			byteSize,
			width,
			height,
		},
	};
}

export type QuickImageCurrentSourceCandidate = Readonly<{
	linkId: string;
	asset: QuickImageEligibilityMediaAsset;
}>;

export type QuickImageCurrentSourceResolution =
	| { status: "MISSING" }
	| {
			status: "READY";
			linkId: string;
			source: QuickImageSourceAuthority;
	  }
	| {
			status: "INELIGIBLE";
			linkId: string;
			mediaAssetId: string;
			reasonCode: QuickImageEligibilityReason;
	  }
	| { status: "CORRUPT_MULTIPLE" };

export function resolveQuickImageCurrentSourceRows(
	rows: readonly QuickImageCurrentSourceCandidate[],
): QuickImageCurrentSourceResolution {
	if (rows.length === 0) return { status: "MISSING" };
	if (rows.length > 1) return { status: "CORRUPT_MULTIPLE" };

	const candidate = rows[0];
	if (!candidate) return { status: "MISSING" };
	const eligibility = evaluateQuickImageEligibility(candidate.asset);
	if (eligibility.kind === "INELIGIBLE") {
		return {
			status: "INELIGIBLE",
			linkId: candidate.linkId,
			mediaAssetId: candidate.asset.id,
			reasonCode: eligibility.reasonCode,
		};
	}

	return {
		status: "READY",
		linkId: candidate.linkId,
		source: eligibility.source,
	};
}
