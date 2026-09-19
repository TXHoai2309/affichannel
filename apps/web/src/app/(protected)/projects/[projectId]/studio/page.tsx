import { preflightCompositionVersion } from "@affichannel/api/services/composition-preflight-service";

import { listCompositionVersionRecords } from "@affichannel/api/services/composition-version-repository";
import { notFound } from "next/navigation";
import { getProjectFixture } from "@/features/project-navigation/project-fixtures";
import VideoStudioCompose from "@/features/video-studio/video-studio-compose";
import VideoStudioExport from "@/features/video-studio/video-studio-export";
import VideoStudioShell, {
	type VideoStudioProject,
} from "@/features/video-studio/video-studio-shell";
import { resolveVideoStudioTab } from "@/features/video-studio/video-studio-tabs";
import {
	getAdaptiveWorkflowForCurrentUser,
	getCurrentWorkspaceActor,
	getProjectForCurrentUser,
} from "@/lib/project-loader";

type SearchParams = {
	studioTab?: string | string[];
	compositionVersionId?: string | string[];
};

function oneValue(value: string | string[] | undefined) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fixtureProject(
	fixture: ReturnType<typeof getProjectFixture>,
): VideoStudioProject | undefined {
	if (!fixture) return undefined;
	return {
		id: fixture.id,
		name: fixture.name,
		contentType: fixture.contentType,
		creationPath: "SCRIPTED",
		productName: fixture.productName,
	};
}

export default async function VideoStudioPage({
	params,
	searchParams,
}: {
	params: Promise<{ projectId: string }>;
	searchParams?: Promise<SearchParams>;
}) {
	const { projectId } = await params;
	const query = (await searchParams) ?? {};
	const activeTab = resolveVideoStudioTab(oneValue(query.studioTab));
	const requestedCompositionVersionId = oneValue(query.compositionVersionId);
	const actor = await getCurrentWorkspaceActor();
	if (!actor) notFound();

	const fixture = getProjectFixture(projectId);
	if (fixture) {
		const project = fixtureProject(fixture);
		if (!project) notFound();
		return (
			<VideoStudioShell
				activeTab={activeTab}
				composeContent={
					<VideoStudioCompose
						actor={undefined}
						compositionVersion={undefined}
						creationPath={project.creationPath}
						projectId={project.id}
					/>
				}
				exportContent={
					<VideoStudioExport
						actor={undefined}
						compositionVersion={undefined}
						creationPath={project.creationPath}
						preflight={null}
						projectId={project.id}
					/>
				}
				project={project}
				workflow={fixture.workflow}
			/>
		);
	}

	const [projectRecord, workflow] = await Promise.all([
		getProjectForCurrentUser(projectId),
		getAdaptiveWorkflowForCurrentUser(projectId),
	]);
	if (!projectRecord || !workflow) notFound();

	let compositionVersions: Awaited<
		ReturnType<typeof listCompositionVersionRecords>
	> = [];
	try {
		compositionVersions = await listCompositionVersionRecords(actor, projectId);
	} catch {
		compositionVersions = [];
	}
	const compositionVersion = requestedCompositionVersionId
		? compositionVersions.find(
				(version) => version.id === requestedCompositionVersionId,
			)
		: compositionVersions[0];
	let preflight: Awaited<
		ReturnType<typeof preflightCompositionVersion>
	> | null = null;
	if (compositionVersion) {
		try {
			preflight = await preflightCompositionVersion(
				actor,
				compositionVersion.id,
			);
		} catch {
			preflight = null;
		}
	}

	const project: VideoStudioProject = {
		id: projectRecord.id,
		name: projectRecord.name,
		contentType: projectRecord.contentType,
		creationPath: projectRecord.creationPath,
		productName: projectRecord.product.name,
	};
	return (
		<VideoStudioShell
			activeTab={activeTab}
			compositionVersionId={compositionVersion?.id}
			composeContent={
				<VideoStudioCompose
					actor={actor}
					compositionVersion={compositionVersion}
					creationPath={project.creationPath}
					projectId={projectId}
				/>
			}
			exportContent={
				<VideoStudioExport
					actor={actor}
					compositionVersion={compositionVersion}
					creationPath={project.creationPath}
					preflight={preflight}
					projectId={projectId}
				/>
			}
			project={project}
			workflow={workflow}
		/>
	);
}
