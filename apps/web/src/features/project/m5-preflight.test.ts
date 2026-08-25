import {
	type ContentFormatRegistry,
	classifyPersistedProjectIdentity,
	classifyProjectWriteIdentity,
	resolveContentFormatRef,
	runM5Preflight,
} from "@affichannel/core";
import { resolveProjectIdentityUpdate } from "@affichannel/core/project/project-service";
import { describe, expect, it } from "vitest";
import { requireM5PreflightDatabaseAuthority } from "../../../../../scripts/m5-preflight-database-authority";
import { requireM5TestDatabaseAuthority } from "../../../../../scripts/m5-test-database-authority";

const canonical = {
	contentType: "AFFILIATE",
	creationPath: "SCRIPTED",
	contentFormatKey: "SCRIPTED_STANDARD",
	contentFormatVersion: 1,
	hasProduct: true,
};

const registry = [
	{
		ref: { key: "SCRIPTED_STANDARD", version: 1 },
		label: "Scripted",
		supportedCreationPaths: ["SCRIPTED"],
		availability: "active",
	},
	{
		ref: { key: "SCRIPTED_LEGACY", version: 1 },
		label: "Legacy scripted",
		supportedCreationPaths: ["SCRIPTED"],
		availability: "deprecated",
	},
] as const satisfies ContentFormatRegistry;

describe("Domain Evolution M5 preflight", () => {
	it("keeps preflight and destructive test database authority fail-closed", () => {
		const original = { ...process.env };
		const ignoredDatabaseUrl = `postgresql:${"//"}ignored/ignored`;
		const disposableDatabaseUrl = `postgresql:${"//"}localhost:5433/disposable`;
		try {
			delete process.env.AFFICHANNEL_M5_PREFLIGHT_DATABASE_URL;
			delete process.env.AFFICHANNEL_M5_PREFLIGHT_DATABASE_CONFIRM;
			delete process.env.AFFICHANNEL_M5_TEST_DATABASE_URL;
			delete process.env.AFFICHANNEL_M5_TEST_DATABASE_CONFIRM;
			process.env.DATABASE_URL = ignoredDatabaseUrl;
			process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = ignoredDatabaseUrl;
			expect(() => requireM5PreflightDatabaseAuthority()).toThrow("REFUSED");
			expect(() => requireM5TestDatabaseAuthority()).toThrow("REFUSED");

			process.env.AFFICHANNEL_M5_TEST_DATABASE_URL = disposableDatabaseUrl;
			process.env.AFFICHANNEL_M5_TEST_DATABASE_CONFIRM = "WRONG";
			expect(() => requireM5TestDatabaseAuthority()).toThrow("REFUSED");
			process.env.AFFICHANNEL_M5_TEST_DATABASE_CONFIRM =
				"DISPOSABLE_M5_TEST_DB_CONFIRMED";
			expect(requireM5TestDatabaseAuthority().host).toBe("localhost:5433");
		} finally {
			process.env = original;
		}
	});
	it("accepts canonical active identities", () => {
		const result = runM5Preflight([{ id: "canonical", ...canonical }]);
		expect(result).toMatchObject({
			readyForM5: true,
			summary: {
				totalProjects: 1,
				canonicalCompleteIdentities: 1,
				deprecatedKnownContentFormat: 0,
			},
			blockers: {},
		});
	});

	it("reports known deprecated refs without blocking", () => {
		const result = runM5Preflight(
			[
				{
					id: "deprecated",
					...canonical,
					contentFormatKey: "SCRIPTED_LEGACY",
				},
			],
			{ registry },
		);
		expect(result.readyForM5).toBe(true);
		expect(result.summary.canonicalCompleteIdentities).toBe(1);
		expect(result.summary.deprecatedKnownContentFormat).toBe(1);
		expect(result.diagnostics.deprecatedKnownContentFormat).toEqual([
			"deprecated",
		]);
	});

	it("keeps a known deprecated persisted identity readable and exact", () => {
		const persisted = {
			productId: "product-1",
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_LEGACY",
			contentFormatVersion: 1,
		};
		expect(classifyPersistedProjectIdentity(persisted, registry)).toEqual({
			kind: "canonical",
			identity: {
				contentType: "AFFILIATE",
				creationPath: "SCRIPTED",
				contentFormat: { key: "SCRIPTED_LEGACY", version: 1 },
			},
		});
		expect(
			resolveContentFormatRef("SCRIPTED_LEGACY", 1, registry),
		).toMatchObject({
			resolution: "deprecated",
			ref: { key: "SCRIPTED_LEGACY", version: 1 },
		});
		const update = resolveProjectIdentityUpdate(
			classifyProjectWriteIdentity({}, registry),
			persisted,
			registry,
		);
		expect(update).toEqual({
			success: true,
			identityUpdate: {
				strategy: "preserve",
				expectedIdentity: persisted,
			},
		});
	});

	it("rejects a new deprecated assignment with its canonical typed reason", () => {
		expect(
			classifyProjectWriteIdentity(
				{
					contentType: "AFFILIATE",
					creationPath: "SCRIPTED",
					contentFormat: { key: "SCRIPTED_LEGACY", version: 1 },
				},
				registry,
			),
		).toEqual({ kind: "rejected", reasonCode: "DEPRECATED_CONTENT_FORMAT" });
	});

	it("uses the locked classifier precedence and exact blocker taxonomy", () => {
		const result = runM5Preflight([
			{
				id: "legacy",
				contentType: null,
				creationPath: null,
				contentFormatKey: null,
				contentFormatVersion: null,
				hasProduct: true,
			},
			{ id: "partial", ...canonical, contentFormatVersion: null },
			{ id: "type", ...canonical, contentType: "HYBRID" },
			{ id: "path", ...canonical, creationPath: "AI_VISUAL" },
			{ id: "version", ...canonical, contentFormatVersion: 0 },
			{ id: "unknown", ...canonical, contentFormatKey: "UNKNOWN" },
			{ id: "mismatch", ...canonical, creationPath: "QUICK_IMAGE" },
			{ id: "product", ...canonical, hasProduct: false },
		]);

		expect(result.readyForM5).toBe(false);
		expect(result.summary).toMatchObject({
			totalProjects: 8,
			legacyAllNullIdentities: 1,
			partialIdentities: 1,
			invalidContentType: 1,
			invalidCreationPath: 1,
			invalidContentFormatVersion: 1,
			unknownUnsupportedContentFormat: 1,
			contentFormatCreationPathMismatch: 1,
			affiliateMissingProduct: 1,
		});
		expect(Object.keys(result.blockers)).toHaveLength(8);
	});

	it("bounds sanitized Project ID diagnostics", () => {
		const result = runM5Preflight(
			Array.from({ length: 4 }, (_, index) => ({
				id: `legacy-${index}`,
				contentType: null,
				creationPath: null,
				contentFormatKey: null,
				contentFormatVersion: null,
				hasProduct: true,
			})),
			{ maxDiagnosticIds: 2 },
		);
		expect(result.summary.legacyAllNullIdentities).toBe(4);
		expect(result.diagnostics.legacyAllNullIdentities).toEqual([
			"legacy-0",
			"legacy-1",
		]);
	});
});
