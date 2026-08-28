import {
	E2E_TEST_DATABASE_CONFIRMATION,
	requireE2ETestDatabaseAuthority,
} from "./e2e-test-database-authority.ts";

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

function expectRefused(label: string, environment: NodeJS.ProcessEnv): void {
	try {
		requireE2ETestDatabaseAuthority(environment);
	} catch (error) {
		assert(
			error instanceof Error && error.message.startsWith("REFUSED:"),
			`${label} must fail closed with a sanitized REFUSED error.`,
		);
		console.log(`${label}: REFUSED`);
		return;
	}
	throw new Error(`${label} must be refused.`);
}

const disposableUrl = "postgresql://user:password@127.0.0.1:5433/e2e_test";
expectRefused("Missing E2E test authority", {});
expectRefused("Application DATABASE_URL fallback", {
	DATABASE_URL: disposableUrl,
});
expectRefused("Direct application DATABASE_URL fallback", {
	DATABASE_URL_DIRECT: disposableUrl,
});
expectRefused("Remote database host", {
	AFFICHANNEL_E2E_TEST_DATABASE_URL:
		"postgresql://user:password@db.example.com:5432/e2e_test",
	AFFICHANNEL_E2E_TEST_DATABASE_CONFIRM: E2E_TEST_DATABASE_CONFIRMATION,
});
expectRefused("Local hostname ambiguity", {
	AFFICHANNEL_E2E_TEST_DATABASE_URL:
		"postgresql://user:password@localhost:5433/e2e_test",
	AFFICHANNEL_E2E_TEST_DATABASE_CONFIRM: E2E_TEST_DATABASE_CONFIRMATION,
});
expectRefused("Missing E2E test confirmation", {
	AFFICHANNEL_E2E_TEST_DATABASE_URL: disposableUrl,
});
expectRefused("Wrong E2E test confirmation", {
	AFFICHANNEL_E2E_TEST_DATABASE_URL: disposableUrl,
	AFFICHANNEL_E2E_TEST_DATABASE_CONFIRM: "WRONG",
});

const authority = requireE2ETestDatabaseAuthority({
	AFFICHANNEL_E2E_TEST_DATABASE_URL: disposableUrl,
	AFFICHANNEL_E2E_TEST_DATABASE_CONFIRM: E2E_TEST_DATABASE_CONFIRMATION,
});
assert(authority.host === "127.0.0.1:5433", "Loopback host must be preserved.");
assert(authority.database === "e2e_test", "Database name must be parsed.");
console.log("Explicit E2E disposable authority: ACCEPTED");
