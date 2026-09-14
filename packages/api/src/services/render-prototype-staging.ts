import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";

const T09_SERVER_OWNED_PATH = Symbol("T09_SERVER_OWNED_PATH");
const T09_SERVER_OWNED_CANONICAL_ROOT = Symbol(
	"T09_SERVER_OWNED_CANONICAL_ROOT",
);
const T09_SERVER_OWNED_CANONICAL_PATH = Symbol(
	"T09_SERVER_OWNED_CANONICAL_PATH",
);

export type T09ServerOwnedStagingPath = Readonly<{
	absolutePath: string;
	rootPath: string;
	readonly [T09_SERVER_OWNED_PATH]: true;
	readonly [T09_SERVER_OWNED_CANONICAL_ROOT]: string;
	readonly [T09_SERVER_OWNED_CANONICAL_PATH]: string;
}>;

export class T09PathAuthorityError extends Error {
	readonly code = "T09_PATH_AUTHORITY_INVALID" as const;
}

function isWithinRoot(rootPath: string, candidatePath: string) {
	const relativePath = relative(rootPath, candidatePath);
	return (
		relativePath === "" ||
		(!relativePath.startsWith(`..${sep}`) &&
			relativePath !== ".." &&
			!isAbsolute(relativePath))
	);
}

function sameWindowsPath(left: string, right: string) {
	return (
		resolve(left)
			.replace(/[\\/]+/gu, "\\")
			.toLowerCase() ===
		resolve(right)
			.replace(/[\\/]+/gu, "\\")
			.toLowerCase()
	);
}

function isMissingPathError(error: unknown) {
	const code =
		error && typeof error === "object" && "code" in error
			? (error as { code?: unknown }).code
			: undefined;
	return code === "ENOENT" || code === "ENOTDIR";
}

function pathChain(rootPath: string, candidatePath: string) {
	const chain = [rootPath];
	const relativePath = relative(rootPath, candidatePath);
	let current = rootPath;
	for (const component of relativePath.split(/[\\/]+/u).filter(Boolean)) {
		current = resolve(current, component);
		chain.push(current);
	}
	return chain;
}

/**
 * Resolves existing filesystem identity while rejecting symlink/junction
 * components. Missing final staging files are allowed, but every existing
 * parent is checked again at each sensitive boundary.
 */
export function assertT09FilesystemPathAuthority(input: {
	absolutePath: string;
	rootPath?: string;
	label: string;
	allowMissingFinal?: boolean;
}) {
	if (!isAbsolute(input.absolutePath))
		throw new T09PathAuthorityError(
			`${input.label} must be an absolute server path.`,
		);
	const absolutePath = resolve(input.absolutePath);
	const rootPath = resolve(input.rootPath ?? parse(absolutePath).root);
	if (!isAbsolute(rootPath) || !isWithinRoot(rootPath, absolutePath))
		throw new T09PathAuthorityError(
			`${input.label} must remain inside its server-owned root.`,
		);
	let canonicalRootPath: string;
	try {
		canonicalRootPath = realpathSync.native(rootPath);
	} catch (error) {
		if (!isMissingPathError(error))
			throw new T09PathAuthorityError(
				`${input.label} parent identity could not be resolved.`,
			);
		canonicalRootPath = rootPath;
	}
	for (const componentPath of pathChain(rootPath, absolutePath)) {
		let stats: ReturnType<typeof lstatSync>;
		try {
			stats = lstatSync(componentPath);
		} catch (error) {
			if (isMissingPathError(error)) break;
			throw new T09PathAuthorityError(
				`${input.label} filesystem identity could not be inspected.`,
			);
		}
		if (stats.isSymbolicLink())
			throw new T09PathAuthorityError(
				`${input.label} contains a symbolic-link or junction reparse point.`,
			);
		let actualPath: string;
		try {
			actualPath = realpathSync.native(componentPath);
		} catch {
			throw new T09PathAuthorityError(
				`${input.label} canonical filesystem identity could not be resolved.`,
			);
		}
		const expectedPath = resolve(
			canonicalRootPath,
			relative(rootPath, componentPath),
		);
		if (!sameWindowsPath(actualPath, expectedPath))
			throw new T09PathAuthorityError(
				`${input.label} canonical path differs from its approved root.`,
			);
	}
	let canonicalPath: string;
	try {
		canonicalPath = realpathSync.native(absolutePath);
	} catch (error) {
		if (!input.allowMissingFinal || !isMissingPathError(error))
			throw new T09PathAuthorityError(
				`${input.label} canonical filesystem identity could not be resolved.`,
			);
		canonicalPath = resolve(
			canonicalRootPath,
			relative(rootPath, absolutePath),
		);
	}
	return { absolutePath, rootPath, canonicalRootPath, canonicalPath } as const;
}

/**
 * Creates an opaque server-owned path token for T09 staging files. The
 * renderer plan accepts this token for drawtext files and output staging; a
 * caller cannot pass an arbitrary public/client path as those boundaries.
 */
export function createT09ServerOwnedStagingPath(input: {
	rootPath: string;
	relativePath: string;
}): T09ServerOwnedStagingPath {
	if (!isAbsolute(input.rootPath))
		throw new Error("T09 staging root must be an absolute server path.");
	const rootPath = resolve(input.rootPath);
	const absolutePath = resolve(rootPath, input.relativePath);
	if (!isWithinRoot(rootPath, absolutePath))
		throw new Error(
			"T09 staging path must remain inside its server-owned root.",
		);
	const authority = assertT09FilesystemPathAuthority({
		absolutePath,
		rootPath,
		label: "T09 staging path",
		allowMissingFinal: true,
	});
	return Object.freeze({
		absolutePath: authority.absolutePath,
		rootPath: authority.rootPath,
		[T09_SERVER_OWNED_PATH]: true as const,
		[T09_SERVER_OWNED_CANONICAL_ROOT]: authority.canonicalRootPath,
		[T09_SERVER_OWNED_CANONICAL_PATH]: authority.canonicalPath,
	});
}

export function assertT09ServerOwnedStagingPath(
	value: T09ServerOwnedStagingPath,
	label: string,
): string {
	if (
		value?.[T09_SERVER_OWNED_PATH] !== true ||
		value?.[T09_SERVER_OWNED_CANONICAL_ROOT] === undefined ||
		value?.[T09_SERVER_OWNED_CANONICAL_PATH] === undefined ||
		!isAbsolute(value.absolutePath) ||
		!isAbsolute(value.rootPath) ||
		!isWithinRoot(resolve(value.rootPath), resolve(value.absolutePath))
	)
		throw new Error(`${label} must be a server-owned T09 staging path.`);
	if (!Object.isFrozen(value))
		throw new Error(`${label} authority must be immutable.`);
	let authority: ReturnType<typeof assertT09FilesystemPathAuthority>;
	try {
		authority = assertT09FilesystemPathAuthority({
			absolutePath: value.absolutePath,
			rootPath: value.rootPath,
			label,
			allowMissingFinal: true,
		});
	} catch {
		throw new Error(`${label} filesystem authority is invalid.`);
	}
	if (
		!sameWindowsPath(
			authority.canonicalRootPath,
			value[T09_SERVER_OWNED_CANONICAL_ROOT],
		) ||
		!sameWindowsPath(
			authority.canonicalPath,
			value[T09_SERVER_OWNED_CANONICAL_PATH],
		)
	)
		throw new Error(`${label} filesystem authority changed after validation.`);
	return value.absolutePath;
}

function safeIdentityPart(value: string, label: string) {
	if (!/^[A-Za-z0-9_-]+$/u.test(value))
		throw new Error(`${label} must be a safe server-generated identity.`);
	return value;
}

/**
 * Derives the one attempt-owned output path from server-generated identities.
 * The path is deliberately not part of OUTPUT_READY, which remains an
 * identity-only handoff to the 21D proof authority.
 */
export function createT09AttemptOutputStagingPath(input: {
	rootPath: string;
	jobId: string;
	attemptId: string;
	attemptNumber: number;
	outputReservationId: string;
}) {
	if (!Number.isSafeInteger(input.attemptNumber) || input.attemptNumber <= 0)
		throw new Error("T09 attempt number must be a positive safe integer.");
	return createT09ServerOwnedStagingPath({
		rootPath: input.rootPath,
		relativePath: [
			"attempts",
			safeIdentityPart(input.jobId, "T09 job ID"),
			safeIdentityPart(input.attemptId, "T09 attempt ID"),
			String(input.attemptNumber),
			safeIdentityPart(input.outputReservationId, "T09 output reservation ID"),
			"output.mp4",
		].join("/"),
	});
}
