import { ProjectForm } from "@/features/project/project-form";

export default function NewProjectPage() {
	return (
		<div className="mx-auto w-full max-w-3xl">
			<div className="border bg-card p-6 md:p-8">
				<ProjectForm />
			</div>
		</div>
	);
}
