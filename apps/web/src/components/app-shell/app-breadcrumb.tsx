"use client";

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@affichannel/ui/components/breadcrumb";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { getBreadcrumbItems } from "@/config/routes";

export default function AppBreadcrumb() {
	const pathname = usePathname();
	const items = getBreadcrumbItems(pathname);

	return (
		<Breadcrumb>
			<BreadcrumbList>
				{items.map((item, index) => (
					<BreadcrumbItem key={`${item.label}-${item.href ?? "current"}`}>
						{index > 0 ? <BreadcrumbSeparator /> : null}
						{item.current || !item.href ? (
							<BreadcrumbPage>{item.label}</BreadcrumbPage>
						) : (
							<Link
								className="transition-colors hover:text-foreground"
								href={item.href as Route}
							>
								{item.label}
							</Link>
						)}
					</BreadcrumbItem>
				))}
			</BreadcrumbList>
		</Breadcrumb>
	);
}
