import { shouldLoadLocalDotenv } from "../packages/env/src/dotenv-policy.ts";

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

assert(
	shouldLoadLocalDotenv({}),
	"Normal application mode must retain local dotenv loading.",
);
assert(
	shouldLoadLocalDotenv({ AFFICHANNEL_ISOLATED_TEST_ENV: "0" }),
	"Only exact isolated value 1 may disable local dotenv loading.",
);
assert(
	!shouldLoadLocalDotenv({ AFFICHANNEL_ISOLATED_TEST_ENV: "1" }),
	"Isolated test mode must disable local dotenv loading.",
);
console.log("Isolated dotenv policy: PASS");
