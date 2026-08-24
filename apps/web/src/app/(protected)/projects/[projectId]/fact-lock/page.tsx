import FactLockReview from "@/features/fact-lock/fact-lock-review";
import GatedProjectStepPage from "@/features/project-navigation/gated-project-step-page";

export default async function FactLockStepPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	return (
		<GatedProjectStepPage projectId={projectId} stepKey="fact-lock">
			<FactLockReview projectId={projectId} />
		</GatedProjectStepPage>
	);
}
