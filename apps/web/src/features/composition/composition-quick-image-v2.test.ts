import {
	assembleCompositionInput,
	assembleCompositionInputV2,
	type ServerOwnedQuickImageCompositionAssemblyReader,
} from "@affichannel/api/services/composition-assembly-service";
import {
	type CompositionVersionCreationDependencies,
	createCompositionVersion,
} from "@affichannel/api/services/composition-service";
import type { CompositionVersionReadModel } from "@affichannel/api/services/composition-version-repository";
import type { ProjectWorkflowSubject } from "@affichannel/api/services/project-repository";
import type { QuickImageSettingsSnapshot } from "@affichannel/api/services/quick-image-settings-service";
import type { WorkspaceActor } from "@affichannel/api/services/workspace";
import {
	buildCompositionInputV2QuickImage,
	CENTER_ZOOM_IN_V1,
	type CompositionInputV1Result,
	type CompositionInputV2Result,
	compositionInputV2Schema,
	QUICK_IMAGE_FPS,
	type QuickImageCurrentSourceResolution,
	type QuickImageSourceAuthority,
} from "@affichannel/core";
import { describe, expect, it, vi } from "vitest";

const actor: WorkspaceActor = {
	workspaceId: "workspace-1",
	userId: "user-1",
};

const project = {
	id: "project-1",
	contentType: "ORGANIC" as const,
	creationPath: "QUICK_IMAGE" as const,
	contentFormatKey: "QUICK_IMAGE_STANDARD",
	contentFormatVersion: 1,
	productId: null,
	productAccessible: true,
};

const settings = (
	durationSeconds: 5 | 10 | 15,
): QuickImageSettingsSnapshot => ({
	workspaceId: actor.workspaceId,
	projectId: project.id,
	durationSeconds,
	revision: durationSeconds === 5 ? 1 : 2,
});

function source(
	overrides: Partial<QuickImageSourceAuthority> = {},
): QuickImageSourceAuthority {
	return {
		id: "asset-a",
		workspaceId: actor.workspaceId,
		checksumSha256: "a".repeat(64),
		storageProvider: "local",
		storageKey: "quick-image/a.png",
		mimeType: "image/png",
		byteSize: 1234,
		width: 800,
		height: 600,
		...overrides,
	};
}

function ready(
	sourceAuthority: QuickImageSourceAuthority,
): QuickImageCurrentSourceResolution {
	return { status: "READY", linkId: "link-1", source: sourceAuthority };
}

function reader(
	resolution: QuickImageCurrentSourceResolution,
	quickImageSettings: QuickImageSettingsSnapshot | undefined = settings(5),
): ServerOwnedQuickImageCompositionAssemblyReader {
	return {
		read: async () => ({
			project,
			source: resolution,
			settings: quickImageSettings,
		}),
	};
}

async function validInput(durationSeconds: 5 | 10 | 15 = 5) {
	const result = await buildCompositionInputV2QuickImage({
		workspaceId: actor.workspaceId,
		projectId: project.id,
		source: source(),
		durationSeconds,
	});
	if (!result.ok) throw new Error(result.issues?.join(",") ?? result.code);
	return result.input;
}

describe("CompositionInputV2 Quick Image", () => {
	it("builds a strict discriminated, script-free input with one media dependency", async () => {
		const input = await validInput();

		expect(input.schemaVersion).toBe("composition-input.v2");
		expect(input.source.kind).toBe("QUICK_IMAGE");
		expect(input.media).toHaveLength(1);
		expect(input.media[0]?.dependencyKey).toBe("quick-image-source");
		expect(input.media[0]?.role).toBe("QUICK_IMAGE_SOURCE");
		expect(input.profile).toMatchObject({
			logicalWidth: 1080,
			logicalHeight: 1920,
			aspectRatio: "9:16",
		});
		expect(input.timeline.fps).toEqual(QUICK_IMAGE_FPS);
		expect(input.motion).toEqual(CENTER_ZOOM_IN_V1);
		expect(input.source).toMatchObject({
			mediaAssetId: "asset-a",
			checksumSha256: "a".repeat(64),
			storageProvider: "local",
			storageKey: "quick-image/a.png",
			mimeType: "image/png",
			byteSize: 1234,
			width: 800,
			height: 600,
		});
	});

	it.each([
		[5, "150"],
		[10, "300"],
		[15, "450"],
	] as const)(
		"uses canonical duration %s with %s frames",
		async (duration, frames) => {
			const input = await validInput(duration);
			expect(input.source.durationSeconds).toBe(duration);
			expect(input.timeline.totalFrames).toBe(frames);
		},
	);

	it("rejects script, voice, text, wrong version, and wrong source discriminants", async () => {
		const input = await validInput();
		expect(
			compositionInputV2Schema.safeParse({ ...input, script: {} }).success,
		).toBe(false);
		expect(
			compositionInputV2Schema.safeParse({ ...input, voice: {} }).success,
		).toBe(false);
		expect(
			compositionInputV2Schema.safeParse({ ...input, text: "placeholder" })
				.success,
		).toBe(false);
		expect(
			compositionInputV2Schema.safeParse({
				...input,
				schemaVersion: "composition-input.v1",
			}).success,
		).toBe(false);
		expect(
			compositionInputV2Schema.safeParse({
				...input,
				source: { ...input.source, kind: "SCRIPTED" },
			}).success,
		).toBe(false);
	});

	it("rejects malformed frozen provenance and dependency cardinality", async () => {
		const input = await validInput();
		expect(
			compositionInputV2Schema.safeParse({
				...input,
				media: [],
			}).success,
		).toBe(false);
		expect(
			compositionInputV2Schema.safeParse({
				...input,
				source: { ...input.source, checksumSha256: "b".repeat(64) },
			}).success,
		).toBe(false);
		expect(
			compositionInputV2Schema.safeParse({
				...input,
				media: [
					{
						...input.media[0],
						semantic: {
							...input.media[0]?.semantic,
							checksumSha256: "b".repeat(64),
						},
					},
				],
			}).success,
		).toBe(false);
	});

	it("requires a canonical READY source and valid settings", async () => {
		for (const resolution of [
			{ status: "MISSING" },
			{
				status: "INELIGIBLE",
				linkId: "link-1",
				mediaAssetId: "asset-a",
				reasonCode: "MEDIA_NOT_READY",
			},
			{ status: "CORRUPT_MULTIPLE" },
		] as const) {
			const result = await assembleCompositionInputV2(
				actor,
				project.id,
				reader(resolution),
			);
			expect(result.ok).toBe(false);
		}
		const missingSettings = await assembleCompositionInputV2(
			actor,
			project.id,
			{
				read: async () => ({
					project,
					source: ready(source()),
					settings: undefined,
				}),
			},
		);
		expect(missingSettings.ok).toBe(false);
		const wrongIdentity = await assembleCompositionInputV2(actor, project.id, {
			read: async () => ({
				project: { ...project, contentFormatKey: "SCRIPTED_STANDARD" },
				source: ready(source()),
				settings: settings(5),
			}),
		});
		expect(wrongIdentity.ok).toBe(false);
		const crossWorkspace = await assembleCompositionInputV2(
			actor,
			project.id,
			reader(ready(source({ workspaceId: "workspace-2" }))),
		);
		expect(crossWorkspace.ok).toBe(false);
	});

	it("keeps fingerprints deterministic and changes them for frozen semantics", async () => {
		const first = await buildCompositionInputV2QuickImage({
			workspaceId: actor.workspaceId,
			projectId: project.id,
			source: source(),
			durationSeconds: 5,
		});
		const equivalent = await buildCompositionInputV2QuickImage({
			workspaceId: actor.workspaceId,
			projectId: project.id,
			source: source(),
			durationSeconds: 5,
		});
		const changedChecksum = await buildCompositionInputV2QuickImage({
			workspaceId: actor.workspaceId,
			projectId: project.id,
			source: source({ checksumSha256: "b".repeat(64) }),
			durationSeconds: 5,
		});
		const changedDuration = await buildCompositionInputV2QuickImage({
			workspaceId: actor.workspaceId,
			projectId: project.id,
			source: source(),
			durationSeconds: 10,
		});
		expect(
			first.ok && equivalent.ok && changedChecksum.ok && changedDuration.ok,
		).toBe(true);
		if (
			!first.ok ||
			!equivalent.ok ||
			!changedChecksum.ok ||
			!changedDuration.ok
		)
			return;
		expect(equivalent.fingerprint).toBe(first.fingerprint);
		expect(changedChecksum.fingerprint).not.toBe(first.fingerprint);
		expect(changedDuration.fingerprint).not.toBe(first.fingerprint);
	});
});

describe("CompositionInput dispatch identity", () => {
	const failureV1: CompositionInputV1Result = {
		ok: false,
		code: "COMPOSITION_INPUT_INVALID",
	};
	const failureV2: CompositionInputV2Result = {
		ok: false,
		code: "COMPOSITION_INPUT_INVALID",
	};

	function subject(
		overrides: Partial<ProjectWorkflowSubject> = {},
	): ProjectWorkflowSubject {
		return {
			id: project.id,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
			productId: project.productId,
			productAccessible: project.productAccessible,
			...overrides,
		};
	}

	async function dispatch(projectSubject: ProjectWorkflowSubject | undefined) {
		const assembleV1 = vi.fn(async () => failureV1);
		const assembleV2 = vi.fn(async () => failureV2);
		const result = await assembleCompositionInput(actor, project.id, {
			readProject: async () => projectSubject,
			assembleV1,
			assembleV2,
		});
		return { result, assembleV1, assembleV2 };
	}

	it("routes only complete canonical identities and preserves legacy V1", async () => {
		const scripted = await dispatch(
			subject({
				creationPath: "SCRIPTED",
				contentFormatKey: "SCRIPTED_STANDARD",
				contentFormatVersion: 1,
			}),
		);
		expect(scripted.assembleV1).toHaveBeenCalledOnce();
		expect(scripted.assembleV2).not.toHaveBeenCalled();

		const quickImage = await dispatch(subject());
		expect(quickImage.assembleV2).toHaveBeenCalledOnce();
		expect(quickImage.assembleV1).not.toHaveBeenCalled();

		const legacy = await dispatch(
			subject({
				contentType: null,
				creationPath: null,
				contentFormatKey: null,
				contentFormatVersion: null,
				productId: "legacy-product",
			}),
		);
		expect(legacy.assembleV1).toHaveBeenCalledOnce();
		expect(legacy.assembleV2).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: "SCRIPTED + QUICK_IMAGE_STANDARD",
			identity: {
				creationPath: "SCRIPTED",
				contentFormatKey: "QUICK_IMAGE_STANDARD",
				contentFormatVersion: 1,
			},
		},
		{
			name: "QUICK_IMAGE + SCRIPTED_STANDARD",
			identity: {
				creationPath: "QUICK_IMAGE",
				contentFormatKey: "SCRIPTED_STANDARD",
				contentFormatVersion: 1,
			},
		},
		{
			name: "QUICK_IMAGE + unsupported version",
			identity: {
				creationPath: "QUICK_IMAGE",
				contentFormatKey: "QUICK_IMAGE_STANDARD",
				contentFormatVersion: 2,
			},
		},
		{
			name: "unhandled canonical MEDIA_FIRST",
			identity: {
				creationPath: "MEDIA_FIRST",
				contentFormatKey: "MEDIA_FIRST_STANDARD",
				contentFormatVersion: 1,
			},
		},
		{
			name: "SCRIPTED + unsupported version",
			identity: {
				creationPath: "SCRIPTED",
				contentFormatKey: "SCRIPTED_STANDARD",
				contentFormatVersion: 2,
			},
		},
	] as const)("rejects $name before either assembler", async ({ identity }) => {
		const rejected = await dispatch(subject(identity));
		expect(rejected.result).toMatchObject({
			ok: false,
			code: "COMPOSITION_INPUT_INVALID",
		});
		if (!rejected.result.ok)
			expect(rejected.result.issues).toContain("project.identity");
		expect(rejected.assembleV1).not.toHaveBeenCalled();
		expect(rejected.assembleV2).not.toHaveBeenCalled();
	});

	it("rejects a missing project without entering V1", async () => {
		const missing = await dispatch(undefined);
		expect(missing.result).toMatchObject({
			ok: false,
			code: "COMPOSITION_INPUT_INCOMPLETE",
			issues: ["project"],
		});
		expect(missing.assembleV1).not.toHaveBeenCalled();
		expect(missing.assembleV2).not.toHaveBeenCalled();
	});

	it("does not persist when the dispatcher rejects malformed identity", async () => {
		const rejected = await dispatch(
			subject({
				creationPath: "SCRIPTED",
				contentFormatKey: "QUICK_IMAGE_STANDARD",
				contentFormatVersion: 1,
			}),
		);
		let insertCalls = 0;
		await expect(
			createCompositionVersion(actor, project.id, {
				assemble: async () => rejected.result,
				insert: async () => {
					insertCalls += 1;
					return {} as CompositionVersionReadModel;
				},
			}),
		).rejects.toMatchObject({ code: "COMPOSITION_INPUT_INVALID" });
		expect(insertCalls).toBe(0);
	});
});

describe("Quick Image CompositionVersion creation", () => {
	it("resolves one authority snapshot, freezes replacement history, and preserves settings", async () => {
		let currentSource = source();
		let currentSettings = settings(5);
		type CompositionVersionInsertInput = Parameters<
			NonNullable<CompositionVersionCreationDependencies["insert"]>
		>[0];
		const persisted: CompositionVersionInsertInput[] = [];
		const insert = async (record: CompositionVersionInsertInput) => {
			persisted.push(record);
			return {} as CompositionVersionReadModel;
		};
		const assemble = () =>
			assembleCompositionInputV2(actor, project.id, {
				read: async () => ({
					project,
					source: ready(currentSource),
					settings: currentSettings,
				}),
			});

		await createCompositionVersion(actor, project.id, {
			assemble,
			insert,
		});
		currentSource = source({
			id: "asset-b",
			checksumSha256: "b".repeat(64),
			storageKey: "quick-image/b.png",
		});
		currentSettings = settings(10);
		await createCompositionVersion(actor, project.id, {
			assemble,
			insert,
		});

		expect(persisted).toHaveLength(2);
		const first = persisted[0]?.compositionInput;
		const second = persisted[1]?.compositionInput;
		expect(first?.schemaVersion).toBe("composition-input.v2");
		expect(second?.schemaVersion).toBe("composition-input.v2");
		if (
			first?.schemaVersion !== "composition-input.v2" ||
			second?.schemaVersion !== "composition-input.v2"
		)
			return;
		expect(first.source.mediaAssetId).toBe("asset-a");
		expect(first.source.durationSeconds).toBe(5);
		expect(first.timeline.totalFrames).toBe("150");
		expect(second.source.mediaAssetId).toBe("asset-b");
		expect(second.source.durationSeconds).toBe(10);
		expect(second.timeline.totalFrames).toBe("300");
		expect(first.media[0]?.provenance.mediaAssetId).toBe("asset-a");
		expect(second.media[0]?.provenance.mediaAssetId).toBe("asset-b");
	});

	it("does not insert when the assembler fails closed", async () => {
		let insertCalls = 0;
		await expect(
			createCompositionVersion(actor, project.id, {
				assemble: async () => ({
					ok: false as const,
					code: "COMPOSITION_INPUT_INVALID" as const,
				}),
				insert: async () => {
					insertCalls += 1;
					return {} as CompositionVersionReadModel;
				},
			}),
		).rejects.toMatchObject({ code: "COMPOSITION_INPUT_INVALID" });
		expect(insertCalls).toBe(0);
	});
});
