import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	CANONICAL_FACETS,
	checkModuleStructure,
	SCOPED_DOMAINS,
} from "../../scripts/check-module-structure.ts";

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
	it("accepts all canonical files, including empty facets", async () => {
		expect(await checkModuleStructure(await validFixture())).toEqual([]);
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
});
