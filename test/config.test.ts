const ACCEPTS_PROJECT_MAPPINGS = "accepts project mappings";
const PROJECTS_REPO_MERGE_TD = '{"projects":{"/repo":"merge-td"}}';
const MERGE_TD = "merge-td";
const RETURNS_EMPTY_CONFIGURATION_FOR_MALFORMED_INPUT =
	"returns empty configuration for malformed input";
const NOT_JSON = "not json";
const PROJECTS_REPO = '{"projects":["/repo"]}';
const DROPS_EMPTY_KEYS_AND_VALUES = "drops empty keys and values";
const PROJECTS_MERGE_TD_REPO = '{"projects":{"":"merge-td","/repo":""}}';
const RESOLVES_AN_EXACT_CODING_ROOT = "resolves an exact coding root";
const REPO = "/repo";
const RESOLVES_THE_NEAREST_CONFIGURED_PARENT =
	"resolves the nearest configured parent";
const REPO_PACKAGES_APP = "/repo/packages/app";
const PARENT_PROJECT = "parent-project";
const PACKAGES_PROJECT = "packages-project";
const REPO_PACKAGES = "/repo/packages";
const DOES_NOT_MATCH_A_DISTANT_SIBLING = "does not match a distant sibling";
const REPO_OTHER_APP = "/repo-other/app";
const RETURNS_NULL_FOR_AN_UNCONFIGURED_DIRECTORY =
	"returns null for an unconfigured directory";
const REPO_APP = "/repo/app";
const NORMALIZES_CONFIGURED_PATHS = "normalizes configured paths";
const USES_THE_CONFIGURED_PI_AGENT_DIRECTORY_WHEN =
	"uses the configured Pi agent directory when provided";
const TMP_PI_AGENT = "/tmp/pi-agent";
const TMP_PI_AGENT_PI_TODO_GATE_JSON = "/tmp/pi-agent/pi-todo-gate.json";
const LOADS_A_CONFIGURED_FILE = "loads a configured file";
const PI_TODO_GATE_CONFIG = "pi-todo-gate-config-";
const CONFIG_JSON = "config.json";
const UTF8_ENCODING = "utf8";
const RETURNS_EMPTY_CONFIGURATION_FOR_A_MISSING_FILE =
	"returns empty configuration for a missing file";
const MISSING_PI_TODO_GATE_JSON = "/missing/pi-todo-gate.json";

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	defaultConfigPath,
	loadConfig,
	parseConfig,
	resolveConfiguredProject,
} from "../src/config.ts";

describe("parseConfig", () => {
	it(ACCEPTS_PROJECT_MAPPINGS, () => {
		expect(parseConfig(PROJECTS_REPO_MERGE_TD)).toEqual({
			projects: { "/repo": MERGE_TD },
		});
	});

	it(RETURNS_EMPTY_CONFIGURATION_FOR_MALFORMED_INPUT, () => {
		expect(parseConfig(NOT_JSON)).toEqual({ projects: {} });
		expect(parseConfig(PROJECTS_REPO)).toEqual({ projects: {} });
	});

	it(DROPS_EMPTY_KEYS_AND_VALUES, () => {
		expect(parseConfig(PROJECTS_MERGE_TD_REPO)).toEqual({
			projects: {},
		});
	});
});

describe("resolveConfiguredProject", () => {
	it(RESOLVES_AN_EXACT_CODING_ROOT, () => {
		expect(
			resolveConfiguredProject(REPO, {
				projects: { "/repo": MERGE_TD },
			}),
		).toEqual({
			codingRoot: resolve(REPO),
			todoistProjectRef: MERGE_TD,
		});
	});

	it(RESOLVES_THE_NEAREST_CONFIGURED_PARENT, () => {
		expect(
			resolveConfiguredProject(REPO_PACKAGES_APP, {
				projects: {
					"/repo": PARENT_PROJECT,
					"/repo/packages": PACKAGES_PROJECT,
				},
			}),
		).toEqual({
			codingRoot: resolve(REPO_PACKAGES),
			todoistProjectRef: PACKAGES_PROJECT,
		});
	});

	it(DOES_NOT_MATCH_A_DISTANT_SIBLING, () => {
		expect(
			resolveConfiguredProject(REPO_OTHER_APP, {
				projects: { "/repo": MERGE_TD },
			}),
		).toBeNull();
	});

	it(RETURNS_NULL_FOR_AN_UNCONFIGURED_DIRECTORY, () => {
		expect(
			resolveConfiguredProject(REPO_APP, {
				projects: { "/other": MERGE_TD },
			}),
		).toBeNull();
	});

	it(NORMALIZES_CONFIGURED_PATHS, () => {
		expect(
			resolveConfiguredProject(REPO_PACKAGES_APP, {
				projects: { "/repo/./packages/": MERGE_TD },
			})?.codingRoot,
		).toBe(resolve(REPO_PACKAGES));
	});
});

describe("loadConfig", () => {
	it(USES_THE_CONFIGURED_PI_AGENT_DIRECTORY_WHEN, () => {
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = TMP_PI_AGENT;
		expect(defaultConfigPath()).toBe(TMP_PI_AGENT_PI_TODO_GATE_JSON);
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	});
	it(LOADS_A_CONFIGURED_FILE, async () => {
		const directory = await mkdtemp(join(tmpdir(), PI_TODO_GATE_CONFIG));
		const path = join(directory, CONFIG_JSON);
		await writeFile(path, PROJECTS_REPO_MERGE_TD, UTF8_ENCODING);
		await expect(loadConfig(path)).resolves.toEqual({
			projects: { "/repo": MERGE_TD },
		});
	});

	it(RETURNS_EMPTY_CONFIGURATION_FOR_A_MISSING_FILE, async () => {
		await expect(loadConfig(MISSING_PI_TODO_GATE_JSON)).resolves.toEqual({
			projects: {},
		});
	});
});
