import { Button } from "@affichannel/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@affichannel/ui/components/dropdown-menu";
import { Skeleton } from "@affichannel/ui/components/skeleton";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export default function UserMenu() {
	const router = useRouter();
	const { data: session, isPending } = authClient.useSession();
	const [isSigningOut, setIsSigningOut] = useState(false);

	if (isPending) {
		return <Skeleton className="h-9 w-24" />;
	}

	if (!session) {
		return (
			<Link href="/login">
				<Button variant="outline">Đăng nhập</Button>
			</Link>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="outline" />}>
				{session.user.name}
			</DropdownMenuTrigger>
			<DropdownMenuContent className="bg-card">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Tài khoản</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem>{session.user.email}</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						onClick={async () => {
							setIsSigningOut(true);
							try {
								await authClient.signOut({
									fetchOptions: {
										onSuccess: () => {
											router.replace("/login");
											router.refresh();
										},
										onError: () => {
											setIsSigningOut(false);
											toast.error("Không thể đăng xuất. Vui lòng thử lại.");
										},
									},
								});
							} catch {
								setIsSigningOut(false);
								toast.error("Không thể đăng xuất. Vui lòng thử lại.");
							}
						}}
					>
						{isSigningOut ? "Đang đăng xuất..." : "Đăng xuất"}
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
