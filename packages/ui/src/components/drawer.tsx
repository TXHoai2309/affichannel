"use client";

import { cn } from "@affichannel/ui/lib/utils";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";

function Drawer({ ...props }: DrawerPrimitive.Root.Props) {
	return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
	return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({ ...props }: DrawerPrimitive.Portal.Props) {
	return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerBackdrop({
	className,
	...props
}: DrawerPrimitive.Backdrop.Props) {
	return (
		<DrawerPrimitive.Backdrop
			data-slot="drawer-backdrop"
			className={cn(
				"fixed inset-0 z-50 bg-black/40 transition-opacity data-closed:opacity-0 data-open:opacity-100",
				className,
			)}
			{...props}
		/>
	);
}

function DrawerPopup({ className, ...props }: DrawerPrimitive.Popup.Props) {
	return (
		<DrawerPrimitive.Popup
			data-slot="drawer-popup"
			className={cn(
				"fixed top-0 right-0 z-50 flex h-full w-[min(24rem,calc(100%-1rem))] flex-col rounded-l-2xl border-l bg-background p-6 shadow-lg outline-none data-closed:translate-x-full data-open:translate-x-0",
				className,
			)}
			{...props}
		/>
	);
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
	return (
		<DrawerPrimitive.Title
			data-slot="drawer-title"
			className={cn("font-semibold text-lg", className)}
			{...props}
		/>
	);
}

function DrawerDescription({
	className,
	...props
}: DrawerPrimitive.Description.Props) {
	return (
		<DrawerPrimitive.Description
			data-slot="drawer-description"
			className={cn("mt-2 text-muted-foreground text-sm", className)}
			{...props}
		/>
	);
}

function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
	return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

export {
	Drawer,
	DrawerBackdrop,
	DrawerClose,
	DrawerDescription,
	DrawerPopup,
	DrawerPortal,
	DrawerTitle,
	DrawerTrigger,
};
