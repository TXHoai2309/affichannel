import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime } from "./format-relative-time";

describe("formatRelativeTime", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("uses days consistently for project and activity timestamps", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-11T10:00:00.000Z"));

		expect(formatRelativeTime("2026-08-09T10:00:00.000Z")).toBe("Hôm kia");
	});

	it("switches to weeks for older timestamps", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-11T10:00:00.000Z"));

		expect(formatRelativeTime("2026-07-28T10:00:00.000Z")).toBe("2 tuần trước");
	});
});
