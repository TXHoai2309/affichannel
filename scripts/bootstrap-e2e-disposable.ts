import { randomUUID } from "node:crypto";

export const E2E_AUTH_EMAIL = "affichannel-cr-c-e2e@example.test";
export const E2E_AUTH_PASSWORD = "AffiChannel-CR-C-E2E-Only-2026!";
export const E2E_AUTH_NAME = "AffiChannel CR-C E2E";

export async function ensureDisposableE2EAccount(): Promise<{
	readonly email: string;
	readonly password: string;
	readonly userId: string;
	readonly workspaceId: string;
}> {
	if (
		process.env.AFFICHANNEL_ISOLATED_TEST_ENV !== "1" ||
		process.env.NODE_ENV === "production"
	) {
		throw new Error(
			"REFUSED: disposable E2E account bootstrap requires isolated non-production mode.",
		);
	}

	const { createAuth } = await import("@affichannel/auth");
	const { db, user, workspace, workspaceMember } = await import(
		"@affichannel/db"
	);
	const { eq } = await import("drizzle-orm");
	const { INTERNAL_WORKSPACE_ID } = await import("@affichannel/core/workspace");
	const email = process.env.E2E_AUTH_EMAIL ?? E2E_AUTH_EMAIL;
	const password = process.env.E2E_AUTH_PASSWORD ?? E2E_AUTH_PASSWORD;
	const name = E2E_AUTH_NAME;

	let [fixedUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	if (!fixedUser) {
		const auth = createAuth({ allowSignUp: true });
		await auth.api.signUpEmail({ body: { email, name, password } });
		[fixedUser] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email))
			.limit(1);
	}
	if (!fixedUser) {
		throw new Error("Disposable E2E account bootstrap did not create a user.");
	}

	await db
		.insert(workspace)
		.values({ id: INTERNAL_WORKSPACE_ID, name: "AffiChannel Internal" })
		.onConflictDoNothing();
	await db
		.insert(workspaceMember)
		.values({
			id: randomUUID(),
			workspaceId: INTERNAL_WORKSPACE_ID,
			userId: fixedUser.id,
		})
		.onConflictDoNothing();

	return {
		email,
		password,
		userId: fixedUser.id,
		workspaceId: INTERNAL_WORKSPACE_ID,
	};
}
