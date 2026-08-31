import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	defaultConfigPath,
	loadConfig,
	parseConfig,
	resolveConfiguredProject,
} from "../src/todoist/config.ts";

describe("parseConfig", () => {
	it("accepts project mappings", () => {
		expect(parseConfig('{"projects":{"/repo":"merge-td"}}')).toEqual({
			projects: { "/repo": "merge-td" },
		});
	});

	it("accepts per-project worktree trigger settings", () => {
		expect(
			parseConfig(
				'{"projects":{"/repo":{"todoistProjectRef":"merge-td","triggersOnlyOnWorktree":false}}}',
			),
		).toEqual({
			projects: {
				"/repo": {
					todoistProjectRef: "merge-td",
					triggersOnlyOnWorktree: false,
				},
			},
		});
	});

	it("returns empty configuration for malformed input", () => {
		expect(parseConfig("not json")).toEqual({ projects: {} });
		expect(parseConfig('{"projects":["/repo"]}')).toEqual({ projects: {} });
	});

	it("drops empty keys and values", () => {
		expect(parseConfig('{"projects":{"":"merge-td","/repo":""}}')).toEqual({
			projects: {},
		});
	});
});

describe("resolveConfiguredProject", () => {
	it("resolves an exact coding root", () => {
		expect(
			resolveConfiguredProject("/repo", { projects: { "/repo": "merge-td" } }),
		).toEqual({
			codingRoot: resolve("/repo"),
			todoistProjectRef: "merge-td",
			triggersOnlyOnWorktree: true,
		});
	});

	it("defaults worktree-only triggering on", () => {
		expect(
			resolveConfiguredProject("/repo", {
				projects: {
					"/repo": {
						todoistProjectRef: "merge-td",
					},
				},
			}),
		).toMatchObject({ triggersOnlyOnWorktree: true });
	});

	it("allows task claiming outside worktrees when disabled", () => {
		expect(
			resolveConfiguredProject("/repo", {
				projects: {
					"/repo": {
						todoistProjectRef: "merge-td",
						triggersOnlyOnWorktree: false,
					},
				},
			}),
		).toMatchObject({ triggersOnlyOnWorktree: false });
	});

	it("resolves the nearest configured parent", () => {
		expect(
			resolveConfiguredProject("/repo/packages/app", {
				projects: {
					"/repo": "parent-project",
					"/repo/packages": "packages-project",
				},
			}),
		).toEqual({
			codingRoot: resolve("/repo/packages"),
			todoistProjectRef: "packages-project",
			triggersOnlyOnWorktree: true,
		});
	});

	it("does not match a distant sibling", () => {
		expect(
			resolveConfiguredProject("/repo-other/app", {
				projects: { "/repo": "merge-td" },
			}),
		).toBeNull();
	});

	it("returns null for an unconfigured directory", () => {
		expect(
			resolveConfiguredProject("/repo/app", {
				projects: { "/other": "merge-td" },
			}),
		).toBeNull();
	});

	it("normalizes configured paths", () => {
		expect(
			resolveConfiguredProject("/repo/packages/app", {
				projects: { "/repo/./packages/": "merge-td" },
			})?.codingRoot,
		).toBe(resolve("/repo/packages"));
	});
});

describe("loadConfig", () => {
	it("uses the configured Pi agent directory when provided", () => {
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = "/tmp/pi-agent";
		expect(defaultConfigPath()).toBe("/tmp/pi-agent/pi-todo-gate.json");
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	});
	it("loads a configured file", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-todo-gate-config-"));
		const path = join(directory, "config.json");
		await writeFile(path, '{"projects":{"/repo":"merge-td"}}', "utf8");
		await expect(loadConfig(path)).resolves.toEqual({
			projects: { "/repo": "merge-td" },
		});
	});

	it("returns empty configuration for a missing file", async () => {
		await expect(loadConfig("/missing/pi-todo-gate.json")).resolves.toEqual({
			projects: {},
		});
	});
});
