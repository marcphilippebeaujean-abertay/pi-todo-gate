import { lstat, readdir } from "node:fs/promises";
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
	herdr: ["claim-worker-result.ts", "tab-validation.ts"],
	pr: ["parsing.ts"],
	todoist: ["parsing.ts"],
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
	const issues = await checkModuleStructure();
	for (const issue of issues) {
		console.error(
			`${issue.domain}: ${issue.path}: ${issue.message}; expected ${issue.correction}`,
		);
	}
	process.exitCode = issues.length === 0 ? 0 : 1;
}
