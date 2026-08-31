import { execFile } from "node:child_process";
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const script = join(
	dirname(new URL(import.meta.url).pathname),
	"..",
	"install.sh",
);

async function execute(args: string[], env: Record<string, string> = {}) {
	return run("bash", [script, ...args], { env: { ...process.env, ...env } });
}

describe("install.sh", () => {
	it("derives the target from PI_CODING_AGENT_DIR and creates a symlink", async () => {
		const agentDir = await mkdtemp(join("/tmp", "pi-todo-gate-agent-"));
		await execute([], { PI_CODING_AGENT_DIR: agentDir });
		const target = join(agentDir, "extensions", "pi-todo-gate", "index.ts");
		await expect(readFile(target, "utf8")).resolves.toContain(
			"export { default }",
		);
	});

	it("does not replace an unrelated non-symlink without --force", async () => {
		const agentDir = await mkdtemp(join("/tmp", "pi-todo-gate-agent-"));
		const target = join(agentDir, "extensions", "pi-todo-gate");
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, "unrelated", "utf8");
		await expect(
			execute([], { PI_CODING_AGENT_DIR: agentDir }),
		).rejects.toThrow();
		await expect(readFile(target, "utf8")).resolves.toBe("unrelated");
		await execute(["--force"], { PI_CODING_AGENT_DIR: agentDir });
		await expect(readFile(join(target, "index.ts"), "utf8")).resolves.toContain(
			"export { default }",
		);
	});

	it("preserves unrelated config mappings and writes a requested mapping", async () => {
		const agentDir = await mkdtemp(join("/tmp", "pi-todo-gate-agent-"));
		await mkdir(join(agentDir, "extensions"), { recursive: true });
		await writeFile(
			join(agentDir, "pi-todo-gate.json"),
			JSON.stringify({ projects: { "/other": "other-project" } }),
			"utf8",
		);
		await execute(["configure", "/repo", "id:123"], {
			PI_CODING_AGENT_DIR: agentDir,
		});
		await expect(
			readFile(join(agentDir, "pi-todo-gate.json"), "utf8"),
		).resolves.toEqual(
			`${JSON.stringify(
				{ projects: { "/other": "other-project", "/repo": "id:123" } },
				null,
				2,
			)}\n`,
		);
	});

	it("preserves project settings when reconfiguring a project", async () => {
		const agentDir = await mkdtemp(join("/tmp", "pi-todo-gate-agent-"));
		await writeFile(
			join(agentDir, "pi-todo-gate.json"),
			JSON.stringify({
				projects: {
					"/repo": {
						todoistProjectRef: "old-project",
						triggerOnlyOnBranches: false,
					},
				},
			}),
			"utf8",
		);
		await execute(["configure", "/repo", "new-project"], {
			PI_CODING_AGENT_DIR: agentDir,
		});
		await expect(
			readFile(join(agentDir, "pi-todo-gate.json"), "utf8"),
		).resolves.toEqual(
			`${JSON.stringify(
				{
					projects: {
						"/repo": {
							todoistProjectRef: "new-project",
							triggerOnlyOnBranches: false,
						},
					},
				},
				null,
				2,
			)}\n`,
		);
	});

	it("refuses a copied script with no extension source", async () => {
		const directory = await mkdtemp(join("/tmp", "pi-todo-gate-install-"));
		const copied = join(directory, "install.sh");
		await cp(script, copied);
		await chmod(copied, 0o755);
		await expect(
			run("bash", [copied], {
				env: { ...process.env, PI_CODING_AGENT_DIR: join(directory, "agent") },
			}),
		).rejects.toThrow();
	});
});
