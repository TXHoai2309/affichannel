import type { LucideIcon } from "lucide-react";
import {
	BarChart3,
	FolderKanban,
	Images,
	LayoutDashboard,
	PackageOpen,
	Settings2,
	WalletCards,
} from "lucide-react";

import { getProjectFixture } from "@/features/project-navigation/project-fixtures";
import { getProjectStep } from "@/features/project-navigation/project-steps";

export type AppRouteKey =
	| "dashboard"
	| "projects"
	| "products"
	| "media"
	| "analytics"
	| "usage"
	| "settings";

export type FeatureStatus = "available" | "skeleton";

export type AppRoute = {
	key: AppRouteKey;
	label: string;
	href: string;
	icon: LucideIcon;
	featureStatus: FeatureStatus;
};

export const APP_ROUTES: Record<AppRouteKey, AppRoute> = {
	dashboard: {
		key: "dashboard",
		label: "Dashboard",
		href: "/dashboard",
		icon: LayoutDashboard,
		featureStatus: "available",
	},
	projects: {
		key: "projects",
		label: "Dự án",
		href: "/projects",
		icon: FolderKanban,
		featureStatus: "skeleton",
	},
	products: {
		key: "products",
		label: "Sản phẩm",
		href: "/products",
		icon: PackageOpen,
		featureStatus: "skeleton",
	},
	media: {
		key: "media",
		label: "Media Library",
		href: "/media",
		icon: Images,
		featureStatus: "skeleton",
	},
	analytics: {
		key: "analytics",
		label: "Analytics",
		href: "/analytics",
		icon: BarChart3,
		featureStatus: "skeleton",
	},
	usage: {
		key: "usage",
		label: "Chi phí & Usage",
		href: "/usage",
		icon: WalletCards,
		featureStatus: "skeleton",
	},
	settings: {
		key: "settings",
		label: "Cài đặt",
		href: "/settings",
		icon: Settings2,
		featureStatus: "skeleton",
	},
};

export const APP_NAV_ITEMS = Object.values(APP_ROUTES);

export function isAppRouteActive(pathname: string, route: AppRoute) {
	if (route.key === "dashboard") {
		return pathname === route.href;
	}

	return pathname === route.href || pathname.startsWith(`${route.href}/`);
}

export function getAppRouteFromPathname(
	pathname: string,
): AppRoute | undefined {
	return APP_NAV_ITEMS.filter((route) =>
		isAppRouteActive(pathname, route),
	).sort((a, b) => b.href.length - a.href.length)[0];
}

export type BreadcrumbItem = {
	label: string;
	href?: string;
	current?: boolean;
};

export function getBreadcrumbItems(pathname: string): BreadcrumbItem[] {
	if (pathname.startsWith("/projects/")) {
		const [, , projectId, stepKey] = pathname.split("/");
		const items: BreadcrumbItem[] = [
			{ label: APP_ROUTES.projects.label, href: APP_ROUTES.projects.href },
			{
				label: getProjectFixture(projectId)?.name ?? "Dự án",
				href: `/projects/${projectId}`,
			},
		];

		if (stepKey) {
			items.push({
				label: getProjectStep(stepKey)?.label ?? "Bước project",
				current: true,
			});
		} else {
			items[items.length - 1].current = true;
		}

		return items;
	}

	const route = getAppRouteFromPathname(pathname);
	return route
		? [{ label: route.label, href: route.href, current: true }]
		: [{ label: "Trang không tìm thấy", current: true }];
}
