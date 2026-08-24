import GatedProjectStepPage from "@/features/project-navigation/gated-project-step-page";
import ScriptStudio from "@/features/script-generation/script-studio";

export default async function ContentStepPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	return (
		<GatedProjectStepPage projectId={projectId} stepKey="content">
			<ScriptStudio projectId={projectId} />
		</GatedProjectStepPage>
	);
}
