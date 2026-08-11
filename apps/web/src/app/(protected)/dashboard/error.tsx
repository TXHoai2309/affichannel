"use client";

import DashboardError from "@/features/dashboard/dashboard-error";

export default function ErrorBoundary({
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return <DashboardError onRetry={reset} />;
}
