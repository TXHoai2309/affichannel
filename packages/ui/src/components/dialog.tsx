"use client";

import { cn } from "@affichannel/ui/lib/utils";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogBackdrop({
	className,
	...props
}: DialogPrimitive.Backdrop.Props) {
	return (
		<DialogPrimitive.Backdrop
			data-slot="dialog-backdrop"
			className={cn(
				"fixed inset-0 z-50 bg-black/40 transition-opacity data-closed:opacity-0 data-open:opacity-100",
				className,
			)}
			{...props}
		/>
	);
}

function DialogPopup({ className, ...props }: DialogPrimitive.Popup.Props) {
	return (
		<DialogPrimitive.Popup
			data-slot="dialog-popup"
			className={cn(
				"data-closed:fade-out-0 data-closed:zoom-out-95 data-open:fade-in-0 data-open:zoom-in-95 fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg outline-none data-closed:animate-out data-open:animate-in",
				className,
			)}
			{...props}
		/>
	);
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn("font-semibold text-lg", className)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn("mt-2 text-muted-foreground text-sm", className)}
			{...props}
		/>
	);
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

export {
	Dialog,
	DialogBackdrop,
	DialogClose,
	DialogDescription,
	DialogPopup,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
