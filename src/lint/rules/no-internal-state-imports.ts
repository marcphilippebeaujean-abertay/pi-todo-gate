import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const INTERNAL_STATE_PATTERN =
	/[\\/]src[\\/](pr|todoist|herdr|worktree|exit-protocol|footer)[\\/]internal-state\.ts$/;
const RULE_ID = "no-internal-state-imports" as const;
const PRIVATE_MESSAGE =
	"Internal state is private to its owning module; import module-state.ts or module.ts instead";
const SHARED_MESSAGE =
	"Shared code may import module-state.ts, not internal-state.ts";

type ScopedDomain =
	| "pr"
	| "todoist"
	| "herdr"
	| "worktree"
	| "exit-protocol"
	| "footer";

function normalizedPath(filePath: string): string {
	return filePath.replaceAll("\\", "/");
}

function sourceDomain(
	filePath: string,
): ScopedDomain | "shared" | "root" | null {
	const normalized = normalizedPath(filePath);
	const match = normalized.match(
		/\/src\/(pr|todoist|herdr|worktree|exit-protocol|footer)\//,
	);
	if (match !== null) return match[1] as ScopedDomain;
	if (/\/src\/shared\//.test(normalized)) return "shared";
	if (/\/src\//.test(normalized)) return "root";
	return null;
}

function resolveInternalState(
	sourceFile: ts.SourceFile,
	moduleSpecifier: string,
	program: ts.Program,
): ScopedDomain | undefined {
	const resolvedModule = ts.resolveModuleName(
		moduleSpecifier,
		sourceFile.fileName,
		program.getCompilerOptions(),
		ts.sys,
	).resolvedModule;
	if (resolvedModule === undefined) return undefined;
	const match = normalizedPath(resolvedModule.resolvedFileName).match(
		INTERNAL_STATE_PATTERN,
	);
	return match?.[1] as ScopedDomain | undefined;
}

function reportImport(
	sourceFile: ts.SourceFile,
	node: ts.Node,
	domain: ScopedDomain,
	diagnostics: Parameters<LintRule>[0]["diagnostics"],
): void {
	const category = sourceDomain(sourceFile.fileName);
	const message =
		category === "shared" ? SHARED_MESSAGE : `${PRIVATE_MESSAGE} (${domain})`;
	diagnostics.push(diagnostic(sourceFile, node, RULE_ID, message, 1, 0));
}

export const noInternalStateImports: LintRule = ({
	sourceFile,
	diagnostics,
	program,
}) => {
	const category = sourceDomain(sourceFile.fileName);
	if (category === null) return;
	for (const statement of sourceFile.statements) {
		const isImport = ts.isImportDeclaration(statement);
		const isExport = ts.isExportDeclaration(statement);
		if (!isImport && !isExport) continue;
		const moduleSpecifier = statement.moduleSpecifier;
		if (moduleSpecifier === undefined || !ts.isStringLiteral(moduleSpecifier))
			continue;
		const domain = resolveInternalState(
			sourceFile,
			moduleSpecifier.text,
			program,
		);
		if (domain === undefined || category === domain) continue;
		reportImport(sourceFile, moduleSpecifier, domain, diagnostics);
	}
};
