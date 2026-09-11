import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, open, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";

export type RenderOutputStorageProvider = "local" | "r2";

export type RenderOutputBody =
	| ReadableStream<Uint8Array>
	| AsyncIterable<Uint8Array>;

export type RenderOutputObjectProof = Readonly<{
	provider: RenderOutputStorageProvider;
	storageKey: string;
	contentType: "video/mp4";
	byteSize: number;
	checksumSha256: string;
}>;

export type RenderOutputObjectStat = Readonly<{
	byteSize: number;
	contentType: string | null;
	etag: string | null;
	checksumSha256: string | null;
}>;

export type RenderOutputRange = Readonly<{
	start: number;
	end: number;
	stream: ReadableStream<Uint8Array>;
	byteSize: number;
	contentType: "video/mp4";
}>;

export class RenderOutputStorageError extends Error {
	readonly code:
		| "RENDER_OUTPUT_STORAGE_ERROR"
		| "RENDER_OUTPUT_STORAGE_NOT_FOUND"
		| "RENDER_OUTPUT_STORAGE_CONFLICT"
		| "RENDER_OUTPUT_STORAGE_CONDITIONAL_CREATE_UNSUPPORTED"
		| "RENDER_OUTPUT_STORAGE_INVALID_KEY";
	readonly unknownOutcome: boolean;

	constructor(
		code: RenderOutputStorageError["code"],
		message: string = code,
		options: { unknownOutcome?: boolean } = {},
	) {
		super(message);
		this.name = "RenderOutputStorageError";
		this.code = code;
		this.unknownOutcome = options.unknownOutcome ?? false;
	}
}

export interface RenderOutputStorage {
	readonly provider: RenderOutputStorageProvider;
	createOnce(input: { storageKey: string; body: RenderOutputBody }): Promise<{
		kind: "CREATED" | "ALREADY_EXISTS";
		proof: RenderOutputObjectProof;
	}>;
	head(storageKey: string): Promise<RenderOutputObjectStat | null>;
	verifyExact(input: {
		storageKey: string;
		byteSize: number;
		checksumSha256: string;
	}): Promise<RenderOutputObjectProof>;
	open(storageKey: string): Promise<ReadableStream<Uint8Array>>;
	openRange(input: {
		storageKey: string;
		start: number;
		end: number;
	}): Promise<RenderOutputRange>;
	deleteProvenOrphan(input: {
		storageKey: string;
		byteSize: number;
		checksumSha256: string;
	}): Promise<void>;
}

function assertSafeRenderOutputStorageKey(storageKey: string) {
	const parts = storageKey.split("/");
	if (
		parts.length !== 7 ||
		parts[0] !== "render-artifacts" ||
		parts[1] !== "v1" ||
		parts[6] === undefined ||
		!parts[6].endsWith(".mp4") ||
		parts.slice(2, 6).some((part) => !/^[A-Za-z0-9_-]+$/u.test(part)) ||
		!/^[A-Za-z0-9_-]+\.mp4$/u.test(parts[6])
	) {
		throw new RenderOutputStorageError(
			"RENDER_OUTPUT_STORAGE_INVALID_KEY",
			"Render output storage key is not a server-owned render key.",
		);
	}
}

function storageFailure(
	message: string,
	cause?: unknown,
	options: { unknownOutcome?: boolean } = {},
) {
	void cause;
	return new RenderOutputStorageError(
		"RENDER_OUTPUT_STORAGE_ERROR",
		message,
		options,
	);
}

function notFound(message: string) {
	return new RenderOutputStorageError(
		"RENDER_OUTPUT_STORAGE_NOT_FOUND",
		message,
	);
}

function conflict(message: string) {
	return new RenderOutputStorageError(
		"RENDER_OUTPUT_STORAGE_CONFLICT",
		message,
	);
}

function isNotFoundError(error: unknown) {
	if (!error || typeof error !== "object") return false;
	const value = error as {
		name?: unknown;
		code?: unknown;
		status?: unknown;
		statusCode?: unknown;
		$metadata?: { httpStatusCode?: unknown };
	};
	return (
		[value.name, value.code].some((item) =>
			["NotFound", "NoSuchKey"].includes(String(item)),
		) ||
		[value.status, value.statusCode, value.$metadata?.httpStatusCode].some(
			(item) => item === 404 || item === "404",
		)
	);
}

function isPreconditionFailedError(error: unknown) {
	if (!error || typeof error !== "object") return false;
	const value = error as {
		name?: unknown;
		code?: unknown;
		status?: unknown;
		statusCode?: unknown;
		$metadata?: { httpStatusCode?: unknown };
	};
	return (
		[value.name, value.code].some((item) =>
			["PreconditionFailed", "ConditionalRequestConflict"].includes(
				String(item),
			),
		) ||
		[value.status, value.statusCode, value.$metadata?.httpStatusCode].some(
			(item) => item === 412 || item === "412",
		)
	);
}

async function* chunksFromBody(body: RenderOutputBody) {
	if (Symbol.asyncIterator in Object(body)) {
		for await (const chunk of body as AsyncIterable<Uint8Array>) {
			if (chunk.byteLength > 0) yield chunk;
		}
		return;
	}
	const reader = (body as ReadableStream<Uint8Array>).getReader();
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			if (next.value?.byteLength) yield next.value;
		}
	} finally {
		reader.releaseLock();
	}
}

async function* fileChunks(path: string) {
	const stream = createReadStream(path);
	for await (const chunk of stream) yield new Uint8Array(chunk);
}

async function writeAll(
	handle: Awaited<ReturnType<typeof open>>,
	chunk: Uint8Array,
) {
	let offset = 0;
	while (offset < chunk.byteLength) {
		const result = await handle.write(chunk, offset, chunk.byteLength - offset);
		offset += result.bytesWritten;
	}
}

async function spoolBody(body: RenderOutputBody, targetPath: string) {
	const handle = await open(targetPath, "wx");
	const hash = createHash("sha256");
	let byteSize = 0;
	try {
		for await (const chunk of chunksFromBody(body)) {
			hash.update(chunk);
			byteSize += chunk.byteLength;
			await writeAll(handle, chunk);
		}
		if (byteSize <= 0) throw new Error("RENDER_OUTPUT_EMPTY");
		await handle.sync();
		return { byteSize, checksumSha256: hash.digest("hex") };
	} finally {
		await handle.close().catch(() => undefined);
	}
}

async function digestBody(body: RenderOutputBody) {
	const hash = createHash("sha256");
	let byteSize = 0;
	for await (const chunk of chunksFromBody(body)) {
		hash.update(chunk);
		byteSize += chunk.byteLength;
	}
	return { byteSize, checksumSha256: hash.digest("hex") };
}

function streamFromNode(stream: NodeJS.ReadableStream) {
	return Readable.toWeb(
		stream as Parameters<typeof Readable.toWeb>[0],
	) as unknown as ReadableStream<Uint8Array>;
}

async function ensureNoSymlinkParents(rootDir: string, storageKey: string) {
	await mkdir(rootDir, { recursive: true });
	const rootStat = await lstat(rootDir);
	if (rootStat.isSymbolicLink())
		throw new RenderOutputStorageError(
			"RENDER_OUTPUT_STORAGE_INVALID_KEY",
			"Render output root cannot be a symlink.",
		);
	let current = rootDir;
	for (const part of storageKey.split("/").slice(0, -1)) {
		current = resolve(current, part);
		try {
			const currentStat = await lstat(current);
			if (currentStat.isSymbolicLink())
				throw new RenderOutputStorageError(
					"RENDER_OUTPUT_STORAGE_INVALID_KEY",
					"Render output path contains a symlink.",
				);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			break;
		}
	}
}

export function createRenderOutputStorageKey(input: {
	workspaceId: string;
	projectId: string;
	renderJobId: string;
	renderAttemptId: string;
	outputReservationId: string;
}) {
	const key = `render-artifacts/v1/${input.workspaceId}/${input.projectId}/${input.renderJobId}/${input.renderAttemptId}/${input.outputReservationId}.mp4`;
	assertSafeRenderOutputStorageKey(key);
	return key;
}

abstract class BaseRenderOutputStorage implements RenderOutputStorage {
	abstract readonly provider: RenderOutputStorageProvider;
	abstract createOnce(input: {
		storageKey: string;
		body: RenderOutputBody;
	}): Promise<{
		kind: "CREATED" | "ALREADY_EXISTS";
		proof: RenderOutputObjectProof;
	}>;
	abstract head(storageKey: string): Promise<RenderOutputObjectStat | null>;
	abstract open(storageKey: string): Promise<ReadableStream<Uint8Array>>;
	abstract openRange(input: {
		storageKey: string;
		start: number;
		end: number;
	}): Promise<RenderOutputRange>;
	abstract deleteProvenOrphan(input: {
		storageKey: string;
		byteSize: number;
		checksumSha256: string;
	}): Promise<void>;

	async verifyExact(input: {
		storageKey: string;
		byteSize: number;
		checksumSha256: string;
	}) {
		const stream = await this.open(input.storageKey);
		const actual = await digestBody(stream);
		if (
			actual.byteSize !== input.byteSize ||
			actual.checksumSha256 !== input.checksumSha256
		)
			throw conflict("Stored render output proof does not match the object.");
		return {
			provider: this.provider,
			storageKey: input.storageKey,
			contentType: "video/mp4" as const,
			byteSize: actual.byteSize,
			checksumSha256: actual.checksumSha256,
		};
	}
}

export class LocalRenderOutputStorage extends BaseRenderOutputStorage {
	readonly provider = "local" as const;
	private readonly rootDir: string;

	constructor(options: { rootDir: string }) {
		super();
		this.rootDir = resolve(options.rootDir);
	}

	private pathFor(storageKey: string) {
		assertSafeRenderOutputStorageKey(storageKey);
		const candidate = resolve(this.rootDir, ...storageKey.split("/"));
		if (
			candidate !== this.rootDir &&
			!candidate.startsWith(`${this.rootDir}${sep}`)
		)
			throw new RenderOutputStorageError(
				"RENDER_OUTPUT_STORAGE_INVALID_KEY",
				"Render output path escapes its configured root.",
			);
		return candidate;
	}

	private async inspectExisting(
		storageKey: string,
		expected: { byteSize: number; checksumSha256: string },
	): Promise<RenderOutputObjectProof | null> {
		const existing = await this.head(storageKey);
		if (!existing) return null;
		try {
			return await this.verifyExact({ storageKey, ...expected });
		} catch (error) {
			if (
				error instanceof RenderOutputStorageError &&
				error.code === "RENDER_OUTPUT_STORAGE_CONFLICT"
			)
				throw conflict("An existing render object has different bytes.");
			throw error;
		}
	}

	async createOnce(input: { storageKey: string; body: RenderOutputBody }) {
		const targetPath = this.pathFor(input.storageKey);
		const tempPath = `${targetPath}.${randomUUID()}.tmp`;
		try {
			await ensureNoSymlinkParents(this.rootDir, input.storageKey);
			await mkdir(dirname(targetPath), { recursive: true });
			const expected = await spoolBody(input.body, tempPath);
			const existing = await this.inspectExisting(input.storageKey, expected);
			if (existing) return { kind: "ALREADY_EXISTS" as const, proof: existing };
			try {
				await copyFile(tempPath, targetPath, constants.COPYFILE_EXCL);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				const raced = await this.inspectExisting(input.storageKey, expected);
				if (!raced)
					throw storageFailure(
						"Render output publication race was unresolved.",
					);
				return { kind: "ALREADY_EXISTS" as const, proof: raced };
			}
			const proof = await this.verifyExact({
				storageKey: input.storageKey,
				...expected,
			});
			return { kind: "CREATED" as const, proof };
		} catch (error) {
			if (error instanceof RenderOutputStorageError) throw error;
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				throw notFound("Render output path was not found.");
			throw storageFailure("Could not persist local render output.", error);
		} finally {
			await rm(tempPath, { force: true }).catch(() => undefined);
		}
	}

	async head(storageKey: string) {
		const path = this.pathFor(storageKey);
		try {
			const result = await stat(path);
			return {
				byteSize: result.size,
				contentType: "video/mp4" as const,
				etag: null,
				checksumSha256: null,
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw storageFailure("Could not inspect local render output.", error);
		}
	}

	async open(storageKey: string) {
		const path = this.pathFor(storageKey);
		try {
			await stat(path);
			return streamFromNode(createReadStream(path));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				throw notFound("Local render output was not found.");
			throw storageFailure("Could not open local render output.", error);
		}
	}

	async openRange(input: { storageKey: string; start: number; end: number }) {
		const path = this.pathFor(input.storageKey);
		try {
			const result = await stat(path);
			if (
				input.start < 0 ||
				input.end < input.start ||
				input.end >= result.size
			)
				throw new RenderOutputStorageError(
					"RENDER_OUTPUT_STORAGE_ERROR",
					"Requested render output range is invalid.",
				);
			return {
				start: input.start,
				end: input.end,
				stream: streamFromNode(
					createReadStream(path, { start: input.start, end: input.end }),
				),
				byteSize: input.end - input.start + 1,
				contentType: "video/mp4" as const,
			};
		} catch (error) {
			if (error instanceof RenderOutputStorageError) throw error;
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				throw notFound("Local render output was not found.");
			throw storageFailure("Could not open local render output range.", error);
		}
	}

	async deleteProvenOrphan(input: {
		storageKey: string;
		byteSize: number;
		checksumSha256: string;
	}) {
		await this.verifyExact(input);
		try {
			await rm(this.pathFor(input.storageKey), { force: false });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw storageFailure(
				"Could not delete proven local render orphan.",
				error,
			);
		}
	}
}

export type R2RenderOutputObjectClient = {
	putObject(input: {
		key: string;
		body: AsyncIterable<Uint8Array>;
		contentType: "video/mp4";
		byteSize: number;
		checksumSha256: string;
	}): Promise<void>;
	headObject(key: string): Promise<RenderOutputObjectStat | null>;
	getObject(
		key: string,
		range?: { start: number; end: number },
	): Promise<{
		stream: ReadableStream<Uint8Array>;
		byteSize: number;
		contentType: "video/mp4";
	} | null>;
	deleteObject(key: string): Promise<void>;
};

export class R2RenderOutputStorage extends BaseRenderOutputStorage {
	readonly provider = "r2" as const;
	private readonly tempRoot: string;

	constructor(
		private readonly client: R2RenderOutputObjectClient,
		options: { tempRoot: string },
	) {
		super();
		this.tempRoot = resolve(options.tempRoot);
	}

	async createOnce(input: { storageKey: string; body: RenderOutputBody }) {
		assertSafeRenderOutputStorageKey(input.storageKey);
		const tempDirectory = resolve(this.tempRoot, ".staging");
		const tempPath = resolve(tempDirectory, `${randomUUID()}.tmp`);
		try {
			await mkdir(tempDirectory, { recursive: true });
			const expected = await spoolBody(input.body, tempPath);
			try {
				await this.client.putObject({
					key: input.storageKey,
					body: fileChunks(tempPath),
					contentType: "video/mp4",
					byteSize: expected.byteSize,
					checksumSha256: expected.checksumSha256,
				});
			} catch (error) {
				if (!isPreconditionFailedError(error)) {
					throw storageFailure(
						"R2 conditional render output creation failed.",
						error,
						{ unknownOutcome: true },
					);
				}
				const existing = await this.verifyExact({
					storageKey: input.storageKey,
					...expected,
				});
				return { kind: "ALREADY_EXISTS" as const, proof: existing };
			}
			const proof = await this.verifyExact({
				storageKey: input.storageKey,
				...expected,
			});
			return { kind: "CREATED" as const, proof };
		} finally {
			await rm(tempPath, { force: true }).catch(() => undefined);
		}
	}

	async head(storageKey: string) {
		assertSafeRenderOutputStorageKey(storageKey);
		try {
			return await this.client.headObject(storageKey);
		} catch (error) {
			if (isNotFoundError(error)) return null;
			throw storageFailure("Could not inspect R2 render output.", error);
		}
	}

	async open(storageKey: string) {
		assertSafeRenderOutputStorageKey(storageKey);
		const result = await this.client.getObject(storageKey);
		if (!result) throw notFound("R2 render output was not found.");
		return result.stream;
	}

	async openRange(input: { storageKey: string; start: number; end: number }) {
		assertSafeRenderOutputStorageKey(input.storageKey);
		const result = await this.client.getObject(input.storageKey, input);
		if (!result) throw notFound("R2 render output was not found.");
		return {
			start: input.start,
			end: input.end,
			stream: result.stream,
			byteSize: result.byteSize,
			contentType: result.contentType,
		};
	}

	async deleteProvenOrphan(input: {
		storageKey: string;
		byteSize: number;
		checksumSha256: string;
	}) {
		await this.verifyExact(input);
		try {
			await this.client.deleteObject(input.storageKey);
		} catch (error) {
			throw storageFailure("Could not delete proven R2 render orphan.", error);
		}
	}
}
