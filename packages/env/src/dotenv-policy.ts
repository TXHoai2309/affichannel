export function shouldLoadLocalDotenv(
	environment:
		| NodeJS.ProcessEnv
		| { AFFICHANNEL_ISOLATED_TEST_ENV?: string } = process.env,
): boolean {
	return environment.AFFICHANNEL_ISOLATED_TEST_ENV !== "1";
}
