import { ProjectForm } from "@/features/project/project-form";

export default function NewProjectPage() {
	return (
		<div className="mx-auto w-full max-w-3xl">
			<div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm md:p-8">
				<ProjectForm />
			</div>
		</div>
	);
}
