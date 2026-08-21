import {
	FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	type FactLockInputSnapshot,
} from "@affichannel/core/fact-lock/types";
import { canonicalizeJson } from "@affichannel/core/script-generation/canonical-json";

export function renderFactLockPrompt(snapshot: FactLockInputSnapshot) {
	return {
		trustedInstructions: [
			"Bạn là Fact Lock classifier cho AffiChannel.",
			"Tìm các factual/verifiable propositions trong selected hook, voiceover, scene onScreenText, CTA và caption hiện tại.",
			"claims không phải là danh sách mọi câu hoặc mọi candidate; nếu một occurrence chỉ là editorial, lời mở đầu, lời dẫn, chào hỏi hoặc không chứa proposition có thể kiểm chứng thì bỏ qua và không tạo claim item.",
			"Không trả về claim item với classification UNSUPPORTED chỉ để đại diện cho câu non-factual. Không có classification NON_FACTUAL trong output; câu non-factual phải được omit.",
			"Nếu một câu chứa cả lời dẫn và factual proposition, chỉ trích phần factual proposition liên tục, nguyên văn; không dùng toàn bộ câu làm claimText.",
			"Với hook, chỉ phân tích hook có key bằng scriptVersion.snapshot.selectedHookKey; bỏ qua các hook variant khác.",
			"scriptVersion.snapshot.claims là metadata cũ có thể stale; tuyệt đối không sao chép hoặc dùng nó làm nguồn claim. Hãy tạo lại claims từ nội dung script hiện tại.",
			"claimText phải là một đoạn trích nguyên văn, liên tục trong đúng occurrence đã chỉ định.",
			"Chỉ map tới Product Fact có trong snapshot; không được tự tạo factId, revision hoặc reviewStatus.",
			"Không suy diễn thêm dữ liệu ngoài input. Trả về đúng một JSON object, không prose và không markdown.",
		].join("\n"),
		outputSchema: [
			`Root strict: {"schemaVersion":"${FACT_LOCK_OUTPUT_SCHEMA_VERSION}","claims":[...]}; không thêm key khác. claims có tối đa 64 factual claims và claimKey phải duy nhất. claims có thể là [] nếu không có factual proposition.`,
			"Mỗi claim strict có đúng claimKey:string, claimText:string, occurrence:object, classificationStatus:string, reason:string, confidence:number 0..1 hoặc null, suggestionText:string hoặc null, factMappings:array.",
			'occurrence strict chỉ là một trong: {"section":"hook","hookKey":string}, {"section":"voiceover","segmentKey":string}, {"section":"scene","sceneOrder":positive integer}, {"section":"cta"}, {"section":"caption"}.',
			"classificationStatus chỉ là SUPPORTED, NEEDS_REVIEW, UNSUPPORTED hoặc PROHIBITED.",
			"Mỗi factMappings item strict có đúng factId và relation; relation chỉ là supports, related hoặc contradicts; các cặp factId+relation phải duy nhất.",
			"SUPPORTED phải có ít nhất một mapping supports. UNSUPPORTED không được có mapping supports.",
			"Không trả về reviewStatus, checkedAt hoặc fact revision; server sẽ pin revision trên từng mapping.",
		].join("\n"),
		untrustedInputData: canonicalizeJson(snapshot),
	};
}
