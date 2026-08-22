import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import AppShell from "@/components/app-shell/app-shell";
import { getCurrentSession } from "@/lib/project-loader";

export default async function ProtectedLayout({
	children,
}: {
	children: ReactNode;
}) {
	const session = await getCurrentSession();

	if (!session?.user) {
		redirect("/login");
	}

	return <AppShell>{children}</AppShell>;
}
