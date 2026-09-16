import type {
	QuickImageDurationSeconds,
	QuickImageMotion,
} from "../quick-image";

export type CompositionPreviewDescriptorV2 = Readonly<{
	schemaVersion: "composition-preview-descriptor.v2";
	access: "protected";
	compositionVersionId: string;
	compositionFingerprint: string;
	sourceKind: "QUICK_IMAGE";
	profile: Readonly<{
		id: "vertical-standard-v1";
		logicalWidth: 1080;
		logicalHeight: 1920;
		aspectRatio: "9:16";
	}>;
	timeline: Readonly<{
		durationSeconds: QuickImageDurationSeconds;
		fps: Readonly<{ numerator: 30; denominator: 1 }>;
		totalFrames: 150 | 300 | 450;
	}>;
	motion: QuickImageMotion;
	source: Readonly<{
		width: number;
		height: number;
		mimeType: "image/jpeg" | "image/png" | "image/webp";
	}>;
	dependency: Readonly<{
		dependencyKey: string;
		token: string;
		contentType: "image/jpeg" | "image/png" | "image/webp";
		byteSize: number;
		checksum: string;
		expiresAt: string;
	}>;
}>;
