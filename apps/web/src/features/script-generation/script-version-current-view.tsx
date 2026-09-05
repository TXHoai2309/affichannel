"use client";

import type { ScriptVersionReadModel } from "@affichannel/core/script-version/types";
import { Badge } from "@affichannel/ui/components/badge";
import { Button } from "@affichannel/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@affichannel/ui/components/card";
import { LockKeyhole, RefreshCw } from "lucide-react";
import ClaimSubjectConfirmationPanel, {
	type ClaimSubjectDecision,
} from "./claim-subject-confirmation-panel";
import {
	formatOccurrence,
	getCurrentScriptPrimarySnapshot,
	getScriptPresentationState,
	type ScriptPresentationIdentity,
} from "./script-studio-state";

type ScriptVersionCurrentViewProps = {
	scriptVersion: ScriptVersionReadModel;
	onRefreshClaims?: () => void;
	refreshPending?: boolean;
	refreshNotice?: string | null;
	onConfirmClaimSubjects?: (decisions: ClaimSubjectDecision[]) => void;
	confirmPending?: boolean;
	confirmationNotice?: string | null;
	presentationIdentity?: ScriptPresentationIdentity;
};

export default function ScriptVersionCurrentView({
	scriptVersion,
	onRefreshClaims,
	refreshPending = false,
	refreshNotice = null,
	onConfirmClaimSubjects,
	confirmPending = false,
	confirmationNotice = null,
	presentationIdentity = { contentType: null, creationPath: null },
}: ScriptVersionCurrentViewProps) {
	const snapshot = getCurrentScriptPrimarySnapshot(scriptVersion);
	const selectedHook = snapshot.hookVariants.find(
		(hook) => hook.key === snapshot.selectedHookKey,
	);
	const claimsCurrent = snapshot.claimsStatus === "current";
	const presentation = getScriptPresentationState({
		identity: presentationIdentity,
		claimsStatus: snapshot.claimsStatus,
		claims: snapshot.claims,
	});

	return (
		<div className="space-y-4" data-testid="current-script-view">
			<Card className="rounded-2xl border-affi-blue-border/80 shadow-sm">
				<CardHeader>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<CardTitle id="script-output-title">Kịch bản hiện tại</CardTitle>
							<CardDescription>
								Nội dung từ ScriptVersion hiện tại, không phải bản AI bất biến.
							</CardDescription>
						</div>
						<Badge variant="outline">Revision {scriptVersion.revision}</Badge>
					</div>
				</CardHeader>
				<CardContent className="space-y-5">
					<CurrentSection title="Hook">
						{selectedHook ? (
							<div className="rounded-xl border bg-background p-3">
								<Badge variant="outline">{selectedHook.key}</Badge>
								<p className="mt-2 whitespace-pre-wrap text-sm">
									{selectedHook.text}
								</p>
							</div>
						) : (
							<p className="text-muted-foreground text-sm">Chưa chọn Hook.</p>
						)}
					</CurrentSection>

					<CurrentSection title="Voiceover">
						<div className="space-y-3">
							{snapshot.voiceoverSegments.map((segment, index) => (
								<div
									className="rounded-xl border bg-background p-3"
									key={segment.key}
								>
									<Badge variant="outline">Đoạn {index + 1}</Badge>
									<p className="mt-2 whitespace-pre-wrap text-sm">
										{segment.text}
									</p>
								</div>
							))}
						</div>
					</CurrentSection>

					<CurrentSection title="Scenes">
						<div className="space-y-3">
							{snapshot.scenes.map((scene) => (
								<div
									className="rounded-xl border bg-background p-3"
									key={scene.order}
								>
									<div className="flex flex-wrap items-center gap-2">
										<Badge variant="outline">Cảnh {scene.order}</Badge>
										<span className="text-muted-foreground text-xs">
											{scene.durationSeconds} giây
										</span>
									</div>
									<dl className="mt-3 grid gap-3 sm:grid-cols-2">
										<CurrentField label="Visual Direction">
											{scene.visualDirection}
										</CurrentField>
										<CurrentField label="Text trên màn hình">
											{scene.onScreenText || "Không có"}
										</CurrentField>
									</dl>
								</div>
							))}
						</div>
					</CurrentSection>

					<CurrentSection title="CTA">
						<CurrentText value={snapshot.cta.text} />
					</CurrentSection>
					<CurrentSection title="Caption">
						<CurrentText value={snapshot.caption} />
					</CurrentSection>
					<CurrentSection title="Hashtags">
						<div className="flex flex-wrap gap-2">
							{snapshot.hashtags.map((hashtag) => (
								<Badge key={hashtag} variant="outline">
									{hashtag}
								</Badge>
							))}
						</div>
					</CurrentSection>
					{presentation.disclosure === "REQUIRED" ? (
						<CurrentSection title="Disclosure">
							<CurrentText value={snapshot.disclosure} />
						</CurrentSection>
					) : null}

					<section
						aria-live="polite"
						className={`rounded-xl border p-4 ${
							claimsCurrent
								? "border-emerald-200 bg-emerald-50 text-emerald-900"
								: "border-amber-200 bg-amber-50 text-amber-950"
						}`}
					>
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="flex items-center gap-2">
								<LockKeyhole aria-hidden="true" className="size-4" />
								<p className="font-medium text-sm">
									{claimsCurrent ? "Claims hiện tại" : "Claims cần cập nhật"}
								</p>
							</div>
							{!claimsCurrent && onRefreshClaims ? (
								<Button
									data-testid="refresh-claims-button"
									disabled={refreshPending}
									onClick={onRefreshClaims}
									size="sm"
									type="button"
								>
									{refreshPending ? (
										<RefreshCw aria-hidden="true" className="animate-spin" />
									) : null}
									{refreshPending ? "Đang cập nhật..." : "Cập nhật Claims"}
								</Button>
							) : null}
						</div>
						<p className="mt-2 text-xs">
							{presentation.factLock === "NOT_REQUIRED"
								? "Không cần Fact Lock cho các claim hiện tại."
								: claimsCurrent
									? "Claims hiện tại đã sẵn sàng cho bước Fact Lock."
									: "Nội dung Script đã thay đổi; hãy cập nhật Claims trước Fact Lock."}
						</p>
						{refreshNotice ? (
							<p className="mt-2 font-medium text-xs" role="status">
								{refreshNotice}
							</p>
						) : null}
					</section>

					{onConfirmClaimSubjects ? (
						<ClaimSubjectConfirmationPanel
							confirmPending={confirmPending}
							notice={confirmationNotice}
							onConfirm={onConfirmClaimSubjects}
							scriptVersion={scriptVersion}
						/>
					) : null}

					<CurrentSection title="Candidate Claims">
						{snapshot.claims.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								Không có claim cần kiểm tra.
							</p>
						) : (
							<div className="space-y-3">
								{snapshot.claims.map((claim, index) => (
									<div
										className="rounded-xl border bg-background p-3"
										key={`${claim.text}-${index}`}
									>
										<p className="whitespace-pre-wrap text-sm">{claim.text}</p>
										<p className="mt-2 text-muted-foreground text-xs">
											Vị trí: {formatOccurrence(claim.occurrence)}
										</p>
									</div>
								))}
							</div>
						)}
					</CurrentSection>
				</CardContent>
			</Card>
		</div>
	);
}

function CurrentSection({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
			<h3 className="font-semibold text-sm">{title}</h3>
			{children}
		</section>
	);
}

function CurrentField({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<dt className="font-medium text-muted-foreground text-xs">{label}</dt>
			<dd className="mt-1 whitespace-pre-wrap text-sm">{children}</dd>
		</div>
	);
}

function CurrentText({ value }: { value: string }) {
	return <p className="whitespace-pre-wrap text-sm">{value}</p>;
}
