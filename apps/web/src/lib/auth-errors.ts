export const INVALID_CREDENTIALS_MESSAGE = "Email hoặc mật khẩu không đúng.";

/**
 * Provider errors are intentionally not exposed in the browser. This keeps
 * credential, database and adapter details out of the UI and logs.
 */
export function getSafeAuthErrorMessage(_error: unknown): string {
	return INVALID_CREDENTIALS_MESSAGE;
}
