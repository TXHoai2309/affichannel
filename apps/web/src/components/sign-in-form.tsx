import { Button } from "@affichannel/ui/components/button";
import { Input } from "@affichannel/ui/components/input";
import { Label } from "@affichannel/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { getSafeAuthErrorMessage } from "@/lib/auth-errors";

import Loader from "./loader";

export default function SignInForm() {
	const router = useRouter();
	const { data: session, isPending } = authClient.useSession();
	const [authError, setAuthError] = useState<string | null>(null);

	useEffect(() => {
		if (session?.user) {
			router.replace("/dashboard");
		}
	}, [router, session]);

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
		},
		onSubmit: async ({ value }) => {
			setAuthError(null);

			const handleAuthError = (error: unknown) => {
				const message = getSafeAuthErrorMessage(error);
				setAuthError(message);
				toast.error(message);
			};

			try {
				await authClient.signIn.email(
					{
						email: value.email,
						password: value.password,
					},
					{
						onSuccess: () => {
							router.replace("/dashboard");
							router.refresh();
							toast.success("Đăng nhập thành công");
						},
						onError: handleAuthError,
					},
				);
			} catch (error) {
				handleAuthError(error);
			}
		},
			validators: {
				onSubmit: z.object({
					email: z.email("Email không hợp lệ"),
					password: z.string().min(8, "Mật khẩu phải có ít nhất 8 ký tự"),
				}),
			},
	});

	if (isPending || session?.user) {
		return <Loader />;
	}

	return (
		<div className="mx-auto mt-10 w-full max-w-md p-6">
			<h1 className="mb-2 text-center font-bold text-3xl">Đăng nhập</h1>
			<p className="mb-6 text-center text-muted-foreground">
				Dùng tài khoản thành viên cố định để truy cập AffiChannel.
			</p>

			{authError ? (
				<p
					className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-700 text-sm"
					role="alert"
				>
					{authError}
				</p>
			) : null}

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					form.handleSubmit();
				}}
				className="space-y-4"
			>
				<div>
					<form.Field name="email">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Email</Label>
								<Input
									id={field.name}
									name={field.name}
									type="email"
									autoComplete="email"
									aria-invalid={
										field.state.meta.isTouched &&
										field.state.meta.errors.length > 0
									}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-red-500">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>
				</div>

				<div>
					<form.Field name="password">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Mật khẩu</Label>
								<Input
									id={field.name}
									name={field.name}
									type="password"
									autoComplete="current-password"
									aria-invalid={
										field.state.meta.isTouched &&
										field.state.meta.errors.length > 0
									}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-red-500">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>
				</div>

				<form.Subscribe
					selector={(state) => ({
						canSubmit: state.canSubmit,
						isSubmitting: state.isSubmitting,
					})}
				>
					{({ canSubmit, isSubmitting }) => (
						<Button
							type="submit"
							className="w-full"
							disabled={!canSubmit || isSubmitting}
						>
							{isSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}
						</Button>
					)}
				</form.Subscribe>
			</form>
		</div>
	);
}
