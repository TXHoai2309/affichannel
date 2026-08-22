import ScriptStudio from "@/features/script-generation/script-studio";

export default async function ContentStepPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	return <ScriptStudio projectId={projectId} />;
}
