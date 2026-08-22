import { cn } from "@affichannel/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import type * as React from "react";

function Breadcrumb({ className, ...props }: React.ComponentProps<"nav">) {
	return <nav aria-label="Breadcrumb" className={cn(className)} {...props} />;
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
	return (
		<ol
			data-slot="breadcrumb-list"
			className={cn(
				"flex flex-wrap items-center gap-1.5 text-muted-foreground text-sm",
				className,
			)}
			{...props}
		/>
	);
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="breadcrumb-item"
			className={cn("inline-flex items-center gap-1.5", className)}
			{...props}
		/>
	);
}

function BreadcrumbSeparator({
	className,
	...props
}: React.ComponentProps<"li">) {
	return (
		<li
			aria-hidden="true"
			data-slot="breadcrumb-separator"
			className={cn("text-muted-foreground/60", className)}
			{...props}
		>
			<ChevronRight className="size-3.5" />
		</li>
	);
}

function BreadcrumbLink({ className, ...props }: React.ComponentProps<"a">) {
	return (
		<a
			data-slot="breadcrumb-link"
			className={cn("transition-colors hover:text-foreground", className)}
			{...props}
		/>
	);
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			aria-current="page"
			data-slot="breadcrumb-page"
			className={cn("font-medium text-foreground", className)}
			{...props}
		/>
	);
}

export {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
};
