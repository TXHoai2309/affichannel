import {
	type ClaimManifest,
	channelSettingsSchema,
	classifyLegacyProject,
	evaluateFactGenerationUsability,
	evaluateFactLockGate,
	mapAdaptiveWorkflowReadModel,
	mapProjectWorkflowEntrySummary,
	type ProjectApplicabilityInput,
	type ProjectWorkflowEntrySummary,
	resolveBusinessToday,
	resolveProjectApplicability,
	validateScriptVersionForFactLock,
} from "@affichannel/core";
import type {
	ProductFactSourceType,
	ProductFactStatus,
	ProductFactType,
} from "@affichannel/core/product-fact/types";
import {
	channelSettings,
	db,
	factDependency,
	factLockRun,
	product,
	productFact,
	project,
	scriptGeneration,
	scriptVersion,
	voiceConfig,
	voiceSegmentArtifact,
} from "@affichannel/db";
import { env } from "@affichannel/env/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getClaimManifestByIdInTransaction } from "./claim-manifest-repository";
import { buildFactLockGateEvaluationInput } from "./fact-lock-gate-service";
import type { ProjectWorkflowSubject } from "./project-repository";
import type { ProjectWorkflowSnapshot } from "./project-workflow-read-service";
import { mapScriptVersionRecord } from "./script-version-repository";
import { toVoiceSegmentArtifact } from "./voice-segment-repository";
import { evaluateVoiceStepWorkflowReadInput } from "./voice-step-workflow-service";
import type { WorkspaceActor } from "./workspace";

type ScriptGenerationRow = typeof scriptGeneration.$inferSelect;
type ScriptVersionRow = typeof scriptVersion.$inferSelect;
type FactLockRunRow = typeof factLockRun.$inferSelect;
type FactDependencyRow = typeof factDependency.$inferSelect;
type ProductFactRow = typeof productFact.$inferSelect;
type VoiceConfigRow = typeof voiceConfig.$inferSelect;
type VoiceArtifactRow = typeof voiceSegmentArtifact.$inferSelect;

export type ProjectWorkflowEntryBatchRows = {
	subjects: ProjectWorkflowSubject[];
	scriptGenerations: ScriptGenerationRow[];
	scriptVersions: ScriptVersionRow[];
	factLockRuns: FactLockRunRow[];
	claimManifests: ClaimManifest[];
	dependencies: FactDependencyRow[];
	productFacts: ProductFactRow[];
	channelSettings: typeof channelSettings.$inferSelect | null;
	voiceConfigs: VoiceConfigRow[];
	voiceArtifacts: VoiceArtifactRow[];
};

export type ProjectWorkflowEntryBatchRepository = {
	load(
		actor: WorkspaceActor,
		projectIds: readonly string[],
	): Promise<ProjectWorkflowEntryBatchRows>;
};

function groupBy<T>(rows: readonly T[], key: (row: T) => string) {
	const grouped = new Map<string, T[]>();
	for (const row of rows) {
		const value = key(row);
		const current = grouped.get(value) ?? [];
		current.push(row);
		grouped.set(value, current);
	}
	return grouped;
}

function latestFirst<T extends { id: string }>(
	left: T & { createdAt?: Date; updatedAt?: Date },
	right: T & { createdAt?: Date; updatedAt?: Date },
) {
	const leftDate = left.updatedAt ?? left.createdAt ?? new Date(0);
	const rightDate = right.updatedAt ?? right.createdAt ?? new Date(0);
	return (
		rightDate.getTime() - leftDate.getTime() || right.id.localeCompare(left.id)
	);
}

function emptyInput(
	subject: ProjectWorkflowSubject,
): ProjectApplicabilityInput {
	return {
		projectIdentity: {
			contentType: subject.contentType,
			creationPath: subject.creationPath,
			contentFormatKey: subject.contentFormatKey,
			contentFormatVersion: subject.contentFormatVersion,
			hasProduct: subject.productId !== null,
		},
		product: { accessible: false },
		script: {
			generationStatus: "NONE",
			usableGenerationPresent: false,
			sourceDependencyCurrent: false,
			currentVersionPresent: false,
			currentVersionFactLockReady: false,
			channelSettingsComplete: false,
			productFactsUsable: false,
		},
		factLock: { gateReason: "NO_SCRIPT_VERSION" },
		voice: {
			configPresent: false,
			previewPresent: false,
			totalSegments: 0,
			attemptedSegments: 0,
			usableSegments: 0,
			pendingSegments: 0,
			failedSegments: 0,
			indeterminateSegments: 0,
			staleSegments: 0,
		},
		render: { featureImplemented: false, inputsStale: false },
	};
}

function generationStatus(
	latest: ScriptGenerationRow | undefined,
	usable: ScriptGenerationRow | undefined,
): ProjectApplicabilityInput["script"]["generationStatus"] {
	if (!latest) return "NONE";
	if (latest.status === "pending") return "PENDING";
	if (latest.status === "failed") return "FAILED";
	if (latest.status === "indeterminate") return "INDETERMINATE";
	return usable ? "USABLE" : "INDETERMINATE";
}

function channelSettingsComplete(
	record: ProjectWorkflowEntryBatchRows["channelSettings"],
) {
	return channelSettingsSchema.safeParse(
		record
			? {
					niche: record.niche,
					targetAudience: record.targetAudience,
					tone: record.tone,
					contentPillar: record.contentPillar,
					defaultCta: record.defaultCta,
					affiliateDisclosure: record.affiliateDisclosure,
					avoidWords: record.avoidWords,
				}
			: undefined,
	).success;
}

function productFactsUsable(facts: readonly ProductFactRow[], today: string) {
	return facts.some(
		(fact) =>
			evaluateFactGenerationUsability(
				{
					...fact,
					type: fact.type as ProductFactType,
					status: fact.status as ProductFactStatus,
					sourceType: fact.sourceType as ProductFactSourceType | null,
				},
				today,
			).usability !== "blocked",
	);
}

export function buildProjectWorkflowEntrySnapshots(
	actor: WorkspaceActor,
	rows: ProjectWorkflowEntryBatchRows,
	temporalContext = {
		now: new Date(),
		pendingLeaseMs: Number(env.VOICE_SEGMENT_PENDING_LEASE_MS),
	},
): ProjectWorkflowSnapshot[] {
	const generationsByProject = groupBy(
		rows.scriptGenerations,
		(row) => row.projectId,
	);
	const versionsByProject = groupBy(
		rows.scriptVersions,
		(row) => row.projectId,
	);
	const runsByProject = groupBy(rows.factLockRuns, (row) => row.projectId);
	const manifestsById = new Map(
		rows.claimManifests.map((manifest) => [manifest.id, manifest]),
	);
	const factsByProduct = groupBy(rows.productFacts, (row) => row.productId);
	const dependenciesByTarget = groupBy(
		rows.dependencies,
		(row) => `${row.dependentType}:${row.dependentId}`,
	);
	const configsByProject = new Map(
		rows.voiceConfigs.map((row) => [row.projectId, row]),
	);
	const artifactsByProject = groupBy(
		rows.voiceArtifacts,
		(row) => row.projectId,
	);
	const today = resolveBusinessToday(temporalContext.now);
	const settingsComplete = channelSettingsComplete(rows.channelSettings);

	return rows.subjects.map((subject) => {
		let input = emptyInput(subject);
		if (subject.productAccessible) {
			const generations = (generationsByProject.get(subject.id) ?? []).sort(
				latestFirst,
			);
			const latestGeneration = generations[0];
			const usableGeneration = generations.find(
				(row) =>
					(row.status === "completed" || row.status === "partial") &&
					row.outputJson !== null,
			);
			const currentVersionRow = (versionsByProject.get(subject.id) ?? [])
				.filter((row) => row.status === "draft")
				.sort(latestFirst)[0];
			const currentVersion = currentVersionRow
				? mapScriptVersionRecord(currentVersionRow)
				: undefined;
			const currentGateVersion = currentVersion
				? {
						id: currentVersion.id,
						revision: currentVersion.revision,
						snapshot: currentVersion.editableSnapshot,
					}
				: null;
			const runs = (runsByProject.get(subject.id) ?? []).sort(latestFirst);
			const productFacts = subject.productId
				? (factsByProduct.get(subject.productId) ?? [])
				: [];
			const gate = evaluateFactLockGate(
				buildFactLockGateEvaluationInput({
					productId: subject.productId,
					project: {
						id: subject.id,
						workspaceId: actor.workspaceId,
						productId: subject.productId,
						contentType: subject.contentType,
						creationPath: subject.creationPath,
						contentFormatKey: subject.contentFormatKey,
						contentFormatVersion: subject.contentFormatVersion,
						archivedAt: null,
					},
					currentScriptVersion: currentGateVersion,
					runs,
					claimManifests: runs.flatMap((run) =>
						run.claimManifestId
							? [manifestsById.get(run.claimManifestId)].filter(
									(manifest): manifest is ClaimManifest =>
										manifest !== undefined,
								)
							: [],
					),
					dependencies: runs.flatMap(
						(run) => dependenciesByTarget.get(`fact_lock:${run.id}`) ?? [],
					),
					facts: productFacts,
				}),
			);
			const voice = evaluateVoiceStepWorkflowReadInput({
				workspaceId: actor.workspaceId,
				projectId: subject.id,
				factLockGate: gate,
				currentScriptVersion: currentVersion,
				currentVoiceConfig: configsByProject.get(subject.id) ?? null,
				artifacts: (artifactsByProject.get(subject.id) ?? []).map(
					toVoiceSegmentArtifact,
				),
				temporalContext,
			});
			const statuses = voice.segments.map(
				(segment) => segment.readModel.effectiveStatus,
			);
			input = {
				...input,
				product: { accessible: true },
				script: {
					generationStatus: generationStatus(
						latestGeneration,
						usableGeneration,
					),
					usableGenerationPresent: usableGeneration !== undefined,
					sourceDependencyCurrent:
						usableGeneration === undefined ||
						(
							dependenciesByTarget.get(
								`script_generation:${usableGeneration.id}`,
							) ?? []
						).every((dependency) => dependency.invalidatedAt === null),
					currentVersionPresent: currentVersion !== undefined,
					currentVersionFactLockReady: currentVersion
						? validateScriptVersionForFactLock(currentVersion.editableSnapshot)
								.success
						: false,
					channelSettingsComplete: settingsComplete,
					productFactsUsable: productFactsUsable(productFacts, today),
				},
				factLock: { gateReason: gate.reason },
				voice: {
					configPresent: voice.summary.voiceConfigPresent,
					previewPresent: false,
					totalSegments: voice.summary.totalSegments,
					attemptedSegments: statuses.filter(
						(status) => status !== "not_generated",
					).length,
					usableSegments: voice.summary.completedSegments,
					pendingSegments: voice.summary.pendingSegments,
					failedSegments: statuses.filter((status) => status === "failed")
						.length,
					indeterminateSegments: statuses.filter(
						(status) => status === "indeterminate",
					).length,
					staleSegments: voice.summary.staleSegments,
				},
			};
		}

		const classification = classifyLegacyProject(input.projectIdentity);
		const result = resolveProjectApplicability(input);
		const workflow = mapAdaptiveWorkflowReadModel(result, {
			identityClassification: classification,
		});
		return {
			projectId: subject.id,
			applicabilityInput: input,
			applicabilityResult: result,
			adaptiveWorkflow: workflow,
		};
	});
}

export function buildProjectWorkflowEntrySummaries(
	actor: WorkspaceActor,
	rows: ProjectWorkflowEntryBatchRows,
	temporalContext = {
		now: new Date(),
		pendingLeaseMs: Number(env.VOICE_SEGMENT_PENDING_LEASE_MS),
	},
): ProjectWorkflowEntrySummary[] {
	return buildProjectWorkflowEntrySnapshots(actor, rows, temporalContext).map(
		(snapshot) =>
			mapProjectWorkflowEntrySummary(
				snapshot.projectId,
				snapshot.adaptiveWorkflow,
			),
	);
}

export const databaseProjectWorkflowEntryBatchRepository: ProjectWorkflowEntryBatchRepository =
	{
		async load(actor, projectIds) {
			if (projectIds.length === 0) {
				return {
					subjects: [],
					scriptGenerations: [],
					scriptVersions: [],
					factLockRuns: [],
					claimManifests: [],
					dependencies: [],
					productFacts: [],
					channelSettings: null,
					voiceConfigs: [],
					voiceArtifacts: [],
				};
			}
			const subjects = await db
				.select({
					id: project.id,
					contentType: project.contentType,
					creationPath: project.creationPath,
					contentFormatKey: project.contentFormatKey,
					contentFormatVersion: project.contentFormatVersion,
					productId: project.productId,
					accessibleProductId: product.id,
				})
				.from(project)
				.leftJoin(
					product,
					and(
						eq(project.productId, product.id),
						eq(product.workspaceId, actor.workspaceId),
					),
				)
				.where(
					and(
						eq(project.workspaceId, actor.workspaceId),
						isNull(project.archivedAt),
						inArray(project.id, [...projectIds]),
					),
				);
			const mappedSubjects: ProjectWorkflowSubject[] = subjects.map((row) => ({
				id: row.id,
				contentType: row.contentType,
				creationPath: row.creationPath,
				contentFormatKey: row.contentFormatKey,
				contentFormatVersion: row.contentFormatVersion,
				productId: row.productId,
				productAccessible: row.accessibleProductId !== null,
			}));
			const productIds = [
				...new Set(
					mappedSubjects.flatMap((row) =>
						row.productId ? [row.productId] : [],
					),
				),
			];
			const ids = mappedSubjects.map((row) => row.id);
			const [
				scriptGenerations,
				scriptVersions,
				factLockRuns,
				productFacts,
				settingsRows,
				voiceConfigs,
				voiceArtifacts,
			] = await Promise.all([
				db
					.select()
					.from(scriptGeneration)
					.where(
						and(
							eq(scriptGeneration.workspaceId, actor.workspaceId),
							inArray(scriptGeneration.projectId, ids),
						),
					)
					.orderBy(desc(scriptGeneration.createdAt), desc(scriptGeneration.id)),
				db
					.select()
					.from(scriptVersion)
					.where(
						and(
							eq(scriptVersion.workspaceId, actor.workspaceId),
							inArray(scriptVersion.projectId, ids),
							eq(scriptVersion.status, "draft"),
						),
					)
					.orderBy(desc(scriptVersion.updatedAt), desc(scriptVersion.id)),
				db
					.select()
					.from(factLockRun)
					.where(
						and(
							eq(factLockRun.workspaceId, actor.workspaceId),
							inArray(factLockRun.projectId, ids),
						),
					)
					.orderBy(desc(factLockRun.createdAt), desc(factLockRun.id)),
				productIds.length === 0
					? Promise.resolve([])
					: db
							.select()
							.from(productFact)
							.where(
								and(
									eq(productFact.workspaceId, actor.workspaceId),
									inArray(productFact.productId, productIds),
								),
							),
				db
					.select()
					.from(channelSettings)
					.where(eq(channelSettings.workspaceId, actor.workspaceId))
					.limit(1),
				db
					.select()
					.from(voiceConfig)
					.where(
						and(
							eq(voiceConfig.workspaceId, actor.workspaceId),
							inArray(voiceConfig.projectId, ids),
						),
					),
				db
					.select()
					.from(voiceSegmentArtifact)
					.where(
						and(
							eq(voiceSegmentArtifact.workspaceId, actor.workspaceId),
							inArray(voiceSegmentArtifact.projectId, ids),
						),
					)
					.orderBy(
						desc(voiceSegmentArtifact.createdAt),
						desc(voiceSegmentArtifact.id),
					),
			]);
			const manifestIds = [
				...new Set(
					factLockRuns.flatMap((row) =>
						row.claimManifestId ? [row.claimManifestId] : [],
					),
				),
			];
			const claimManifests = await Promise.all(
				manifestIds.map(async (claimManifestId) => {
					const manifest = await db.transaction((transaction) =>
						getClaimManifestByIdInTransaction(transaction, {
							workspaceId: actor.workspaceId,
							projectId:
								factLockRuns.find(
									(row) => row.claimManifestId === claimManifestId,
								)?.projectId ?? "",
							claimManifestId,
						}),
					);
					if (!manifest)
						throw new Error("ClaimManifest not found in workflow batch.");
					return manifest;
				}),
			);
			const dependentIds = [
				...scriptGenerations
					.filter(
						(row) =>
							(row.status === "completed" || row.status === "partial") &&
							row.outputJson !== null,
					)
					.map((row) => row.id),
				...factLockRuns.map((row) => row.id),
			];
			const dependencies =
				dependentIds.length === 0
					? []
					: await db
							.select()
							.from(factDependency)
							.where(
								and(
									eq(factDependency.workspaceId, actor.workspaceId),
									inArray(factDependency.dependentId, dependentIds),
								),
							);
			return {
				subjects: mappedSubjects,
				scriptGenerations,
				scriptVersions,
				factLockRuns,
				claimManifests,
				dependencies,
				productFacts,
				channelSettings: settingsRows[0] ?? null,
				voiceConfigs,
				voiceArtifacts,
			};
		},
	};

export async function listProjectWorkflowEntrySummaries(
	actor: WorkspaceActor,
	projectIds: readonly string[],
	repository: ProjectWorkflowEntryBatchRepository = databaseProjectWorkflowEntryBatchRepository,
) {
	if (projectIds.length === 0) return [];
	const rows = await repository.load(actor, [...new Set(projectIds)]);
	return buildProjectWorkflowEntrySummaries(actor, rows);
}
