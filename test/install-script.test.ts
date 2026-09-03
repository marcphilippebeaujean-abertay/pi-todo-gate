const BASH = "bash";
const DERIVES_THE_TARGET_FROM_PI_CODING_AGENT =
	"derives the target from PI_CODING_AGENT_DIR and creates a symlink";
const TMP = "/tmp";
const PI_TODO_GATE_AGENT = "pi-todo-gate-agent-";
const EXTENSIONS = "extensions";
const PI_TODO_GATE = "pi-todo-gate";
const INDEX_TS = "index.ts";
const UTF8_ENCODING = "utf8";
const EXPORT_DEFAULT = "export { default }";
const DOES_NOT_REPLACE_AN_UNRELATED_NON_SYMLINK =
	"does not replace an unrelated non-symlink without --force";
const UNRELATED = "unrelated";
const FORCE = "--force";
const PRESERVES_UNRELATED_CONFIG_MAPPINGS_AND_WRITES_A =
	"preserves unrelated config mappings and writes a requested mapping";
const PI_TODO_GATE_JSON = "pi-todo-gate.json";
const OTHER_PROJECT = "other-project";
const CONFIGURE = "configure";
const REPO = "/repo";
const ID_123 = "id:123";
const REFUSES_A_COPIED_SCRIPT_WITH_NO_EXTENSION =
	"refuses a copied script with no extension source";
const PI_TODO_GATE_INSTALL = "pi-todo-gate-install-";
const INSTALL_SH = "install.sh";
const AGENT = "agent";

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
	return run(BASH, [script, ...args], {
		env: { ...process.env, ...env },
	});
}

describe("install.sh", () => {
	it(DERIVES_THE_TARGET_FROM_PI_CODING_AGENT, async () => {
		const agentDir = await mkdtemp(join(TMP, PI_TODO_GATE_AGENT));
		await execute([], { PI_CODING_AGENT_DIR: agentDir });
		const target = join(agentDir, EXTENSIONS, PI_TODO_GATE, INDEX_TS);
		await expect(readFile(target, UTF8_ENCODING)).resolves.toContain(
			EXPORT_DEFAULT,
		);
	});

	it(DOES_NOT_REPLACE_AN_UNRELATED_NON_SYMLINK, async () => {
		const agentDir = await mkdtemp(join(TMP, PI_TODO_GATE_AGENT));
		const target = join(agentDir, EXTENSIONS, PI_TODO_GATE);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, UNRELATED, UTF8_ENCODING);
		await expect(
			execute([], { PI_CODING_AGENT_DIR: agentDir }),
		).rejects.toThrow();
		await expect(readFile(target, UTF8_ENCODING)).resolves.toBe(UNRELATED);
		await execute([FORCE], { PI_CODING_AGENT_DIR: agentDir });
		await expect(
			readFile(join(target, INDEX_TS), UTF8_ENCODING),
		).resolves.toContain(EXPORT_DEFAULT);
	});

	it(PRESERVES_UNRELATED_CONFIG_MAPPINGS_AND_WRITES_A, async () => {
		const agentDir = await mkdtemp(join(TMP, PI_TODO_GATE_AGENT));
		await mkdir(join(agentDir, EXTENSIONS), { recursive: true });
		await writeFile(
			join(agentDir, PI_TODO_GATE_JSON),
			JSON.stringify({ projects: { "/other": OTHER_PROJECT } }),
			UTF8_ENCODING,
		);
		await execute([CONFIGURE, REPO, ID_123], {
			PI_CODING_AGENT_DIR: agentDir,
		});
		await expect(
			readFile(join(agentDir, PI_TODO_GATE_JSON), UTF8_ENCODING),
		).resolves.toEqual(
			`${JSON.stringify(
				{
					projects: {
						"/other": OTHER_PROJECT,
						"/repo": ID_123,
					},
				},
				null,
				2,
			)}\n`,
		);
	});

	it(REFUSES_A_COPIED_SCRIPT_WITH_NO_EXTENSION, async () => {
		const directory = await mkdtemp(join(TMP, PI_TODO_GATE_INSTALL));
		const copied = join(directory, INSTALL_SH);
		await cp(script, copied);
		await chmod(copied, 0o755);
		await expect(
			run(BASH, [copied], {
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: join(directory, AGENT),
				},
			}),
		).rejects.toThrow();
	});
});
