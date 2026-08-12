import {
	createProductInputSchema,
	listMinimalProductInputSchema,
	listProductInputSchema,
} from "@affichannel/core/product/validation";
import { describe, expect, it } from "vitest";

import { getProductStatusLabel, isArchivedProduct } from "./product-types";

describe("product domain contract", () => {
	it("normalizes optional values and keeps VND as the MVP currency", () => {
		const result = createProductInputSchema.parse({
			name: "  Tai nghe X1  ",
			category: "  Điện tử  ",
			priceAmount: 129000,
			thumbnailUrl: "https://cdn.example.com/x1.png",
			sourceUrl: "https://shop.example.com/x1",
			affiliateUrl: "https://affiliate.example.com/x1",
		});

		expect(result).toMatchObject({
			name: "Tai nghe X1",
			category: "Điện tử",
			priceAmount: 129000,
			currency: "VND",
			status: "active",
		});
	});

	it("validates URLs with the allowed protocols", () => {
		const valid = createProductInputSchema.safeParse({
			name: "Tai nghe X1",
			thumbnailUrl: "https://cdn.example.com/x1.png",
			sourceUrl: "http://shop.example.com/x1",
			affiliateUrl: "https://affiliate.example.com/x1",
		});

		expect(valid.success).toBe(true);

		for (const thumbnailUrl of [
			"http://cdn.example.com/x1.png",
			"ftp://cdn.example.com/x1.png",
			"javascript:alert(1)",
			"data:text/plain,unsafe",
			"file:///tmp/x1.png",
			"not-a-url",
			"https://",
		]) {
			expect(
				createProductInputSchema.safeParse({
					name: "Tai nghe X1",
					thumbnailUrl,
				}).success,
			).toBe(false);
		}

		expect(
			createProductInputSchema.safeParse({
				name: "Tai nghe X1",
				sourceUrl: "ftp://shop.example.com/x1",
			}).success,
		).toBe(false);
	});

	it("trims valid URLs and normalizes empty optional URLs", () => {
		const result = createProductInputSchema.parse({
			name: "Tai nghe X1",
			thumbnailUrl: "  https://cdn.example.com/x1.png  ",
			sourceUrl: "   ",
			affiliateUrl: "",
		});

		expect(result.thumbnailUrl).toBe("https://cdn.example.com/x1.png");
		expect(result.sourceUrl).toBeUndefined();
		expect(result.affiliateUrl).toBeUndefined();
	});

	it("rejects non-HTTPS thumbnails and negative/non-integer prices", () => {
		expect(
			createProductInputSchema.safeParse({
				name: "Tai nghe X1",
				thumbnailUrl: "http://cdn.example.com/x1.png",
				priceAmount: 10.5,
			}).success,
		).toBe(false);
	});

	it("defaults Product Library queries to selectable active products", () => {
		expect(listMinimalProductInputSchema.parse({})).toEqual({
			selectableOnly: true,
		});
		expect(listProductInputSchema.parse({})).toMatchObject({
			archiveScope: "activeOnly",
			limit: 50,
		});
	});

	it("derives archived status from archivedAt before product status", () => {
		const archived = { status: "active" as const, archivedAt: new Date() };

		expect(isArchivedProduct(archived)).toBe(true);
		expect(getProductStatusLabel(archived)).toBe("Đã lưu trữ");
		expect(
			getProductStatusLabel({ status: "inactive", archivedAt: null }),
		).toBe("Tạm ngưng");
	});
});
