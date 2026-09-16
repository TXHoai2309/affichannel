import type { QuickImageRenderPlan } from "@affichannel/core";
import {
	assertT09ServerOwnedStagingPath,
	createT09ServerOwnedStagingPath,
	type T09ServerOwnedStagingPath,
} from "./render-prototype-staging";

const QUICK_IMAGE_SERVER_OWNED_PATH = Symbol("QUICK_IMAGE_SERVER_OWNED_PATH");
const authorities = new WeakMap<object, T09ServerOwnedStagingPath>();

export type QuickImageServerOwnedPath = Readonly<{
	absolutePath: string;
	rootPath: string;
	readonly [QUICK_IMAGE_SERVER_OWNED_PATH]: true;
}>;

/**
 * Creates an opaque Quick Image path token while delegating filesystem
 * identity checks to the accepted server-owned staging authority. This does
 * not create a file or read persistent media.
 */
export function createQuickImageServerOwnedPath(input: {
	rootPath: string;
	relativePath: string;
}): QuickImageServerOwnedPath {
	const authority = createT09ServerOwnedStagingPath(input);
	const token = Object.freeze({
		absolutePath: authority.absolutePath,
		rootPath: authority.rootPath,
		[QUICK_IMAGE_SERVER_OWNED_PATH]: true as const,
	});
	authorities.set(token, authority);
	return token;
}

export function assertQuickImageServerOwnedPath(
	value: QuickImageServerOwnedPath,
	label: string,
): string {
	const authority = authorities.get(value as object);
	if (
		!authority ||
		value?.[QUICK_IMAGE_SERVER_OWNED_PATH] !== true ||
		!Object.isFrozen(value) ||
		value.absolutePath !== authority.absolutePath ||
		value.rootPath !== authority.rootPath
	)
		throw new Error(`${label} must be an immutable server-owned path.`);
	assertT09ServerOwnedStagingPath(authority, label);
	return authority.absolutePath;
}

export const QUICK_IMAGE_MATERIALIZATION_SCHEMA_VERSION =
	"quick-image-materialization.v1" as const;

export type QuickImageSourceMaterializationSpec = Readonly<{
	schemaVersion: typeof QUICK_IMAGE_MATERIALIZATION_SCHEMA_VERSION;
	kind: "QUICK_IMAGE";
	destination: QuickImageServerOwnedPath;
	mediaAssetId: string;
	storageProvider: "local" | "r2";
	storageKey: string;
	mimeType: "image/jpeg" | "image/png" | "image/webp";
	byteSize: number;
	checksumSha256: string;
	width: number;
	height: number;
}>;

/**
 * Describes one exact frozen source materialization. The actual storage GET
 * belongs to D2 and is intentionally absent from this D1 contract.
 */
export function createQuickImageSourceMaterializationSpec(input: {
	plan: QuickImageRenderPlan;
	destination: QuickImageServerOwnedPath;
}): QuickImageSourceMaterializationSpec {
	assertQuickImageServerOwnedPath(input.destination, "Quick Image source");
	const source = input.plan.source;
	return Object.freeze({
		schemaVersion: QUICK_IMAGE_MATERIALIZATION_SCHEMA_VERSION,
		kind: "QUICK_IMAGE" as const,
		destination: input.destination,
		mediaAssetId: source.mediaAssetId,
		storageProvider: source.storageProvider,
		storageKey: source.storageKey,
		mimeType: source.mimeType,
		byteSize: source.byteSize,
		checksumSha256: source.checksumSha256,
		width: source.width,
		height: source.height,
	});
}

export type QuickImageSourceMaterializer = (
	spec: QuickImageSourceMaterializationSpec,
) => Promise<void>;
