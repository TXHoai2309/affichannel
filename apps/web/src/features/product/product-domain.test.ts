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
