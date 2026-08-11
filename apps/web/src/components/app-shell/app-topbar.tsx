"use client";

import { Button } from "@affichannel/ui/components/button";
import {
	Drawer,
	DrawerBackdrop,
	DrawerClose,
	DrawerDescription,
	DrawerPopup,
	DrawerPortal,
	DrawerTitle,
	DrawerTrigger,
} from "@affichannel/ui/components/drawer";
import { Bell, BriefcaseBusiness, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

import { getAppTopbarContext } from "@/config/routes";

import UserMenu from "../user-menu";
import AppBreadcrumb from "./app-breadcrumb";

export default function AppTopbar() {
	const pathname = usePathname();
	const pageContext = getAppTopbarContext(pathname);
	const isProjectRoute = pathname.startsWith("/projects/");

	return (
		<header className="flex min-h-24 items-center justify-between gap-4 border-b bg-background px-4 py-3 lg:px-6">
			<div className="min-w-0 flex-1 space-y-0.5">
				<h1 className="truncate font-semibold text-lg tracking-tight">
					{pageContext.title}
				</h1>
				<p className="truncate text-muted-foreground text-sm italic">
					{pageContext.description}
				</p>
				{isProjectRoute ? <AppBreadcrumb /> : null}
			</div>
			<div className="flex items-center gap-2">
				<Drawer>
					<DrawerTrigger
						render={
							<Button variant="outline" size="sm" aria-label="Mở Job Center">
								<BriefcaseBusiness aria-hidden="true" />
								<span className="hidden sm:inline">Job Center</span>
							</Button>
						}
					/>
					<DrawerPortal>
						<DrawerBackdrop />
						<DrawerPopup>
							<div className="flex items-start justify-between gap-4">
								<div>
									<DrawerTitle>Job Center</DrawerTitle>
									<DrawerDescription>
										Theo dõi job dài và retry sẽ được nối ở slice sau.
									</DrawerDescription>
								</div>
								<DrawerClose
									render={
										<Button
											variant="ghost"
											size="icon"
											aria-label="Đóng Job Center"
										>
											<X aria-hidden="true" />
										</Button>
									}
								/>
							</div>
							<div className="mt-8 rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
								Chưa có job đang chạy.
							</div>
						</DrawerPopup>
					</DrawerPortal>
				</Drawer>

				<Button
					variant="outline"
					size="icon"
					aria-label="Thông báo"
					onClick={() =>
						toast.info("Notification Center sẽ được nối ở slice sau.")
					}
				>
					<Bell aria-hidden="true" />
				</Button>

				<UserMenu />
			</div>
		</header>
	);
}
