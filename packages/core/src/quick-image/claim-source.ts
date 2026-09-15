import { z } from "zod";

import {
	canonicalClaimSourceText,
	sha256Hex,
} from "../claim-manifest/canonicalization";
import { canonicalizeJson } from "../script-generation/canonical-json";

export const QUICK_IMAGE_CLAIM_SOURCE_SCHEMA_VERSION =
	"quick-image-claim-source.v1" as const;

export const quickImageClaimSourceElementKinds = [
	"DECLARED_CLAIM",
	"OVERLAY",
	"CAPTION",
	"CTA",
	"COMPOSITION_ELEMENT",
] as const;

export type QuickImageClaimSourceElementKind =
	(typeof quickImageClaimSourceElementKinds)[number];

const idSchema = z.string().trim().min(1).max(120);

export const quickImageClaimSourceElementSchema = z
	.object({
		id: idSchema,
		kind: z.enum(quickImageClaimSourceElementKinds),
		text: z.string().max(4_000),
	})
	.strict();

export const quickImageClaimSourceDocumentSchema = z
	.object({
		version: z.literal(QUICK_IMAGE_CLAIM_SOURCE_SCHEMA_VERSION),
		elements: z.array(quickImageClaimSourceElementSchema).max(64),
	})
	.strict();

export type QuickImageClaimSourceElement = Readonly<
	z.infer<typeof quickImageClaimSourceElementSchema>
>;

export type QuickImageClaimSourceDocument = Readonly<
	z.infer<typeof quickImageClaimSourceDocumentSchema>
>;

export type QuickImageClaimSourceAuthority = Readonly<{
	id: string;
	workspaceId: string;
	projectId: string;
	revision: number;
	sourceSchemaVersion: typeof QUICK_IMAGE_CLAIM_SOURCE_SCHEMA_VERSION;
	document: QuickImageClaimSourceDocument;
	sourceContentHashSha256: string;
	createdAt: Date;
	updatedAt: Date;
}>;

/** Explicit UTF-16 code-unit ordering; never depend on machine locale/ICU. */
function compareCanonicalIds(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

function compareElements(
	left: QuickImageClaimSourceElement,
	right: QuickImageClaimSourceElement,
) {
	return compareCanonicalIds(left.id, right.id);
}

function freeze<T>(value: T): Readonly<T> {
	if (!value || typeof value !== "object" || Object.isFrozen(value))
		return value;
	for (const child of Object.values(value)) freeze(child);
	return Object.freeze(value);
}

/**
 * Returns the single canonical representation used for equality, persistence,
 * and hashing. Element order is semantic-independent and therefore sorted by
 * stable element identity; text uses the repository's existing claim-source
 * normalization convention.
 */
export function canonicalizeQuickImageClaimSourceDocument(
	raw: unknown,
): QuickImageClaimSourceDocument {
	const parsed = quickImageClaimSourceDocumentSchema.parse(raw);
	const elements = parsed.elements.map((element) => ({
		id: element.id.trim(),
		kind: element.kind,
		text: canonicalClaimSourceText(element.text),
	}));
	const ids = new Set<string>();
	for (const element of elements) {
		if (ids.has(element.id))
			throw new Error("QUICK_IMAGE_CLAIM_SOURCE_DUPLICATE_ELEMENT_ID");
		ids.add(element.id);
	}
	return freeze({
		version: QUICK_IMAGE_CLAIM_SOURCE_SCHEMA_VERSION,
		elements: elements.sort(compareElements),
	});
}

export function canonicalQuickImageClaimSourceJson(
	document: QuickImageClaimSourceDocument,
): string {
	return canonicalizeJson(canonicalizeQuickImageClaimSourceDocument(document));
}

export async function quickImageClaimSourceContentHash(
	document: QuickImageClaimSourceDocument,
): Promise<string> {
	return sha256Hex(canonicalQuickImageClaimSourceJson(document));
}

export async function quickImageClaimSourceElementContentHash(
	element: QuickImageClaimSourceElement,
): Promise<string> {
	return sha256Hex({
		id: element.id,
		kind: element.kind,
		text: canonicalClaimSourceText(element.text),
	});
}

export function isQuickImageClaimSourceDocument(
	value: unknown,
): value is QuickImageClaimSourceDocument {
	return quickImageClaimSourceDocumentSchema.safeParse(value).success;
}
