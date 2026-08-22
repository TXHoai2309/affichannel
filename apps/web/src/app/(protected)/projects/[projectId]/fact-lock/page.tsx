import FactLockReview from "@/features/fact-lock/fact-lock-review";

export default async function FactLockStepPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	return <FactLockReview projectId={projectId} />;
}
