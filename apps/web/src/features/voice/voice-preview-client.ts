export class VoicePreviewClientError extends Error {
	readonly code: string;

	constructor(code: string) {
		super(code);
		this.name = "VoicePreviewClientError";
		this.code = code;
	}
}

function normalizeContentType(value: string | null) {
	return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function responseCode(response: Response) {
	try {
		const payload: unknown = await response.json();
		if (
			typeof payload === "object" &&
			payload !== null &&
			"code" in payload &&
			typeof payload.code === "string"
		) {
			return payload.code;
		}
	} catch {
		// The client only needs a safe generic code when the response is not JSON.
	}
	return response.status >= 500 ? "TTS_PREVIEW_FAILED" : "BAD_REQUEST";
}

export async function requestVoicePreview(
	projectId: string,
	fetchImplementation: typeof fetch = fetch,
	signal?: AbortSignal,
) {
	const response = await fetchImplementation(
		`/api/projects/${encodeURIComponent(projectId)}/voice/preview`,
		{
			method: "POST",
			credentials: "include",
			headers: { Accept: "audio/mpeg" },
			signal,
		},
	);
	if (!response.ok) {
		throw new VoicePreviewClientError(await responseCode(response));
	}
	if (
		normalizeContentType(response.headers.get("content-type")) !== "audio/mpeg"
	) {
		throw new VoicePreviewClientError("TTS_PREVIEW_FAILED");
	}
	const audio = await response.arrayBuffer();
	if (audio.byteLength === 0) {
		throw new VoicePreviewClientError("TTS_PREVIEW_FAILED");
	}
	return new Blob([audio], { type: "audio/mpeg" });
}
