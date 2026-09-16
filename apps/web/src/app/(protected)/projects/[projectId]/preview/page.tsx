import { createQuickImageCompositionPreviewDescriptor } from "@affichannel/api/services/composition-preview-descriptor";
import {
	CONTENT_FORMAT_DEFAULTS,
	type CompositionPreviewDescriptorV2,
	classifyPersistedProjectIdentity,
} from "@affichannel/core";
import QuickImagePreviewPlayer from "@/features/composition/quick-image-preview-player";
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
	let descriptor: CompositionPreviewDescriptorV2 | null = null;
	if (versionId && actor) {
		try {
			descriptor = await createQuickImageCompositionPreviewDescriptor(
				actor,
				projectId,
				versionId,
			);
		} catch {
			descriptor = null;
		}
	}
	return (
		<section
			className="space-y-2"
			data-project-id={projectId}
			data-composition-version-id={versionId ?? ""}
		>
			<h1 className="font-semibold text-2xl tracking-tight">
				Quick Image preview
			</h1>
			{descriptor ? (
				<QuickImagePreviewPlayer descriptor={descriptor} />
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
