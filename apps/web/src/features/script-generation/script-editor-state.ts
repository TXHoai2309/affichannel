import type { ScriptVersionEditableSnapshot } from "@affichannel/core";

export function selectScriptHook(
	snapshot: ScriptVersionEditableSnapshot,
	hookKey: string,
): ScriptVersionEditableSnapshot {
	if (snapshot.selectedHookKey === hookKey) return snapshot;
	if (!snapshot.hookVariants.some((hook) => hook.key === hookKey)) {
		return snapshot;
	}
	return { ...snapshot, selectedHookKey: hookKey };
}

export function getSelectedHookKeys(snapshot: ScriptVersionEditableSnapshot) {
	return snapshot.hookVariants
		.filter((hook) => hook.key === snapshot.selectedHookKey)
		.map((hook) => hook.key);
}
