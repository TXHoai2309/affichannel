import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SESSION_COOKIE_NAMES = [
	"better-auth.session_token",
	"__Secure-better-auth.session_token",
];

/**
 * Optimistic navigation guard only. The dashboard page and protected oRPC
 * procedures still validate the session server-side.
 */
export function proxy(request: NextRequest) {
	const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) =>
		request.cookies.has(name),
	);

	if (!hasSessionCookie) {
		return NextResponse.redirect(new URL("/login", request.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: [
		"/dashboard/:path*",
		"/projects/:path*",
		"/products/:path*",
		"/media/:path*",
		"/analytics/:path*",
		"/usage/:path*",
		"/settings/:path*",
	],
};
