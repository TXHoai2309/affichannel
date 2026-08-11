import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getProjectFixture } from "@/features/project-navigation/project-fixtures";
import ProjectStepper from "@/features/project-navigation/project-stepper";

export default async function ProjectLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	const project = getProjectFixture(projectId);

	if (!project) {
		notFound();
	}

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6">
			<div className="space-y-2">
				<p className="font-medium text-muted-foreground text-sm">Dự án</p>
				<h1 className="font-semibold text-3xl tracking-tight">
					{project.name}
				</h1>
				<p className="text-muted-foreground">
					Sản phẩm mẫu: {project.productName}
				</p>
			</div>
			<ProjectStepper projectId={project.id} />
			{children}
		</div>
	);
}
