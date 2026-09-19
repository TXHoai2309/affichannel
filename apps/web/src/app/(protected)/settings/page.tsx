import { ChannelStrategyEditor } from "@/features/channel-strategy/channel-strategy-editor";

export default function SettingsPage() {
	return (
		<section className="space-y-6">
			<div>
				<p className="font-medium text-muted-foreground text-sm">
					Workspace settings
				</p>
				<h1 className="mt-1 font-semibold text-2xl tracking-tight">
					Channel Strategy
				</h1>
			</div>
			<ChannelStrategyEditor />
		</section>
	);
}
