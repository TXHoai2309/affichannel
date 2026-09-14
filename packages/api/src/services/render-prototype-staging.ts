import { isAbsolute, relative, resolve, sep } from "node:path";

const T09_SERVER_OWNED_PATH = Symbol("T09_SERVER_OWNED_PATH");

export type T09ServerOwnedStagingPath = Readonly<{
	absolutePath: string;
	rootPath: string;
	readonly [T09_SERVER_OWNED_PATH]: true;
}>;

function isWithinRoot(rootPath: string, candidatePath: string) {
	const relativePath = relative(rootPath, candidatePath);
	return (
		relativePath === "" ||
		(!relativePath.startsWith(`..${sep}`) &&
			relativePath !== ".." &&
			!isAbsolute(relativePath))
	);
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
	const path = {
		absolutePath,
		rootPath,
		[T09_SERVER_OWNED_PATH]: true as const,
	};
	return path;
}

export function assertT09ServerOwnedStagingPath(
	value: T09ServerOwnedStagingPath,
	label: string,
): string {
	if (
		value?.[T09_SERVER_OWNED_PATH] !== true ||
		!isAbsolute(value.absolutePath) ||
		!isAbsolute(value.rootPath) ||
		!isWithinRoot(resolve(value.rootPath), resolve(value.absolutePath))
	)
		throw new Error(`${label} must be a server-owned T09 staging path.`);
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
