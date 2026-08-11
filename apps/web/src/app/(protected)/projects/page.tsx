import { Button } from "@affichannel/ui/components/button";
import Link from "next/link";

import { ProjectList } from "@/features/project/project-list";

export default function ProjectsPage() {
	return (
		<div className="mx-auto w-full max-w-6xl space-y-5">
			<div className="flex justify-end">
				<Button nativeButton={false} render={<Link href="/projects/new" />}>
					Tạo dự án
				</Button>
			</div>
			<ProjectList />
		</div>
	);
}
