import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testRoot, "..");
const importPattern = /(?:from\s+|import\s+)["'](\.[^"']+)["']/g;

function filesUnder(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) return filesUnder(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}

function relativeSourcePath(path: string): string {
	return relative(projectRoot, path).replaceAll("\\", "/");
}

function importsOf(sourcePath: string): string[] {
	const absolutePath = resolve(projectRoot, sourcePath);
	const source = readFileSync(absolutePath, "utf8");
	const imports: string[] = [];
	for (const match of source.matchAll(importPattern)) {
		const target = resolve(dirname(absolutePath), match[1]);
		const withExtension = target.endsWith(".ts") ? target : `${target}.ts`;
		imports.push(relativeSourcePath(withExtension));
	}
	return imports;
}

function importsUnder(sourceDirectory: string): string[] {
	return filesUnder(resolve(projectRoot, sourceDirectory)).flatMap((file) =>
		importsOf(relativeSourcePath(file)),
	);
}

function directDomainImports(sourcePath: string): Set<"pr" | "todoist"> {
	const domains = new Set<"pr" | "todoist">();
	for (const imported of importsOf(sourcePath)) {
		if (imported.startsWith("src/pr/")) domains.add("pr");
		if (imported.startsWith("src/todoist/")) domains.add("todoist");
	}
	return domains;
}

describe("module architecture", () => {
	it("prevents PR code from importing Todoist code", () => {
		expect(
			importsUnder("src/pr").every(
				(imported) => !imported.startsWith("src/todoist/"),
			),
		).toBe(true);
	});

	it("prevents Todoist code from importing PR code", () => {
		expect(
			importsUnder("src/todoist").every(
				(imported) => !imported.startsWith("src/pr/"),
			),
		).toBe(true);
	});

	it("keeps shared code independent of both domains", () => {
		const imports = importsUnder("src/shared");
		expect(imports.every((imported) => !imported.startsWith("src/pr/"))).toBe(
			true,
		);
		expect(
			imports.every((imported) => !imported.startsWith("src/todoist/")),
		).toBe(true);
	});

	it("allows only the composition root to import both domains", () => {
		const sourceFiles = filesUnder(resolve(projectRoot, "src")).map(
			relativeSourcePath,
		);
		const importers = sourceFiles.filter(
			(sourcePath) => directDomainImports(sourcePath).size > 1,
		);
		expect(importers).toEqual([]);
		expect(importsOf("extensions/pi-todo-gate.ts")).toEqual(
			expect.arrayContaining(["src/pr/module.ts", "src/todoist/module.ts"]),
		);
	});

	it("keeps domain tests from importing the opposite implementation", () => {
		expect(
			importsUnder("test/pr").every(
				(imported) => !imported.startsWith("src/todoist/"),
			),
		).toBe(true);
		expect(
			importsUnder("test/todoist").every(
				(imported) => !imported.startsWith("src/pr/"),
			),
		).toBe(true);
	});
});
