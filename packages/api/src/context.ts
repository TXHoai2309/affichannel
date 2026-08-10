import { auth } from "@affichannel/auth";

export async function createContext(req: Request) {
	const session = await auth.api.getSession({
		headers: req.headers,
	});
	return {
		auth: null,
		session,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
