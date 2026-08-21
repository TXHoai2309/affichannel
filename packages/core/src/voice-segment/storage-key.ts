import { VoiceSegmentError } from "./errors";

const STORAGE_KEY_PREFIX = "voice/v1";

function trustedToken(value: string, field: string) {
	if (!/^[A-Za-z0-9_-]+$/.test(value) || value === "." || value === "..") {
		throw new VoiceSegmentError(
			"VOICE_SEGMENT_STORAGE_KEY_INVALID",
			`${field} cannot be used in a storage key.`,
		);
	}
}

export function createVoiceAudioStorageKey(input: {
	workspaceId: string;
	projectId: string;
	artifactId: string;
}) {
	trustedToken(input.workspaceId, "workspaceId");
	trustedToken(input.projectId, "projectId");
	trustedToken(input.artifactId, "artifactId");
	return `${STORAGE_KEY_PREFIX}/${input.workspaceId}/${input.projectId}/${input.artifactId}.mp3`;
}

export function assertSafeVoiceAudioStorageKey(storageKey: string) {
	const parts = storageKey.split("/");
	if (
		parts.length !== 5 ||
		parts[0] !== "voice" ||
		parts[1] !== "v1" ||
		parts[4]?.endsWith(".mp3") !== true ||
		storageKey.includes("\\") ||
		parts.some((part) => part === "" || part === "." || part === "..")
	) {
		throw new VoiceSegmentError(
			"VOICE_SEGMENT_STORAGE_KEY_INVALID",
			"Voice audio storage key is invalid.",
		);
	}
	for (const [index, part] of parts.entries()) {
		if (index === 4) {
			trustedToken(part.slice(0, -4), "artifactId");
		} else if (index > 1) {
			trustedToken(part, index === 2 ? "workspaceId" : "projectId");
		}
	}
	return storageKey;
}
