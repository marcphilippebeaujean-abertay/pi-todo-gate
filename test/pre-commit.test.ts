import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hookPath = join(projectRoot, ".githooks", "pre-commit");
const HOOK_SETUP = "git config core.hooksPath .githooks";
const LINT_COMMAND = "run lint";
const TYPECHECK_COMMAND = "run typecheck";

async function createFakeNpm(directory: string): Promise<string> {
	const npmPath = join(directory, "npm");
	await writeFile(
		npmPath,
		`#!/bin/sh
printf '%s\\n' "$*" >> "$HOOK_LOG"
if [ "$*" = "$FAIL_COMMAND" ]; then exit 1; fi
`,
	);
	await chmod(npmPath, 0o755);
	return npmPath;
}

describe("pre-commit hook", () => {
	it("runs lint and typecheck", async () => {
		const hook = await readFile(hookPath, "utf8");
		const directory = await mkdtemp(join(tmpdir(), "pi-todo-gate-hook-"));
		const logPath = join(directory, "commands.log");
		const npmPath = await createFakeNpm(directory);

		await run("bash", [hookPath], {
			env: {
				...process.env,
				PATH: `${dirname(npmPath)}:${process.env.PATH ?? ""}`,
				HOOK_LOG: logPath,
			},
		});

		expect(hook).toContain("set -eu");
		expect(await readFile(logPath, "utf8")).toBe(
			`${LINT_COMMAND}\n${TYPECHECK_COMMAND}\n`,
		);
	});

	it("stops commit when lint fails", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-todo-gate-hook-"));
		const logPath = join(directory, "commands.log");
		const npmPath = await createFakeNpm(directory);

		await expect(
			run("bash", [hookPath], {
				env: {
					...process.env,
					PATH: `${dirname(npmPath)}:${process.env.PATH ?? ""}`,
					HOOK_LOG: logPath,
					FAIL_COMMAND: LINT_COMMAND,
				},
			}),
		).rejects.toMatchObject({ code: 1 });
		expect(await readFile(logPath, "utf8")).toBe(`${LINT_COMMAND}\n`);
	});

	it("configures tracked hooks during npm install", async () => {
		const packageJson = JSON.parse(
			await readFile(join(projectRoot, "package.json"), "utf8"),
		) as { scripts?: { prepare?: string } };
		expect(packageJson.scripts?.prepare).toBe(HOOK_SETUP);
	});
});
