import ProjectStepPage from "@/features/project-navigation/project-step-page";

export default async function FactLockStepPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	return <ProjectStepPage projectId={projectId} stepKey="fact-lock" />;
}
