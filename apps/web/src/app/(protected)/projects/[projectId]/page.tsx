import type { Route } from "next";
import { redirect } from "next/navigation";

export default async function ProjectOverviewPage({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	redirect(`/projects/${projectId}/product` as Route);
}
