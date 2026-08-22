import "@affichannel/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Keep Playwright's deterministic server output isolated from any local
	// Next dev server that may have a different bundler/cache state.
	distDir:
		process.env.AFFICHANNEL_E2E_TTS_DETERMINISTIC === "1"
			? ".next-e2e"
			: ".next",
	typedRoutes: true,
	reactCompiler: process.env.AFFICHANNEL_E2E_TTS_DETERMINISTIC !== "1",
};

export default nextConfig;
