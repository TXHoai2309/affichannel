"use client";

import type { ReactNode } from "react";

import AppSidebar from "./app-sidebar";
import AppTopbar from "./app-topbar";

export default function AppShell({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-svh bg-background">
			<AppSidebar />
			<div className="flex min-w-0 flex-1 flex-col">
				<AppTopbar />
				<main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
			</div>
		</div>
	);
}
