# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: script-studio-runtime.spec.ts >> AFF-US-008 final runtime integration >> runs getState, estimate, deterministic generate, persistence, and reopen against Neon
- Location: tests\e2e\script-studio-runtime.spec.ts:38:6

# Error details

```
Error: Runtime fixture requires an empty Channel/AI/Output Settings workspace.
```

# Test source

```ts
  67  | 			expect(estimate.model).toBe("claude-sonnet-4-6");
  68  | 			expect(BigInt(estimate.estimatedCostMicros)).toBeGreaterThan(BigInt(0));
  69  | 			expect(estimate.currency).toMatch(/^[A-Z]{3}$/);
  70  | 			await expect(page.getByText("Chi phí ước tính")).toBeVisible();
  71  | 
  72  | 			await upsertAiSettings(fixture.actor, {
  73  | 				textProvider: "deterministic",
  74  | 				textModel: "runtime-deterministic-v2",
  75  | 			});
  76  | 
  77  | 			await page
  78  | 				.getByRole("button", { name: "Tạo kịch bản", exact: true })
  79  | 				.first()
  80  | 				.click();
  81  | 			await expectScriptOutput(page, fixture.factContent);
  82  | 
  83  | 			const [generation] = await db
  84  | 				.select()
  85  | 				.from(scriptGeneration)
  86  | 				.where(eq(scriptGeneration.projectId, fixture.projectId));
  87  | 			expect(generation).toBeTruthy();
  88  | 			expect(generation.status).toBe("completed");
  89  | 			expect(generation.provider).toBe("deterministic");
  90  | 			expect(generation.outputJson).not.toBeNull();
  91  | 			expect(generation.finishedAt).not.toBeNull();
  92  | 
  93  | 			const snapshot = generation.inputSnapshotJson as {
  94  | 				facts: Array<{ id: string; revision: number }>;
  95  | 			};
  96  | 			expect(
  97  | 				snapshot.facts.map(({ id, revision }) => ({ id, revision })),
  98  | 			).toEqual([{ id: fixture.factId, revision: fixture.factRevision }]);
  99  | 
  100 | 			const dependencies = await db
  101 | 				.select()
  102 | 				.from(factDependency)
  103 | 				.where(eq(factDependency.dependentId, generation.id));
  104 | 			expect(dependencies).toHaveLength(1);
  105 | 			expect(dependencies[0]).toMatchObject({
  106 | 				productFactId: fixture.factId,
  107 | 				factRevision: fixture.factRevision,
  108 | 				dependentType: "script_generation",
  109 | 				dependentId: generation.id,
  110 | 				detachedAt: null,
  111 | 				invalidatedAt: null,
  112 | 			});
  113 | 
  114 | 			const reopenedStatePromise = page.waitForResponse((response) =>
  115 | 				response.url().includes("/api/rpc/scriptGeneration/getState"),
  116 | 			);
  117 | 			await page.reload();
  118 | 			const reopenedState = await (await reopenedStatePromise).json();
  119 | 			expect(reopenedState.json.latestUsableArtifact.id).toBe(generation.id);
  120 | 			await expectScriptOutput(page, fixture.factContent);
  121 | 		} finally {
  122 | 			await cleanupRuntimeFixture(fixture);
  123 | 		}
  124 | 	});
  125 | });
  126 | 
  127 | type RuntimeFixture = {
  128 | 	actor: { workspaceId: string; userId: string };
  129 | 	projectId: string;
  130 | 	productId: string;
  131 | 	factId: string;
  132 | 	factRevision: number;
  133 | 	factContent: string;
  134 | 	projectName: string;
  135 | 	productName: string;
  136 | };
  137 | 
  138 | async function seedRuntimeFixture(): Promise<RuntimeFixture> {
  139 | 	if (!fixedAccountEmail) throw new Error("E2E_AUTH_EMAIL is required.");
  140 | 	const [fixedUser] = await db
  141 | 		.select({ id: user.id })
  142 | 		.from(user)
  143 | 		.where(eq(user.email, fixedAccountEmail))
  144 | 		.limit(1);
  145 | 	if (!fixedUser) throw new Error("The fixed E2E account does not exist.");
  146 | 	const actor = await getWorkspaceActor(fixedUser.id);
  147 | 	if (!actor)
  148 | 		throw new Error("The fixed E2E account has no internal workspace.");
  149 | 
  150 | 	const existingSettings = await db
  151 | 		.select({ id: channelSettings.id })
  152 | 		.from(channelSettings)
  153 | 		.where(eq(channelSettings.workspaceId, actor.workspaceId));
  154 | 	const existingAiSettings = await db
  155 | 		.select({ id: aiSettings.id })
  156 | 		.from(aiSettings)
  157 | 		.where(eq(aiSettings.workspaceId, actor.workspaceId));
  158 | 	const existingOutputRules = await db
  159 | 		.select({ id: outputRules.id })
  160 | 		.from(outputRules)
  161 | 		.where(eq(outputRules.workspaceId, actor.workspaceId));
  162 | 	if (
  163 | 		existingSettings.length > 0 ||
  164 | 		existingAiSettings.length > 0 ||
  165 | 		existingOutputRules.length > 0
  166 | 	) {
> 167 | 		throw new Error(
      |         ^ Error: Runtime fixture requires an empty Channel/AI/Output Settings workspace.
  168 | 			"Runtime fixture requires an empty Channel/AI/Output Settings workspace.",
  169 | 		);
  170 | 	}
  171 | 
  172 | 	const suffix = Date.now().toString(36);
  173 | 	const projectName = `US008 Runtime Project ${suffix}`;
  174 | 	const productName = `US008 Runtime Product ${suffix}`;
  175 | 	const factContent = "Pin dùng 20 giờ theo thông tin chính thức.";
  176 | 	const productRecord = await createProduct(actor, {
  177 | 		name: productName,
  178 | 		category: "Audio",
  179 | 		status: "active",
  180 | 		thumbnailUrl: undefined,
  181 | 		sourceUrl: undefined,
  182 | 		affiliateUrl: undefined,
  183 | 		priceAmount: null,
  184 | 		currency: "VND",
  185 | 	});
  186 | 	const repository = createProjectRepository();
  187 | 	const projectRecord = await createProject(repository, actor, {
  188 | 		name: projectName,
  189 | 		productId: productRecord.id,
  190 | 		platform: "tiktok",
  191 | 		goal: "Tạo nội dung review có thể kiểm chứng",
  192 | 		durationSeconds: 30,
  193 | 		angle: "Nêu trải nghiệm thực tế dựa trên Product Facts",
  194 | 		description: "Fixture integration tự dọn sau khi kiểm tra.",
  195 | 	});
  196 | 	const fact = await createProductFact(actor, {
  197 | 		productId: productRecord.id,
  198 | 		data: {
  199 | 			content: factContent,
  200 | 			type: "specification",
  201 | 			status: "verified",
  202 | 			sourceType: "official",
  203 | 			sourceLabel: "US008 runtime integration",
  204 | 			sourceUrl: "https://example.com/us008-runtime-fact",
  205 | 			confirmedAt: "2026-08-15",
  206 | 			expiresAt: null,
  207 | 			notes: null,
  208 | 		},
  209 | 	});
  210 | 
  211 | 	await upsertChannelSettings(actor, {
  212 | 		niche: "Công nghệ",
  213 | 		targetAudience: "Người dùng cần tai nghe",
  214 | 		tone: "Tin cậy, rõ ràng",
  215 | 		contentPillar: "Review sản phẩm",
  216 | 		defaultCta: "Xem thêm thông tin",
  217 | 		affiliateDisclosure: "Nội dung có liên kết affiliate.",
  218 | 		avoidWords: [],
  219 | 	});
  220 | 	await upsertOutputRules(actor, {
  221 | 		language: "vi-VN",
  222 | 		aspectRatio: "9:16",
  223 | 		subtitleSafeArea: "standard",
  224 | 		claimLimit: null,
  225 | 		requireFinalCta: true,
  226 | 	});
  227 | 	await upsertAiSettings(actor, {
  228 | 		textProvider: "apikeyfun",
  229 | 		textModel: "claude-sonnet-4-6",
  230 | 	});
  231 | 
  232 | 	return {
  233 | 		actor,
  234 | 		projectId: projectRecord.id,
  235 | 		productId: productRecord.id,
  236 | 		factId: fact.id,
  237 | 		factRevision: fact.revision,
  238 | 		factContent,
  239 | 		projectName,
  240 | 		productName,
  241 | 	};
  242 | }
  243 | 
  244 | async function cleanupRuntimeFixture(fixture: RuntimeFixture) {
  245 | 	const [generationRows] = await Promise.all([
  246 | 		db
  247 | 			.select({ id: scriptGeneration.id })
  248 | 			.from(scriptGeneration)
  249 | 			.where(eq(scriptGeneration.projectId, fixture.projectId)),
  250 | 	]);
  251 | 	const generationIds = generationRows.map((row) => row.id);
  252 | 	if (generationIds.length > 0) {
  253 | 		await db
  254 | 			.delete(factInvalidationEvent)
  255 | 			.where(inArray(factInvalidationEvent.dependentId, generationIds));
  256 | 		await db
  257 | 			.delete(factDependency)
  258 | 			.where(inArray(factDependency.dependentId, generationIds));
  259 | 		await db
  260 | 			.delete(scriptGeneration)
  261 | 			.where(inArray(scriptGeneration.id, generationIds));
  262 | 	}
  263 | 	await db
  264 | 		.delete(productFactHistory)
  265 | 		.where(eq(productFactHistory.productId, fixture.productId));
  266 | 	await db.delete(productFact).where(eq(productFact.id, fixture.factId));
  267 | 	await db.delete(project).where(eq(project.id, fixture.projectId));
```