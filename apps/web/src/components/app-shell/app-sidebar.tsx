"use client";

import { Button } from "@affichannel/ui/components/button";
import { cn } from "@affichannel/ui/lib/utils";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { APP_NAV_ITEMS, isAppRouteActive } from "@/config/routes";

export default function AppSidebar() {
	const pathname = usePathname();

	return (
		<aside className="hidden w-64 shrink-0 border-sidebar-border border-r bg-sidebar text-sidebar-foreground lg:flex lg:flex-col">
			<div className="border-sidebar-border border-b px-5 py-5">
				<Link
					className="font-semibold text-affi-blue text-lg tracking-tight"
					href="/dashboard"
				>
					AffiChannel
				</Link>
				<p className="mt-1 text-sidebar-foreground/70 text-xs">
					Workspace sản xuất
				</p>
			</div>

			<nav aria-label="Điều hướng chính" className="flex-1 space-y-1 p-3">
				{APP_NAV_ITEMS.map((route) => {
					const Icon = route.icon;
					const active = isAppRouteActive(pathname, route);

					return (
						<Button
							key={route.key}
							nativeButton={false}
							render={
								<Link
									aria-current={active ? "page" : undefined}
									href={route.href as Route}
								/>
							}
							variant={active ? "default" : "ghost"}
							className={cn(
								"h-10 w-full justify-start gap-3 px-3 text-sm",
								active && "font-semibold",
							)}
						>
							<Icon aria-hidden="true" />
							<span>{route.label}</span>
						</Button>
					);
				})}
			</nav>
		</aside>
	);
}
