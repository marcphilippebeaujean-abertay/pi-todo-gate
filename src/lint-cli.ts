import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { formatLintDiagnostic, lintProgram } from "./lint.ts";
import { loadLintConfig } from "./lint-config.ts";

const LINT_DIRECTORIES = ["extensions", "src", "test"];
const TEST_DIRECTORY = "test";
const LINT_INFRASTRUCTURE_PATHS = new Set([
	"src/lint.ts",
	"src/lint-config.ts",
	"src/lint-cli.ts",
]);
const TS_EXTENSION = ".ts";
const TS_CONFIG_NAME = "tsconfig.json";
const LINT_CONFIG_NAME = "lint.config.json";
const FALLBACK_COMPILER_OPTIONS: ts.CompilerOptions = {
	strict: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	noEmit: true,
};

function isExcludedPath(relativePath: string): boolean {
	const normalizedPath = relativePath.replaceAll("\\", "/");
	const isTestPath =
		normalizedPath === TEST_DIRECTORY ||
		normalizedPath.startsWith(`${TEST_DIRECTORY}/`);
	return isTestPath || LINT_INFRASTRUCTURE_PATHS.has(normalizedPath);
}

function collectDirectoryFiles(
	root: string,
	directory: string,
	relativeDirectory: string,
): string[] {
	if (!existsSync(directory)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		const relativePath = join(relativeDirectory, entry.name);
		if (entry.isDirectory())
			files.push(...collectDirectoryFiles(root, path, relativePath));
		else if (
			entry.isFile() &&
			path.endsWith(TS_EXTENSION) &&
			!isExcludedPath(relative(root, path))
		)
			files.push(path);
	}
	return files;
}

export function collectLintFiles(root: string): string[] {
	return LINT_DIRECTORIES.flatMap((directory) =>
		collectDirectoryFiles(root, join(root, directory), directory),
	).sort((left, right) => left.localeCompare(right));
}

function compilerOptionsFor(root: string): ts.CompilerOptions {
	const configPath = join(root, TS_CONFIG_NAME);
	if (!existsSync(configPath)) return FALLBACK_COMPILER_OPTIONS;
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	if (config.error) return FALLBACK_COMPILER_OPTIONS;
	return ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
}

function formatTypeScriptDiagnostic(
	diagnostic: ts.Diagnostic,
	root: string,
): string {
	const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
	if (!diagnostic.file || diagnostic.start === undefined)
		return `TypeScript ${message}`;
	const location = diagnostic.file.getLineAndCharacterOfPosition(
		diagnostic.start,
	);
	const filePath =
		relative(root, diagnostic.file.fileName) || diagnostic.file.fileName;
	return `${filePath}:${location.line + 1}:${location.character + 1} TypeScript ${message}`;
}

export async function runLint(
	root = process.cwd(),
	output: (line: string) => void = (line) => console.error(line),
): Promise<number> {
	const files = collectLintFiles(root);
	const program = ts.createProgram(files, compilerOptionsFor(root));
	const compilerDiagnostics = ts.getPreEmitDiagnostics(program);
	const config = await loadLintConfig(join(root, LINT_CONFIG_NAME));
	const customDiagnostics = lintProgram(program, config);
	for (const diagnostic of compilerDiagnostics)
		output(formatTypeScriptDiagnostic(diagnostic, root));
	for (const diagnostic of customDiagnostics)
		output(formatLintDiagnostic(diagnostic));
	return compilerDiagnostics.length || customDiagnostics.length ? 1 : 0;
}

const currentModule = fileURLToPath(import.meta.url);
const launchedModule = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentModule === launchedModule) {
	void runLint().then((status) => {
		process.exitCode = status;
	});
}
