import type { VoicePreset } from "./catalog";

export type VoiceConfig = {
	id: string;
	workspaceId: string;
	projectId: string;
	provider: string;
	voiceId: string;
	language: string;
	speed: number;
	revision: number;
	createdBy: string;
	updatedBy: string;
	createdAt: Date;
	updatedAt: Date;
};

export type VoiceCatalog = {
	provider: string;
	presets: VoicePreset[];
};
