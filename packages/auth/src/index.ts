import { createDb } from "@affichannel/db";
import * as schema from "@affichannel/db/schema/auth";
import { env } from "@affichannel/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

export type AuthFactoryOptions = {
	/**
	 * Only used by the local fixed-account bootstrap script. The production
	 * singleton always keeps public sign-up disabled.
	 */
	allowSignUp?: boolean;
};

export function createAuth(options: AuthFactoryOptions = {}) {
	const db = createDb();
	const allowSignUpForBootstrap =
		options.allowSignUp === true && env.NODE_ENV !== "production";

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",

			schema: schema,
		}),
		trustedOrigins: [env.CORS_ORIGIN],
		emailAndPassword: {
			enabled: true,
			disableSignUp: !allowSignUpForBootstrap,
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		plugins: [nextCookies()],
	});
}

export const auth = createAuth();
