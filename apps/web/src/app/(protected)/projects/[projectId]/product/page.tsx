import ProductLinkPanel from "@/features/project/product-link-panel";
import ProjectStepPage from "@/features/project-navigation/project-step-page";

export default async function ProductStepPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	return (
		<ProjectStepPage
			content={<ProductLinkPanel projectId={projectId} />}
			projectId={projectId}
			stepKey="product"
		/>
	);
}
