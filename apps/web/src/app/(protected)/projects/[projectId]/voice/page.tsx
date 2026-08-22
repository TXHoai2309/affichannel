import GatedProjectStepPage from "@/features/project-navigation/gated-project-step-page";
import VoiceStudio from "@/features/voice/voice-studio";

export default async function VoiceStepPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	return (
		<GatedProjectStepPage projectId={projectId} stepKey="voice">
			<VoiceStudio projectId={projectId} />
		</GatedProjectStepPage>
	);
}
