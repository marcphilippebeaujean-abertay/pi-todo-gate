import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	CANONICAL_FACETS,
	checkModuleStructure,
	SCOPED_DOMAINS,
} from "../../scripts/check-module-structure.ts";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

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

	it("requires every scoped module to define state.ts", async () => {
		for (const domain of SCOPED_DOMAINS)
			await expect(
				readFile(join(PROJECT_ROOT, "src", domain, "state.ts")),
			).resolves.toBeDefined();
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
		await writeFile(join(root, "src", "pr", "legacy.ts"), "export {};\n");
		const issues = await checkModuleStructure(root);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					domain: "footer",
					path: "src/footer/footer-rendering.ts",
				}),
				expect.objectContaining({
					domain: "pr",
					path: "src/pr/legacy.ts",
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
			join(root, "src", "footer", "state.ts"),
		);
		const issues = await checkModuleStructure(root);
		expect(issues.map((issue) => issue.path)).toEqual([
			"src/footer/state.ts",
			"src/pr/commands.ts",
		]);
	});
});
