import type { LucideIcon } from "lucide-react";
import {
	BarChart3,
	CalendarDays,
	FolderKanban,
	Images,
	LayoutDashboard,
	PackageOpen,
	Settings2,
	WalletCards,
} from "lucide-react";

export type AppRouteKey =
	| "dashboard"
	| "projects"
	| "calendar"
	| "products"
	| "media"
	| "analytics"
	| "usage"
	| "settings";

export type FeatureStatus = "available" | "skeleton";

export type AppRoute = {
	key: AppRouteKey;
	label: string;
	title: string;
	description: string;
	href: string;
	icon: LucideIcon;
	featureStatus: FeatureStatus;
};

export const APP_ROUTES: Record<AppRouteKey, AppRoute> = {
	dashboard: {
		key: "dashboard",
		label: "Dashboard",
		title: "Tổng quan",
		description:
			"Theo dõi dự án, sản phẩm và các bước sản xuất affiliate từ đây.",
		href: "/dashboard",
		icon: LayoutDashboard,
		featureStatus: "available",
	},
	projects: {
		key: "projects",
		label: "Dự án",
		title: "Dự án",
		description:
			"Theo dõi các chiến dịch affiliate từ sản phẩm đến nội dung hoàn chỉnh.",
		href: "/projects",
		icon: FolderKanban,
		featureStatus: "skeleton",
	},
	calendar: {
		key: "calendar",
		label: "Calendar",
		title: "Content Calendar",
		description: "Lập kế hoạch nội dung 7 ngày theo Channel Strategy.",
		href: "/calendar",
		icon: CalendarDays,
		featureStatus: "available",
	},
	products: {
		key: "products",
		label: "Sản phẩm",
		title: "Sản phẩm",
		description:
			"Quản lý sản phẩm, Product Facts và thông tin nguồn để tái sử dụng trong các dự án affiliate.",
		href: "/products",
		icon: PackageOpen,
		featureStatus: "available",
	},
	media: {
		key: "media",
		label: "Media Library",
		title: "Thư viện media",
		description: "Quản lý media đã tải lên và asset được dùng trong video.",
		href: "/media",
		icon: Images,
		featureStatus: "skeleton",
	},
	analytics: {
		key: "analytics",
		label: "Analytics",
		title: "Phân tích",
		description:
			"Theo dõi hiệu quả nội dung và chi phí khi dữ liệu workflow hoàn thiện.",
		href: "/analytics",
		icon: BarChart3,
		featureStatus: "available",
	},
	usage: {
		key: "usage",
		label: "Chi phí & Usage",
		title: "Chi phí & sử dụng",
		description:
			"Theo dõi usage, ước tính và chi phí provider trong các workflow có tính phí.",
		href: "/usage",
		icon: WalletCards,
		featureStatus: "available",
	},
	settings: {
		key: "settings",
		label: "Cài đặt",
		title: "Cài đặt",
		description:
			"Thiết lập workspace và các mặc định tái sử dụng cho AffiChannel.",
		href: "/settings",
		icon: Settings2,
		featureStatus: "available",
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
