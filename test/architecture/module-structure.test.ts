import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
	CANONICAL_FACETS,
	checkModuleStructure,
	checkProductionArchitecture,
	SCOPED_DOMAINS,
} from "../../scripts/check-module-structure.ts";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const run = promisify(execFile);

async function validFixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "module-structure-"));
	for (const domain of SCOPED_DOMAINS) {
		const path = join(root, "src", domain);
		await mkdir(path, { recursive: true });
		for (const facet of CANONICAL_FACETS)
			await writeFile(join(path, facet), "export {};\n");
		if (domain === "footer")
			await writeFile(join(path, "footer-rendering.ts"), "export {};\n");
	}
	return root;
}

describe("module structure checker", () => {
	it("protects worker and publisher modules from consumer imports", async () => {
		const config = await readFile(
			join(PROJECT_ROOT, ".dependency-cruiser.cjs"),
			"utf8",
		);
		expect(config).toContain("no-herdr-worker-to-consumer");
		expect(config).toContain(
			"^src/herdr/(commands|event-publishers|events)\\\\.ts$",
		);
	});
	it("protects event publishers from consumers", async () => {
		const config = await readFile(
			join(PROJECT_ROOT, ".dependency-cruiser.cjs"),
			"utf8",
		);
		expect(config).toContain("no-event-publisher-to-consumer");
		expect(config).toContain("^src/[^/]+/event-publishers\\\\.ts$");
	});
	it("allows shared module-state imports but protects internal-state", async () => {
		const config = await readFile(
			join(PROJECT_ROOT, ".dependency-cruiser.cjs"),
			"utf8",
		);
		expect(config).toContain("no-shared-to-scoped-implementation");
		expect(config).toContain("no-shared-to-internal-state");
		expect(config).toContain("no-root-to-internal-state");
		expect(config).toContain("no-prompt-queue-to-internal-state");
		expect(config).not.toContain("exit-protocol");
		expect(config).toContain("(?!module-state\\\\.ts$)");
		expect(config).toContain("pathNot:");
		expect(config).toContain(
			"^src/(shared|pr|todoist|herdr|worktree|prompt-queue|footer)/",
		);
	});

	it("requires every scoped module to define module-state.ts and internal-state.ts", async () => {
		for (const domain of SCOPED_DOMAINS) {
			await expect(
				readFile(join(PROJECT_ROOT, "src", domain, "module-state.ts")),
			).resolves.toBeDefined();
			await expect(
				readFile(join(PROJECT_ROOT, "src", domain, "internal-state.ts")),
			).resolves.toBeDefined();
		}
	});

	it("requires every scoped module to define events.ts", async () => {
		for (const domain of SCOPED_DOMAINS)
			await expect(
				readFile(join(PROJECT_ROOT, "src", domain, "events.ts")),
			).resolves.toBeDefined();
	});

	it("accepts all canonical files, including empty facets", async () => {
		expect(await checkModuleStructure(await validFixture())).toEqual([]);
	});

	it("reports facet-specific missing diagnostics", async () => {
		const root = await validFixture();
		await (await import("node:fs/promises")).rm(
			join(root, "src", "pr", "module-state.ts"),
		);
		await (await import("node:fs/promises")).rm(
			join(root, "src", "footer", "internal-state.ts"),
		);

		expect(await checkModuleStructure(root)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "src/pr/module-state.ts",
					message: "missing module-state facet",
				}),
				expect.objectContaining({
					path: "src/footer/internal-state.ts",
					message: "missing internal-state facet",
				}),
			]),
		);
	});

	it("rejects reintroduced legacy application directory", async () => {
		const root = await validFixture();
		await mkdir(join(root, "src", "application"), { recursive: true });

		expect(await checkModuleStructure(root)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "src/application",
					message: "legacy application directory is not allowed",
				}),
			]),
		);
	});

	it("passes final production architecture constraints", async () => {
		expect(await checkProductionArchitecture(PROJECT_ROOT)).toEqual([]);
	});

	it("rejects interactive prompt UI outside Prompt Queue", async () => {
		const root = await mkdtemp(join(tmpdir(), "production-prompt-ownership-"));
		const sourcePath = join(root, "src", "pr", "module.ts");
		await mkdir(dirname(sourcePath), { recursive: true });
		await writeFile(
			sourcePath,
			"export function prompt(context: { ui: { confirm(): Promise<boolean> } }) { return context.ui.confirm(); }\n",
		);

		expect(await checkProductionArchitecture(root)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message: "interactive prompt UI must live in Prompt Queue",
				}),
			]),
		);
	});

	it("rejects prompt UI aliases and element calls outside Prompt Queue", async () => {
		const root = await mkdtemp(join(tmpdir(), "production-prompt-aliases-"));
		const sourcePath = join(root, "src", "pr", "module.ts");
		await mkdir(dirname(sourcePath), { recursive: true });
		await writeFile(
			sourcePath,
			[
				"export function prompt(context: { ui: { confirm?: () => Promise<boolean>; custom?: () => Promise<void> } }) {",
				"  const ui = context.ui;",
				"  ui.confirm?.();",
				'  context.ui["custom"]?.();',
				"  const confirm = context.ui.confirm;",
				"  confirm?.();",
				"}",
			].join("\\n"),
		);

		expect(await checkProductionArchitecture(root)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message: "interactive prompt UI must live in Prompt Queue",
				}),
			]),
		);
	});

	it("rejects root Prompt Queue and Exit Protocol paths", async () => {
		const root = await mkdtemp(join(tmpdir(), "production-legacy-paths-"));
		await mkdir(join(root, "src"), { recursive: true });
		await writeFile(join(root, "src", "prompt-queue.ts"), "export {};\\n");
		await mkdir(join(root, "src", "exit-protocol"), { recursive: true });
		await writeFile(
			join(root, "src", "exit-protocol", "module.ts"),
			"export {};\\n",
		);

		expect(await checkProductionArchitecture(root)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "src/prompt-queue.ts",
					message: "legacy Prompt Queue root file is not allowed",
				}),
				expect.objectContaining({
					path: "src/exit-protocol",
					message: "Exit Protocol directory is not allowed",
				}),
			]),
		);
	});

	it("enforces dependency boundaries with actual dependency-cruiser fixtures", async () => {
		async function cruiseFixture(
			files: Readonly<Record<string, string>>,
		): Promise<string> {
			const root = await mkdtemp(join(tmpdir(), "dependency-boundary-"));
			await writeFile(
				join(root, ".dependency-cruiser.cjs"),
				await readFile(join(PROJECT_ROOT, ".dependency-cruiser.cjs"), "utf8"),
			);
			for (const [path, source] of Object.entries(files)) {
				const filePath = join(root, path);
				await mkdir(dirname(filePath), { recursive: true });
				await writeFile(filePath, source);
			}
			try {
				const result = await run(
					join(PROJECT_ROOT, "node_modules", ".bin", "depcruise"),
					["--config", ".dependency-cruiser.cjs", "src"],
					{ cwd: root },
				);
				return `${result.stdout}${result.stderr}`;
			} catch (error) {
				const failure = error as { stdout?: string; stderr?: string };
				return `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
			}
		}

		await expect(
			cruiseFixture({
				"src/prompt-queue/consumer.ts":
					'import type { PrModule } from "../pr/module.ts";\nvoid (null as PrModule);\n',
				"src/pr/module.ts": "export interface PrModule {}\n",
			}),
		).resolves.not.toContain("no-prompt-queue-to-pr");

		const featureDomains = [
			"pr",
			"todoist",
			"herdr",
			"worktree",
			"footer",
		] as const;
		const internalImports = featureDomains
			.map(
				(domain) =>
					`import type { State } from "../${domain}/internal-state.ts";`,
			)
			.join("\n");
		const internalStateFiles = Object.fromEntries(
			featureDomains.map((domain) => [
				`src/${domain}/internal-state.ts`,
				"export interface State {}\n",
			]),
		);
		const internalStateViolations = await cruiseFixture({
			"src/prompt-queue/consumer.ts": `${internalImports}\n`,
			...internalStateFiles,
		});
		for (const domain of featureDomains) {
			expect(internalStateViolations).toMatch(
				new RegExp(
					`no-prompt-queue-to-internal-state: src/prompt-queue/consumer\\.ts .* src/${domain}/internal-state\\.ts`,
				),
			);
		}

		await expect(
			cruiseFixture({
				"src/pr/consumer.ts":
					'import type { PromptQueue } from "../prompt-queue/consumer.ts";\nvoid (null as PromptQueue);\n',
				"src/prompt-queue/consumer.ts": "export interface PromptQueue {}\n",
			}),
		).resolves.toContain("no-pr-to-prompt-queue");
	});

	it("removes Exit Protocol from lint scopes and reverse-import exceptions", async () => {
		const config = await readFile(
			join(PROJECT_ROOT, ".dependency-cruiser.cjs"),
			"utf8",
		);
		const reversePromptQueueRules = config
			.split("\n")
			.filter((line) => line.includes("to-prompt-queue"));
		expect(reversePromptQueueRules).not.toEqual(
			expect.arrayContaining([
				expect.stringContaining('dependencyTypesNot: ["type-only"]'),
			]),
		);

		const ruleFiles = await readdir(join(PROJECT_ROOT, "src", "lint", "rules"));
		const ruleSources = await Promise.all(
			ruleFiles
				.filter((file) => file.endsWith(".ts"))
				.map((file) =>
					readFile(join(PROJECT_ROOT, "src", "lint", "rules", file), "utf8"),
				),
		);
		expect(ruleSources.join("\n")).not.toContain("exit-protocol");
	});

	it("reports forbidden compatibility APIs in production files", async () => {
		const root = await mkdtemp(join(tmpdir(), "production-architecture-"));
		const sourcePath = join(root, "src", "legacy.ts");
		await mkdir(join(root, "src"), { recursive: true });
		await writeFile(
			sourcePath,
			"class SessionContext {}\nconst events = { on() {} }; events.on();\n",
		);

		const issues = await checkProductionArchitecture(root);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message: "forbidden compatibility identifier SessionContext",
				}),
				expect.objectContaining({
					message:
						"production architecture must use typed Event channels, not .on()",
				}),
			]),
		);
	});

	it("rejects nested domain directories", async () => {
		const root = await validFixture();
		const nested = join(root, "src", "pr", "legacy");
		await mkdir(nested, { recursive: true });
		await writeFile(join(nested, "implementation.ts"), "export {};");

		expect(await checkModuleStructure(root)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					domain: "pr",
					path: "src/pr/legacy",
					message: "nested domain directories are not allowed",
				}),
			]),
		);
	});

	it("reports a missing domain with correction", async () => {
		const root = await validFixture();
		const missing = join(root, "src", "herdr");
		await (await import("node:fs/promises")).rm(missing, { recursive: true });
		await expect(checkModuleStructure(root)).resolves.toEqual([
			expect.objectContaining({
				domain: "herdr",
				message: "missing domain directory",
				path: "src/herdr",
			}),
		]);
	});

	it("reports missing files and unclassified files without using cwd", async () => {
		const root = await validFixture();
		await (await import("node:fs/promises")).rm(
			join(root, "src", "footer", "footer-rendering.ts"),
		);
		await writeFile(
			join(root, "src", "pr", "module-state-extra.ts"),
			"export {};\n",
		);
		const issues = await checkModuleStructure(root);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					domain: "footer",
					path: "src/footer/footer-rendering.ts",
				}),
				expect.objectContaining({
					domain: "pr",
					path: "src/pr/module-state-extra.ts",
					message: "unclassified TypeScript implementation file",
				}),
			]),
		);
	});

	it("returns deterministic sorted diagnostics for multiple missing facets", async () => {
		const root = await validFixture();
		await (await import("node:fs/promises")).rm(
			join(root, "src", "pr", "commands.ts"),
		);
		await (await import("node:fs/promises")).rm(
			join(root, "src", "footer", "internal-state.ts"),
		);
		const issues = await checkModuleStructure(root);
		expect(issues.map((issue) => issue.path)).toEqual([
			"src/footer/internal-state.ts",
			"src/pr/commands.ts",
		]);
	});
});
