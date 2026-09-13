import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export const SCOPED_DOMAINS = [
	"pr",
	"todoist",
	"herdr",
	"worktree",
	"exit-protocol",
	"footer",
] as const;

export const CANONICAL_FACETS = [
	"commands.ts",
	"constants.ts",
	"state.ts",
	"events.ts",
	"event-consumers.ts",
	"event-publishers.ts",
	"user-prompts.ts",
	"notifications.ts",
	"module.ts",
] as const;

const ADDITIONAL_FACETS: Readonly<Record<string, readonly string[]>> = {
	herdr: ["claim-worker-result.ts", "runtime.ts", "tab-validation.ts"],
	pr: ["git.ts", "parsing.ts", "state-tool.ts"],
	todoist: ["client.ts", "completion.ts", "config.ts", "parsing.ts"],
	worktree: ["git.ts"],
};

function isAllowedFacet(domain: string, name: string): boolean {
	return (
		(CANONICAL_FACETS as readonly string[]).includes(name) ||
		(ADDITIONAL_FACETS[domain] ?? []).includes(name)
	);
}

export interface StructureIssue {
	domain: string;
	path: string;
	message: string;
	correction: string;
}

const PRODUCTION_ROOTS = ["src", "extensions"] as const;
const FORBIDDEN_IDENTIFIERS = [
	"ActiveSession",
	"ExtensionRuntime",
	"SessionContext",
	"ApplicationContext",
	"PrRuntime",
	"TodoistRuntime",
	"StateToolRuntime",
	"ModuleContext",
] as const;
const SCOPED_EVENT_FILES =
	/src\/(pr|todoist|herdr|worktree|exit-protocol|footer)\/events\.ts$/;
const ALLOWED_NATIVE_ON =
	/(?:^|\.)pi\.on\(|(?:^|\.)(?:child|stdout|stderr)\??\.on\(/;

async function productionFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	async function visit(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(path);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
		}
	}
	for (const directory of PRODUCTION_ROOTS) {
		const path = join(root, directory);
		if (await isDirectory(path)) await visit(path);
	}
	return files;
}

export async function checkProductionArchitecture(
	root = process.cwd(),
): Promise<StructureIssue[]> {
	const issues: StructureIssue[] = [];
	const files = await productionFiles(root);
	for (const path of files) {
		const source = await readFile(path, "utf8");
		const relativePath = relative(root, path).replaceAll("\\", "/");
		for (const identifier of FORBIDDEN_IDENTIFIERS) {
			if (!new RegExp(`\\b${identifier}\\b`).test(source)) continue;
			issues.push({
				domain: "root",
				path: relativePath,
				message: `forbidden compatibility identifier ${identifier}`,
				correction: `remove ${identifier} from production architecture`,
			});
		}
		if (source.includes("shared/prompt-queue"))
			issues.push({
				domain: "root",
				path: relativePath,
				message: "PromptQueue must not live under shared",
				correction: "import PromptQueue from src/prompt-queue.ts",
			});
		for (const [lineNumber, line] of source.split("\n").entries()) {
			if (!line.includes(".on(")) continue;
			if (ALLOWED_NATIVE_ON.test(line.trim())) continue;
			issues.push({
				domain: "root",
				path: `${relativePath}:${lineNumber + 1}`,
				message:
					"production architecture must use typed Event channels, not .on()",
				correction: "use Event<T>.subscribe()",
			});
		}
		if (source.includes("setupListener"))
			issues.push({
				domain: "root",
				path: relativePath,
				message: "setupListener is not allowed in production architecture",
				correction: "use Event<T>.subscribe()",
			});
		if (!SCOPED_EVENT_FILES.test(relativePath)) continue;
		const declaresLocalEvent = /(?:interface|type)\s+Event\s*</.test(source);
		const usesTypedEvent = /\b(?:Event|event)<[A-Za-z]/.test(source);
		const importsSharedEvents = source.includes("shared/events.ts");
		if (declaresLocalEvent || (usesTypedEvent && !importsSharedEvents))
			issues.push({
				domain: relativePath.split("/")[1] ?? "root",
				path: relativePath,
				message: "module events must use shared Event<T>",
				correction: "import Event and event from src/shared/events.ts",
			});
	}
	const applicationPath = join(root, "src", "application");
	if (await isDirectory(applicationPath))
		issues.push({
			domain: "root",
			path: relative(root, applicationPath),
			message: "legacy application directory is not allowed",
			correction: `delete ${relative(root, applicationPath)}`,
		});
	for (const legacyPath of [
		join(root, "src", "shared", "module-context.ts"),
		join(root, "src", "pr-root.ts"),
	]) {
		if (!(await isFile(legacyPath))) continue;
		issues.push({
			domain: "root",
			path: relative(root, legacyPath),
			message: "transitional root adapter is not allowed",
			correction: `delete ${relative(root, legacyPath)}`,
		});
	}
	const queuePath = join(root, "src", "shared", "prompt-queue.ts");
	if (await isFile(queuePath))
		issues.push({
			domain: "root",
			path: relative(root, queuePath),
			message: "PromptQueue must not live under shared",
			correction: "move PromptQueue to src/prompt-queue.ts",
		});
	const sharedEventsPath = join(root, "src", "shared", "events.ts");
	if (await isFile(sharedEventsPath)) {
		const sharedEvents = await readFile(sharedEventsPath, "utf8");
		const mergedDeclarationCount =
			sharedEvents.match(/prMergedEvent:\s*Event<PrMergedEvent>/g)?.length ?? 0;
		const mergedConstructionCount =
			sharedEvents.match(/prMergedEvent\s*=\s*event<PrMergedEvent>/g)?.length ??
			0;
		if (mergedDeclarationCount !== 1 || mergedConstructionCount !== 1)
			issues.push({
				domain: "root",
				path: "src/shared/events.ts",
				message: "exactly one shared prMergedEvent channel is required",
				correction: "declare and construct one Event<PrMergedEvent>",
			});
	}
	const statePath = join(root, "src", "state.ts");
	const mainPath = join(root, "src", "main.ts");
	for (const path of files) {
		if (path === statePath || path === mainPath) continue;
		const source = await readFile(path, "utf8");
		if (!/\bExtensionState\b/.test(source)) continue;
		issues.push({
			domain: "root",
			path: relative(root, path),
			message: "ExtensionState is composed only by main.ts",
			correction: "move ExtensionState usage to src/main.ts",
		});
	}
	for (const path of [mainPath, join(root, "src", "event-consumer.ts")]) {
		if (!(await isFile(path))) continue;
		const source = await readFile(path, "utf8");
		if (!/\b(?:getSession|setSession)\b/.test(source)) continue;
		issues.push({
			domain: "root",
			path: relative(root, path),
			message: "root session callback adapters are not allowed",
			correction: "use root session composition field",
		});
	}
	return issues.sort((a, b) =>
		a.domain < b.domain || (a.domain === b.domain && a.path < b.path)
			? -1
			: a.domain === b.domain && a.path === b.path
				? 0
				: 1,
	);
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await lstat(path)).isDirectory();
	} catch {
		return false;
	}
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await lstat(path)).isFile();
	} catch {
		return false;
	}
}

export async function checkModuleStructure(
	root = process.cwd(),
): Promise<StructureIssue[]> {
	const issues: StructureIssue[] = [];
	const applicationPath = join(root, "src", "application");
	if (await isDirectory(applicationPath)) {
		issues.push({
			domain: "root",
			path: relative(root, applicationPath),
			message: "legacy application directory is not allowed",
			correction: `delete ${relative(root, applicationPath)}`,
		});
	}
	for (const domain of SCOPED_DOMAINS) {
		const domainPath = join(root, "src", domain);
		const hasDomain = await isDirectory(domainPath);
		if (!hasDomain) {
			issues.push({
				domain,
				path: relative(root, domainPath),
				message: "missing domain directory",
				correction: `create ${relative(root, domainPath)}`,
			});
			continue;
		}
		for (const facet of CANONICAL_FACETS) {
			const facetPath = join(domainPath, facet);
			if (await isFile(facetPath)) continue;
			issues.push({
				domain,
				path: relative(root, facetPath),
				message: "missing canonical file",
				correction: `create ${relative(root, facetPath)} (export {} is valid)`,
			});
		}
		if (domain === "footer") {
			const renderingPath = join(domainPath, "footer-rendering.ts");
			if (!(await isFile(renderingPath))) {
				issues.push({
					domain,
					path: relative(root, renderingPath),
					message: "missing footer-rendering.ts",
					correction: `create ${relative(root, renderingPath)}`,
				});
			}
		}
		const entries = await readdir(domainPath, { withFileTypes: true });
		for (const entry of entries) {
			const entryPath = relative(root, join(domainPath, entry.name));
			if (entry.isDirectory()) {
				issues.push({
					domain,
					path: entryPath,
					message: "nested domain directories are not allowed",
					correction: `move files from ${entryPath} into ${relative(root, domainPath)} or delete the directory`,
				});
				continue;
			}
			const isUnclassified =
				entry.isFile() &&
				entry.name.endsWith(".ts") &&
				!isAllowedFacet(domain, entry.name) &&
				!(domain === "footer" && entry.name === "footer-rendering.ts");
			if (!isUnclassified) continue;
			issues.push({
				domain,
				path: entryPath,
				message: "unclassified TypeScript implementation file",
				correction: `move ${entry.name} into a canonical facet or delete it`,
			});
		}
	}
	return issues.sort((a, b) =>
		a.domain < b.domain || (a.domain === b.domain && a.path < b.path)
			? -1
			: a.domain === b.domain && a.path === b.path
				? 0
				: 1,
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const issues = [
		...(await checkModuleStructure()),
		...(await checkProductionArchitecture()),
	];
	for (const issue of issues) {
		console.error(
			`${issue.domain}: ${issue.path}: ${issue.message}; expected ${issue.correction}`,
		);
	}
	process.exitCode = issues.length === 0 ? 0 : 1;
}
