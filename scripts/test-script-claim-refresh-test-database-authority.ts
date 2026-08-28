import { requireScriptClaimRefreshTestDatabaseAuthority } from "./script-claim-refresh-test-database-authority.ts";

const authorityEnvNames = [
	"AFFICHANNEL_SCRIPT_CLAIM_REFRESH_TEST_DATABASE_URL",
	"AFFICHANNEL_SCRIPT_CLAIM_REFRESH_TEST_DATABASE_CONFIRM",
	"AFFICHANNEL_BACKFILL_DATABASE_URL",
	"AFFICHANNEL_BACKFILL_DATABASE_CONFIRM",
	"DATABASE_URL",
	"DATABASE_URL_DIRECT",
	"AFFICHANNEL_M1_TEST_DATABASE_URL",
	"AFFICHANNEL_M1_TEST_DATABASE_CONFIRM",
] as const;

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

function withEnvironment(
	values: Record<string, string | undefined>,
): () => void {
	const previous = new Map(
		authorityEnvNames.map((name) => [name, process.env[name]]),
	);
	for (const name of authorityEnvNames)
		Reflect.deleteProperty(process.env, name);
	for (const [name, value] of Object.entries(values)) {
		if (value === undefined) Reflect.deleteProperty(process.env, name);
		else process.env[name] = value;
	}
	return () => {
		for (const name of authorityEnvNames)
			Reflect.deleteProperty(process.env, name);
		for (const [name, value] of previous) {
			if (value === undefined) Reflect.deleteProperty(process.env, name);
			else process.env[name] = value;
		}
	};
}

function expectRefused(label: string, values: Record<string, string>): void {
	const restore = withEnvironment(values);
	try {
		try {
			requireScriptClaimRefreshTestDatabaseAuthority();
		} catch (error) {
			assert(
				error instanceof Error && error.message.startsWith("REFUSED:"),
				`${label} must fail with a sanitized REFUSED error.`,
			);
			console.log(`${label}: REFUSED`);
			return;
		}
		throw new Error(`${label} must be refused.`);
	} finally {
		restore();
	}
}

const disposableUrl = "postgresql://127.0.0.1:5433/cr_a_validation";
expectRefused("Missing CR-A test authority", {});
expectRefused("Application DATABASE_URL fallback", {
	DATABASE_URL: disposableUrl,
});
expectRefused("Direct application DATABASE_URL fallback", {
	DATABASE_URL_DIRECT: disposableUrl,
});
expectRefused("M1 test authority fallback", {
	AFFICHANNEL_M1_TEST_DATABASE_URL: disposableUrl,
});
expectRefused("Backfill authority fallback", {
	AFFICHANNEL_BACKFILL_DATABASE_URL: disposableUrl,
});
expectRefused("Missing CR-A test confirmation", {
	AFFICHANNEL_SCRIPT_CLAIM_REFRESH_TEST_DATABASE_URL: disposableUrl,
});
expectRefused("Wrong CR-A test confirmation", {
	AFFICHANNEL_SCRIPT_CLAIM_REFRESH_TEST_DATABASE_URL: disposableUrl,
	AFFICHANNEL_SCRIPT_CLAIM_REFRESH_TEST_DATABASE_CONFIRM: "WRONG",
});

const restore = withEnvironment({
	AFFICHANNEL_SCRIPT_CLAIM_REFRESH_TEST_DATABASE_URL: disposableUrl,
	AFFICHANNEL_SCRIPT_CLAIM_REFRESH_TEST_DATABASE_CONFIRM:
		"DISPOSABLE_SCRIPT_CLAIM_REFRESH_TEST_DB_CONFIRMED",
});
try {
	const authority = requireScriptClaimRefreshTestDatabaseAuthority();
	assert(
		authority.database === "cr_a_validation",
		"Valid CR-A authority must parse database name.",
	);
	console.log("Explicit CR-A disposable test authority: ACCEPTED");
} finally {
	restore();
}
