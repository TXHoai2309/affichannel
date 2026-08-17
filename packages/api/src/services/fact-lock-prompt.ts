import {
	FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	type FactLockInputSnapshot,
} from "@affichannel/core/fact-lock/types";
import { canonicalizeJson } from "@affichannel/core/script-generation/canonical-json";

export function renderFactLockPrompt(snapshot: FactLockInputSnapshot) {
	return {
		trustedInstructions: [
			"Bạn là Fact Lock classifier cho AffiChannel.",
			"Chỉ phân tích claim được trích nguyên văn từ occurrence trong ScriptVersion snapshot.",
			"Chỉ map tới Product Fact có trong snapshot; không được tự tạo factId, revision hoặc reviewStatus.",
			"Không suy diễn thêm dữ liệu ngoài input. Trả về JSON đúng schema, không markdown.",
		].join("\n"),
		outputSchema: [
			`Output schema ${FACT_LOCK_OUTPUT_SCHEMA_VERSION}. Root có đúng {schemaVersion, claims}.`,
			"Mỗi claim có claimKey, claimText, occurrence, classificationStatus, reason, confidence, suggestionText, factMappings.",
			"classificationStatus chỉ là SUPPORTED, NEEDS_REVIEW, UNSUPPORTED hoặc PROHIBITED.",
			"factMappings dùng relation supports, contradicts hoặc context.",
			"Không trả về reviewStatus, checkedAt hoặc factRevision; server sẽ tự suy ra.",
		].join("\n"),
		untrustedInputData: canonicalizeJson(snapshot),
	};
}
