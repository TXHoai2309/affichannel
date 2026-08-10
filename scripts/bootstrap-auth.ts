import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), "apps/web/.env") });

const confirmation = process.env.AUTH_BOOTSTRAP_CONFIRM;
const email = process.env.AUTH_BOOTSTRAP_EMAIL?.trim();
const name = process.env.AUTH_BOOTSTRAP_NAME?.trim();
const password = process.env.AUTH_BOOTSTRAP_PASSWORD;

if (process.env.NODE_ENV === "production") {
	throw new Error(
		"Auth bootstrap is only allowed in a non-production environment.",
	);
}

if (confirmation !== "CREATE_FIXED_ACCOUNT") {
	throw new Error(
		"Set AUTH_BOOTSTRAP_CONFIRM=CREATE_FIXED_ACCOUNT to create a fixed account.",
	);
}

if (!email || !name || !password) {
	throw new Error(
		"AUTH_BOOTSTRAP_EMAIL, AUTH_BOOTSTRAP_NAME and AUTH_BOOTSTRAP_PASSWORD are required.",
	);
}

const { createAuth } = await import("@affichannel/auth");
const auth = createAuth({ allowSignUp: true });

await auth.api.signUpEmail({
	body: {
		email,
		name,
		password,
	},
});

console.log(`Fixed account created for ${email}.`);
