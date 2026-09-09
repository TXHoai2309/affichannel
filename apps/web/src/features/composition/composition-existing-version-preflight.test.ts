import type { CompositionTechnicalLoader } from "@affichannel/api/services/composition-technical-loader";
import {
	type CompositionTechnicalPreflightDependencies,
	technicalPreflightCompositionVersion,
} from "@affichannel/api/services/composition-technical-preflight-service";
import type { TechnicalPreflightResult } from "@affichannel/core";
import { describe, expect, it } from "vitest";

const actor = { workspaceId: "workspace-1", userId: "user-1" } as const;

function result(
	compositionVersionId: string,
	status: TechnicalPreflightResult["status"],
	reasonCode: TechnicalPreflightResult["reasonCode"] = null,
): TechnicalPreflightResult {
	return {
		status,
		retryable: status === "UNKNOWN",
		reasonCode,
		compositionVersionId,
		compositionFingerprint: status === "VALID" ? "fingerprint-1" : null,
		issues: [],
	};
}

function dependencies(row: {
	id: string;
	workspaceId: string;
	projectId: string;
	schemaVersion: string;
	compositionInputJson: unknown;
	compositionFingerprint: string;
}) {
	return {
		findVersion: async () => row,
		preflightInput: async (_loader, id, input) => {
			const state = input as { objectState?: string };
			if (state.objectState === "missing")
				return result(id, "INVALID", "MISSING_MEDIA_OBJECT");
			if (state.objectState === "transient")
				return result(id, "UNKNOWN", "DEPENDENCY_READ_UNAVAILABLE");
			if (state.objectState === "checksum-mutated")
				return result(id, "INVALID", "MEDIA_CHECKSUM_MISMATCH");
			return result(id, "VALID");
		},
	} satisfies CompositionTechnicalPreflightDependencies;
}

const loader = {} as CompositionTechnicalLoader;

describe("AFF-US-021 existing CompositionVersion technical preflight", () => {
	it("fails closed for a missing version and unsupported schema", async () => {
		const missing = await technicalPreflightCompositionVersion(
			actor,
			"missing",
			loader,
			{ findVersion: async () => undefined as never },
		);
		expect(missing).toMatchObject({
			status: "INVALID",
			reasonCode: "INVALID_COMPOSITION_STRUCTURE",
		});
		const unsupported = await technicalPreflightCompositionVersion(
			actor,
			"composition-1",
			loader,
			{
				findVersion: async () => ({
					id: "composition-1",
					workspaceId: actor.workspaceId,
					projectId: "project-1",
					schemaVersion: "composition-input.v2",
					compositionInputJson: {},
					compositionFingerprint: "fingerprint-1",
				}),
			},
		);
		expect(unsupported).toMatchObject({
			status: "UNSUPPORTED",
			reasonCode: "UNSUPPORTED_COMPOSITION_SCHEMA",
		});
	});

	it("returns VALID for the exact immutable dependency set", async () => {
		const row = {
			id: "composition-1",
			workspaceId: actor.workspaceId,
			projectId: "project-1",
			schemaVersion: "composition-input.v1",
			compositionInputJson: {
				objectState: "exact",
				status: "ready",
				rights: "owned",
			},
			compositionFingerprint: "fingerprint-1",
		};
		expect(
			await technicalPreflightCompositionVersion(
				actor,
				row.id,
				loader,
				dependencies(row),
			),
		).toMatchObject({
			status: "VALID",
			compositionFingerprint: "fingerprint-1",
		});
	});

	it.each([
		[
			"checksum mutation",
			"checksum-mutated",
			"INVALID",
			"MEDIA_CHECKSUM_MISMATCH",
		],
		["confirmed object missing", "missing", "INVALID", "MISSING_MEDIA_OBJECT"],
		[
			"transient storage failure",
			"transient",
			"UNKNOWN",
			"DEPENDENCY_READ_UNAVAILABLE",
		],
	] as const)(
		"classifies %s without database mutation",
		async (_label, objectState, status, reasonCode) => {
			const row = {
				id: "composition-1",
				workspaceId: actor.workspaceId,
				projectId: "project-1",
				schemaVersion: "composition-input.v1",
				compositionInputJson: { objectState },
				compositionFingerprint: "fingerprint-1",
			};
			const before = JSON.stringify(row);
			const outcome = await technicalPreflightCompositionVersion(
				actor,
				row.id,
				loader,
				dependencies(row),
			);
			expect(outcome).toMatchObject({ status, reasonCode });
			expect(JSON.stringify(row)).toBe(before);
		},
	);

	it("does not change technical validity for READY to ARCHIVED or rights-only changes", async () => {
		const row = {
			id: "composition-1",
			workspaceId: actor.workspaceId,
			projectId: "project-1",
			schemaVersion: "composition-input.v1",
			compositionInputJson: {
				objectState: "exact",
				status: "ready",
				rights: "owned",
			},
			compositionFingerprint: "fingerprint-1",
		};
		const ready = await technicalPreflightCompositionVersion(
			actor,
			row.id,
			loader,
			dependencies(row),
		);
		row.compositionInputJson = {
			objectState: "exact",
			status: "archived",
			rights: "owned",
		};
		const archived = await technicalPreflightCompositionVersion(
			actor,
			row.id,
			loader,
			dependencies(row),
		);
		row.compositionInputJson = {
			objectState: "exact",
			status: "archived",
			rights: "restricted",
		};
		const rightsChanged = await technicalPreflightCompositionVersion(
			actor,
			row.id,
			loader,
			dependencies(row),
		);
		expect(archived.status).toBe(ready.status);
		expect(rightsChanged.status).toBe(ready.status);
	});
});
