import type { ClaimOccurrence } from "../script-generation/types";
import { scriptVersionEditableSnapshotSchema } from "../script-version/schema";
import type { ScriptVersionEditableSnapshot } from "../script-version/types";
import { validateScriptVersionForFactLockRun } from "../script-version/validation";
import type { FactLockStoredClaim } from "./types";

export type FactLockSourceMutation =
	| { action: "edit"; newText: string }
	| { action: "delete" }
	| { action: "suggestion"; newText: string };

export type FactLockSourceMutationResult =
	| { success: true; snapshot: ScriptVersionEditableSnapshot }
	| {
			success: false;
			code:
				| "FACT_LOCK_CLAIM_SOURCE_MISMATCH"
				| "FACT_LOCK_CLAIM_DELETE_REQUIRES_EDIT"
				| "FACT_LOCK_EDIT_INVALID";
			message: string;
	  };

function replaceOccurrence(
	snapshot: ScriptVersionEditableSnapshot,
	claim: Pick<FactLockStoredClaim, "claimText" | "occurrence">,
	replacement: string,
) {
	const occurrence = claim.occurrence as ClaimOccurrence;
	let source: string | null | undefined;
	switch (occurrence.section) {
		case "hook":
			source = snapshot.hookVariants.find(
				(item) => item.key === occurrence.hookKey,
			)?.text;
			break;
		case "voiceover":
			source = snapshot.voiceoverSegments.find(
				(item) => item.key === occurrence.segmentKey,
			)?.text;
			break;
		case "scene":
			source = snapshot.scenes.find(
				(item) => item.order === occurrence.sceneOrder,
			)?.onScreenText;
			break;
		case "cta":
			source = snapshot.cta.text;
			break;
		case "caption":
			source = snapshot.caption;
	}
	if (!source) return { ok: false as const, reason: "missing" };
	const firstIndex = source.indexOf(claim.claimText);
	if (firstIndex < 0 || firstIndex !== source.lastIndexOf(claim.claimText))
		return { ok: false as const, reason: "ambiguous" };
	return {
		ok: true as const,
		value: `${source.slice(0, firstIndex)}${replacement}${source.slice(firstIndex + claim.claimText.length)}`,
	};
}

function applyText(
	snapshot: ScriptVersionEditableSnapshot,
	claim: Pick<FactLockStoredClaim, "claimText" | "occurrence">,
	replacement: string,
) {
	const replaced = replaceOccurrence(snapshot, claim, replacement);
	if (!replaced.ok) return replaced;
	const next = structuredClone(snapshot);
	const occurrence = claim.occurrence as ClaimOccurrence;
	if (occurrence.section === "hook") {
		const item = next.hookVariants.find(
			(value) => value.key === occurrence.hookKey,
		);
		if (!item) return { ok: false as const, reason: "missing" };
		item.text = replaced.value;
	} else if (occurrence.section === "voiceover") {
		const item = next.voiceoverSegments.find(
			(value) => value.key === occurrence.segmentKey,
		);
		if (!item) return { ok: false as const, reason: "missing" };
		item.text = replaced.value;
	} else if (occurrence.section === "scene") {
		const item = next.scenes.find(
			(value) => value.order === occurrence.sceneOrder,
		);
		if (!item) return { ok: false as const, reason: "missing" };
		item.onScreenText = replaced.value.trim() || null;
	} else if (occurrence.section === "cta") {
		next.cta.text = replaced.value;
	} else {
		next.caption = replaced.value;
	}
	next.claimsStatus = "stale";
	return { ok: true as const, snapshot: next };
}

export function mutateFactLockClaimSource(
	snapshot: ScriptVersionEditableSnapshot,
	claim: Pick<FactLockStoredClaim, "claimText" | "occurrence">,
	mutation: FactLockSourceMutation,
): FactLockSourceMutationResult {
	const replacement =
		mutation.action === "delete" ? "" : mutation.newText.trim();
	if (mutation.action !== "delete" && !replacement)
		return {
			success: false,
			code: "FACT_LOCK_EDIT_INVALID",
			message: "Nội dung claim mới không được để trống.",
		};
	const result = applyText(snapshot, claim, replacement);
	if (!result.ok) {
		return {
			success: false,
			code:
				mutation.action === "delete"
					? "FACT_LOCK_CLAIM_DELETE_REQUIRES_EDIT"
					: "FACT_LOCK_CLAIM_SOURCE_MISMATCH",
			message:
				mutation.action === "delete"
					? "Không thể xoá an toàn claim này. Hãy sửa trực tiếp trong Script Editor."
					: "Claim không còn khớp duy nhất với nội dung script hiện tại.",
		};
	}
	const parsed = scriptVersionEditableSnapshotSchema.safeParse(result.snapshot);
	if (!parsed.success)
		return {
			success: false,
			code:
				mutation.action === "delete"
					? "FACT_LOCK_CLAIM_DELETE_REQUIRES_EDIT"
					: "FACT_LOCK_EDIT_INVALID",
			message:
				mutation.action === "delete"
					? "Xoá claim sẽ làm script không hợp lệ. Hãy sửa trực tiếp trong Script Editor."
					: "Nội dung mới làm script không hợp lệ.",
		};
	if (mutation.action === "delete") {
		const preRunValidation = validateScriptVersionForFactLockRun(parsed.data);
		if (!preRunValidation.success)
			return {
				success: false,
				code: "FACT_LOCK_CLAIM_DELETE_REQUIRES_EDIT",
				message:
					"Không thể xóa tự động an toàn. Hãy chỉnh sửa đoạn chứa claim.",
			};
	}
	return { success: true, snapshot: parsed.data };
}
