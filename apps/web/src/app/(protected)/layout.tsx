import { auth } from "@affichannel/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import AppShell from "@/components/app-shell/app-shell";

export default async function ProtectedLayout({
	children,
}: {
	children: ReactNode;
}) {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		redirect("/login");
	}

	return <AppShell>{children}</AppShell>;
}
