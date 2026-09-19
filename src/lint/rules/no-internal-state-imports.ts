import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const INTERNAL_STATE_PATTERN =
	/[\\/]src[\\/](pr|todoist|herdr-tab-rename|review|worktree|prompt-queue|footer)[\\/]internal-state\.ts$/;
const RULE_ID = "no-internal-state-imports" as const;
const PRIVATE_MESSAGE =
	"Internal state is private to its owning module; import module-state.ts or module.ts instead";
const SHARED_MESSAGE =
	"Shared code may import module-state.ts, not internal-state.ts";

type ScopedDomain =
	| "pr"
	| "todoist"
	| "herdr-tab-rename"
	| "review"
	| "worktree"
	| "prompt-queue"
	| "footer";

function normalizedPath(filePath: string): string {
	return filePath.replaceAll("\\", "/");
}

function sourceDomain(
	filePath: string,
): ScopedDomain | "shared" | "root" | null {
	const normalized = normalizedPath(filePath);
	const match = normalized.match(
		/\/src\/(pr|todoist|herdr-tab-rename|review|worktree|prompt-queue|footer)\//,
	);
	if (match !== null) return match[1] as ScopedDomain;
	if (/\/src\/shared\//.test(normalized)) return "shared";
	if (/\/src\//.test(normalized)) return "root";
	return null;
}

interface InternalStateTarget {
	domain: ScopedDomain;
	path: string;
}

function resolveInternalState(
	sourceFile: ts.SourceFile,
	moduleSpecifier: string,
	program: ts.Program,
): InternalStateTarget | undefined {
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
	if (match === null) return undefined;
	const domain = match[1] as ScopedDomain;
	return { domain, path: `src/${domain}/internal-state.ts` };
}

function reportImport(
	sourceFile: ts.SourceFile,
	node: ts.Node,
	target: InternalStateTarget,
	diagnostics: Parameters<LintRule>[0]["diagnostics"],
): void {
	const category = sourceDomain(sourceFile.fileName);
	const message =
		category === "shared"
			? `${SHARED_MESSAGE} (${target.path})`
			: `${PRIVATE_MESSAGE} (${target.path})`;
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
		const target = resolveInternalState(
			sourceFile,
			moduleSpecifier.text,
			program,
		);
		if (target === undefined || category === target.domain) continue;
		reportImport(sourceFile, moduleSpecifier, target, diagnostics);
	}
};
