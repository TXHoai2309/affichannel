"use client";

import { useState } from "react";

function getInitials(name: string) {
	return (
		name
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? "")
			.join("") || "SP"
	);
}

export function ProductThumbnail({
	name,
	thumbnailUrl,
	className = "h-28 w-full",
}: {
	name: string;
	thumbnailUrl?: string | null;
	className?: string;
}) {
	const [imageFailed, setImageFailed] = useState(false);

	if (thumbnailUrl && !imageFailed) {
		return (
			<div
				className={`overflow-hidden rounded-xl bg-affi-blue-soft ${className}`}
			>
				<img
					alt={`Ảnh đại diện của ${name}`}
					className="h-full w-full object-cover"
					onError={() => setImageFailed(true)}
					src={thumbnailUrl}
				/>
			</div>
		);
	}

	return (
		<div
			aria-label={`Ảnh đại diện của ${name}`}
			className={`flex items-center justify-center rounded-xl bg-affi-blue-soft font-semibold text-2xl text-affi-blue ${className}`}
			role="img"
		>
			{getInitials(name)}
		</div>
	);
}
