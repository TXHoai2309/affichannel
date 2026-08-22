import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({
	path: resolve(process.cwd(), "apps/web/.env"),
	override: true,
});

const confirmation = process.env.AUTH_BOOTSTRAP_CONFIRM;
const email = process.env.AUTH_BOOTSTRAP_EMAIL?.trim();
const name = process.env.AUTH_BOOTSTRAP_NAME?.trim();
const password = process.env.AUTH_BOOTSTRAP_PASSWORD;

if (process.env.NODE_ENV === "production") {
	throw new Error(
		"Auth bootstrap is only allowed in a non-production environment.",
	);
}

if (!email) {
	throw new Error("AUTH_BOOTSTRAP_EMAIL is required.");
}

const { db, user, workspace, workspaceMember } = await import(
	"@affichannel/db"
);
const { INTERNAL_WORKSPACE_ID } = await import("@affichannel/core/workspace");
const { eq } = await import("drizzle-orm");
const [existingUser] = await db
	.select({ id: user.id })
	.from(user)
	.where(eq(user.email, email))
	.limit(1);

if (!existingUser) {
	if (confirmation !== "CREATE_FIXED_ACCOUNT") {
		throw new Error(
			"Set AUTH_BOOTSTRAP_CONFIRM=CREATE_FIXED_ACCOUNT to create a fixed account.",
		);
	}

	if (!name || !password) {
		throw new Error(
			"AUTH_BOOTSTRAP_NAME and AUTH_BOOTSTRAP_PASSWORD are required to create an account.",
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
}

const [fixedUser] = await db
	.select({ id: user.id })
	.from(user)
	.where(eq(user.email, email))
	.limit(1);

if (!fixedUser) {
	throw new Error("The fixed account could not be found after bootstrap.");
}

await db
	.insert(workspace)
	.values({
		id: INTERNAL_WORKSPACE_ID,
		name: "AffiChannel Internal",
	})
	.onConflictDoNothing();

await db
	.insert(workspaceMember)
	.values({
		id: randomUUID(),
		workspaceId: INTERNAL_WORKSPACE_ID,
		userId: fixedUser.id,
	})
	.onConflictDoNothing();

console.log(`Fixed account and internal workspace ensured for ${email}.`);
