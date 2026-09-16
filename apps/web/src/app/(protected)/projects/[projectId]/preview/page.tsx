import { preflightQuickImageCompositionVersion } from "@affichannel/api/services/quick-image-preview-preflight";
import {
	CONTENT_FORMAT_DEFAULTS,
	classifyPersistedProjectIdentity,
} from "@affichannel/core";
import GatedProjectStepPage from "@/features/project-navigation/gated-project-step-page";
import {
	getCurrentWorkspaceActor,
	getProjectForCurrentUser,
} from "@/lib/project-loader";

function isCanonicalQuickImageProject(
	project: Awaited<ReturnType<typeof getProjectForCurrentUser>>,
) {
	if (!project) return false;

	const classification = classifyPersistedProjectIdentity({
		productId: project.product.id.trim() || null,
		contentType: project.contentType,
		creationPath: project.creationPath,
		contentFormatKey: project.contentFormat?.ref.key ?? null,
		contentFormatVersion: project.contentFormat?.ref.version ?? null,
	});

	return (
		classification.kind === "canonical" &&
		classification.identity.creationPath === "QUICK_IMAGE" &&
		classification.identity.contentFormat.key ===
			CONTENT_FORMAT_DEFAULTS.QUICK_IMAGE.key &&
		classification.identity.contentFormat.version ===
			CONTENT_FORMAT_DEFAULTS.QUICK_IMAGE.version
	);
}

export default async function PreviewStepPage({
	params,
	searchParams,
}: {
	params: Promise<{ projectId: string }>;
	searchParams?: Promise<{ compositionVersionId?: string | string[] }>;
}) {
	const { projectId } = await params;
	const project = await getProjectForCurrentUser(projectId);
	if (!isCanonicalQuickImageProject(project)) {
		return <GatedProjectStepPage projectId={projectId} stepKey="preview" />;
	}

	const compositionVersionId = (await searchParams)?.compositionVersionId;
	const versionId =
		typeof compositionVersionId === "string" && compositionVersionId.trim()
			? compositionVersionId.trim()
			: undefined;
	const actor = versionId ? await getCurrentWorkspaceActor() : undefined;
	const preview =
		versionId && actor
			? await preflightQuickImageCompositionVersion(actor, projectId, versionId)
			: null;
	return (
		<section
			className="space-y-2"
			data-project-id={projectId}
			data-composition-version-id={versionId ?? ""}
		>
			<h1 className="font-semibold text-2xl tracking-tight">
				Quick Image preview
			</h1>
			{versionId && preview?.ok ? (
				<p className="max-w-2xl text-muted-foreground">
					CompositionVersion {versionId} đã được chọn. Playback controls sẽ được
					bổ sung ở C2.
				</p>
			) : versionId ? (
				<p className="max-w-2xl text-muted-foreground">
					CompositionVersion không hợp lệ hoặc không thuộc project này.
				</p>
			) : (
				<p className="max-w-2xl text-muted-foreground">
					Chọn CompositionVersion bằng query
					<code className="mx-1">compositionVersionId</code> để mở preview.
				</p>
			)}
		</section>
	);
}
