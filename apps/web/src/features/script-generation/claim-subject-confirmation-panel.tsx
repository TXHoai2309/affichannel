"use client";

import type {
	ClaimSubjectKind,
	SubjectAwareScriptClaim,
} from "@affichannel/core/claim-subject/types";
import type { ScriptVersionReadModel } from "@affichannel/core/script-version/types";
import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { useEffect, useMemo, useState } from "react";

export type ClaimSubjectDecision = {
	claimIndex: number;
	subject: ClaimSubjectKind;
};

export function getClaimSubjectLabel(subject: ClaimSubjectKind) {
	return subject === "PRODUCT" ? "Thông tin về sản phẩm" : "Thông tin chung";
}

export function getUnresolvedClaimSubjects(
	scriptVersion: ScriptVersionReadModel,
) {
	return scriptVersion.editableSnapshot.claims.flatMap((claim, claimIndex) => {
		if (
			!("subjectStatus" in claim) ||
			claim.subjectStatus !== "NEEDS_CONFIRMATION"
		) {
			return [];
		}
		const subjectAware = claim as SubjectAwareScriptClaim;
		return [
			{
				claimIndex,
				claim: subjectAware,
				proposedSubject:
					subjectAware.proposedSubject ?? subjectAware.subject.kind,
			},
		];
	});
}

export function buildClaimSubjectDecisions(
	values: Readonly<Record<number, ClaimSubjectKind>>,
): ClaimSubjectDecision[] {
	return Object.entries(values)
		.map(([claimIndex, subject]) => ({
			claimIndex: Number(claimIndex),
			subject,
		}))
		.sort((left, right) => left.claimIndex - right.claimIndex);
}

export default function ClaimSubjectConfirmationPanel({
	scriptVersion,
	onConfirm,
	confirmPending = false,
	notice = null,
}: {
	scriptVersion: ScriptVersionReadModel;
	onConfirm: (decisions: ClaimSubjectDecision[]) => void;
	confirmPending?: boolean;
	notice?: string | null;
}) {
	const unresolved = useMemo(
		() => getUnresolvedClaimSubjects(scriptVersion),
		[scriptVersion],
	);
	const [selections, setSelections] = useState<
		Readonly<Record<number, ClaimSubjectKind>>
	>({});
	const resetKey = `${scriptVersion.id}:${scriptVersion.revision}`;

	useEffect(() => {
		if (resetKey) setSelections({});
	}, [resetKey]);

	if (scriptVersion.editableSnapshot.claimsStatus !== "current") return null;
	if (unresolved.length === 0) return null;

	const allDecided = unresolved.every(
		(item) => selections[item.claimIndex] !== undefined,
	);

	return (
		<Card
			aria-labelledby="claim-subject-confirmation-title"
			className="border-amber-200 bg-amber-50/50 shadow-sm"
			data-testid="claim-subject-confirmation"
		>
			<CardHeader>
				<CardTitle id="claim-subject-confirmation-title">
					Xác nhận phạm vi thông tin
				</CardTitle>
				<p className="text-muted-foreground text-sm">
					Hãy chọn claim đang nói về thông tin chung hay thông tin về sản phẩm.
				</p>
			</CardHeader>
			<CardContent className="space-y-4">
				{unresolved.map((item) => {
					const groupName = `claim-subject-${item.claimIndex}`;
					const selected = selections[item.claimIndex];
					return (
						<fieldset
							className="space-y-3 rounded-xl border bg-background p-4"
							key={item.claimIndex}
						>
							<legend className="max-w-full px-1 font-medium text-sm">
								Claim {item.claimIndex + 1}
							</legend>
							<p className="whitespace-pre-wrap text-sm">{item.claim.text}</p>
							<div className="flex flex-wrap items-center gap-2 text-xs">
								<Badge variant="secondary">Đề xuất từ AI</Badge>
								<span className="text-muted-foreground">
									{getClaimSubjectLabel(item.proposedSubject)}
								</span>
							</div>
							<div
								aria-label={`Chọn phạm vi cho claim ${item.claimIndex + 1}`}
								className="grid gap-2 sm:grid-cols-2"
								role="radiogroup"
							>
								{(["GENERAL", "PRODUCT"] as const).map((subject) => (
									<label
										className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
										key={subject}
									>
										<input
											checked={selected === subject}
											className="mt-1"
											name={groupName}
											type="radio"
											value={subject}
											onChange={() =>
												setSelections((current) => ({
													...current,
													[item.claimIndex]: subject,
												}))
											}
										/>
										<span>
											<span className="block font-medium text-sm">
												{getClaimSubjectLabel(subject)}
											</span>
											<span className="mt-1 block text-muted-foreground text-xs">
												{subject === "PRODUCT"
													? "Claim cần được đối chiếu với sản phẩm đã liên kết."
													: "Claim áp dụng ở phạm vi chung, không gắn sản phẩm."}
											</span>
										</span>
									</label>
								))}
							</div>
						</fieldset>
					);
				})}
				<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
					<p className="text-muted-foreground text-xs">
						{allDecided
							? "Tất cả claim đã có lựa chọn."
							: "Chọn phạm vi cho tất cả claim để tiếp tục."}
					</p>
					<Button
						disabled={!allDecided || confirmPending}
						onClick={() => onConfirm(buildClaimSubjectDecisions(selections))}
						type="button"
					>
						{confirmPending ? "Đang lưu lựa chọn…" : "Xác nhận phạm vi"}
					</Button>
				</div>
				{notice ? (
					<p
						aria-live="polite"
						className="text-destructive text-sm"
						role="status"
					>
						{notice}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
