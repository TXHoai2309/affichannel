import GatedProjectStepPage from "@/features/project-navigation/gated-project-step-page";

export default async function PreviewStepPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	return <GatedProjectStepPage projectId={projectId} stepKey="preview" />;
}
