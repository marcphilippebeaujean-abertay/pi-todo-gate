const EMPTY_STRING = "";
const ERROR_VALUE = "error";
const SPACE = " ";
const IDENTIFIES_A_LINKED_WORKTREE_AND_BRANCH =
	"identifies a linked worktree and branch";
const REPO_WORKTREES_FEATURE = "/repo/.worktrees/feature\n";
const FEATURE = "feature\n";
const WORKTREE_REPO_HEAD_ABC_BRANCH_REFS_HEADS =
	"worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/.worktrees/feature\nHEAD def\nbranch refs/heads/feature\n";
const REPO_WORKTREES_FEATURE_2 = "/repo/.worktrees/feature";
const FEATURE_2 = "feature";
const IDENTIFIES_THE_MAIN_CHECKOUT = "identifies the main checkout";
const REPO = "/repo\n";
const MAIN = "main\n";
const WORKTREE_REPO_HEAD_ABC_BRANCH_REFS_HEADS_2 =
	"worktree /repo\nHEAD abc\nbranch refs/heads/main\n";
const REPO_2 = "/repo";
const MAIN_2 = "main";
const PARSES_THE_FIRST_OPEN_PULL_REQUEST = "parses the first open pull request";
const URL_HTTPS_GITHUB_COM_O_R_PULL =
	'[{"url":"https://github.com/o/r/pull/42","state":"OPEN"}]';
const HTTPS_GITHUB_COM_O_R_PULL_42 = "https://github.com/o/r/pull/42";
const OPEN = "OPEN";
const RETURNS_OPEN_WITH_NO_URL_WHEN_THERE =
	"returns open with no URL when there is no open pull request";
const EMPTY_LIST_JSON = "[]";
const RETURNS_UNKNOWN_RATHER_THAN_THROWING_ON_UNAVAILABLE =
	"returns unknown rather than throwing on unavailable gh";
const UNKNOWN_VALUE = "UNKNOWN";
const PARSES_GIT_AND_GH_MERGE_COMMANDS = "parses git and gh merge commands";
const GIT_MERGE_FEATURE_AUTH = "git merge feature/auth";
const GIT_MERGE_NO_COMMIT_FEATURE_AUTH = "git merge --no-commit feature/auth";
const GIT = "git";
const FEATURE_AUTH = "feature/auth";
const GH_PR_MERGE_42_SQUASH = "gh pr merge 42 --squash";
const GH = "gh";
const VALUE_42 = "42";
const SQUASH = "--squash";
const REJECTS_COMPOUND_COMMANDS_SO_FAILED_MERGES_CANNOT =
	"rejects compound commands so failed merges cannot be masked";
const ECHO_GIT_MERGE_IGNORED_GIT_MERGE_FEATURE =
	'echo "git merge ignored" && git merge "feature/auth"';
const PRINTF_S_GH_PR_MERGE_42_GH =
	"printf '%s' 'gh pr merge 42'; gh pr merge 43";
const GIT_STATUS_PRINTF_GIT_MERGE_NO = "git status && printf 'git merge no'";
const GIT_MERGE_FEATURE_A_GIT_MERGE_FEATURE =
	"git merge feature/a; git merge feature/b";
const GIT_MERGE_FEATURE_A_TRUE = "git merge feature/a; true";
const IGNORES_UNRELATED_COMMANDS = "ignores unrelated commands";
const GIT_PUSH_ORIGIN_FEATURE_AUTH = "git push origin feature/auth";
const ECHO_GH_PR_MERGE_42 = "echo 'gh pr merge 42'";
const MATCHES_A_GH_MERGE_BY_PINNED_URL = "matches a gh merge by pinned URL";
const GH_PR_MERGE_HTTPS_GITHUB_COM_O =
	"gh pr merge https://github.com/o/r/pull/42";
const MATCHES_A_GIT_MERGE_BY_THE_PINNED =
	"matches a git merge by the pinned PR head branch";
const HEADREFNAME_FEATURE_AUTH = '{"headRefName":"feature/auth"}';
const REJECTS_AMBIGUOUS_OR_REPOSITORY_SELECTED_GH_MERGE =
	"rejects ambiguous or repository-selected gh merge targets";
const URL_HTTPS_GITHUB_COM_O_R_PULL_2 =
	'{"url":"https://github.com/o/r/pull/42","headRefName":"feature/auth"}';
const GH_PR_MERGE_42_43 = "gh pr merge 42 43";
const GH_PR_MERGE_REPO_OTHER_REPO_42 = "gh pr merge --repo other/repo 42";
const VALIDATES_GH_NUMBER_AND_BRANCH_TARGETS_AGAINST =
	"validates gh number and branch targets against the pinned repository";
const GH_PR_MERGE_42 = "gh pr merge 42";
const GH_PR_MERGE_FEATURE_AUTH = "gh pr merge feature/auth";
const URL_HTTPS_GITHUB_COM_OTHER_REPO_PULL =
	'{"url":"https://github.com/other/repo/pull/42","headRefName":"feature/auth"}';
const REJECTS_AMBIGUOUS_MERGE_TARGETS = "rejects ambiguous merge targets";
const GIT_MERGE_FEATURE_AUTH_OTHER = "git merge feature/auth other";

import { describe, expect, it } from "vitest";
import {
	type CommandResult,
	type Exec,
	findOpenPr,
	inspectWorktree,
	matchesPinnedPr,
	mergeCommand,
} from "../../src/git.ts";

const ok = (stdout: string): CommandResult => ({
	stdout,
	stderr: EMPTY_STRING,
	code: 0,
});
const fail = (stderr = ERROR_VALUE): CommandResult => ({
	stdout: EMPTY_STRING,
	stderr,
	code: 1,
});

function fakeExec(results: Record<string, CommandResult>): Exec {
	return async (command, args) =>
		results[[command, ...args].join(SPACE)] ??
		fail(`unexpected ${command} ${args.join(SPACE)}`);
}

describe("inspectWorktree", () => {
	it(IDENTIFIES_A_LINKED_WORKTREE_AND_BRANCH, async () => {
		const exec = fakeExec({
			"git rev-parse --show-toplevel": ok(REPO_WORKTREES_FEATURE),
			"git branch --show-current": ok(FEATURE),
			"git worktree list --porcelain": ok(
				WORKTREE_REPO_HEAD_ABC_BRANCH_REFS_HEADS,
			),
		});
		await expect(
			inspectWorktree(exec, REPO_WORKTREES_FEATURE_2),
		).resolves.toEqual({
			isWorktree: true,
			root: REPO_WORKTREES_FEATURE_2,
			branch: FEATURE_2,
		});
	});

	it(IDENTIFIES_THE_MAIN_CHECKOUT, async () => {
		const exec = fakeExec({
			"git rev-parse --show-toplevel": ok(REPO),
			"git branch --show-current": ok(MAIN),
			"git worktree list --porcelain": ok(
				WORKTREE_REPO_HEAD_ABC_BRANCH_REFS_HEADS_2,
			),
		});
		await expect(inspectWorktree(exec, REPO_2)).resolves.toEqual({
			isWorktree: false,
			root: REPO_2,
			branch: MAIN_2,
		});
	});
});

describe("findOpenPr", () => {
	it(PARSES_THE_FIRST_OPEN_PULL_REQUEST, async () => {
		const exec = fakeExec({
			"gh pr list --head feature --state open --json url,state --limit 1": ok(
				URL_HTTPS_GITHUB_COM_O_R_PULL,
			),
		});
		await expect(findOpenPr(exec, REPO_2, FEATURE_2)).resolves.toEqual({
			url: HTTPS_GITHUB_COM_O_R_PULL_42,
			state: OPEN,
		});
	});

	it(RETURNS_OPEN_WITH_NO_URL_WHEN_THERE, async () => {
		const exec = fakeExec({
			"gh pr list --head feature --state open --json url,state --limit 1":
				ok(EMPTY_LIST_JSON),
		});
		await expect(findOpenPr(exec, REPO_2, FEATURE_2)).resolves.toEqual({
			url: null,
			state: OPEN,
		});
	});

	it(RETURNS_UNKNOWN_RATHER_THAN_THROWING_ON_UNAVAILABLE, async () => {
		await expect(findOpenPr(fakeExec({}), REPO_2, FEATURE_2)).resolves.toEqual({
			url: null,
			state: UNKNOWN_VALUE,
		});
	});
});

describe("mergeCommand", () => {
	it(PARSES_GIT_AND_GH_MERGE_COMMANDS, () => {
		expect(mergeCommand(GIT_MERGE_FEATURE_AUTH)).toEqual({
			kind: GIT,
			args: [FEATURE_AUTH],
		});
		expect(mergeCommand(GH_PR_MERGE_42_SQUASH)).toEqual({
			kind: GH,
			args: [VALUE_42, SQUASH],
		});
	});

	it(REJECTS_COMPOUND_COMMANDS_SO_FAILED_MERGES_CANNOT, () => {
		expect(mergeCommand(ECHO_GIT_MERGE_IGNORED_GIT_MERGE_FEATURE)).toBeNull();
		expect(mergeCommand(PRINTF_S_GH_PR_MERGE_42_GH)).toBeNull();
		expect(mergeCommand(GIT_STATUS_PRINTF_GIT_MERGE_NO)).toBeNull();
		expect(mergeCommand(GIT_MERGE_FEATURE_A_GIT_MERGE_FEATURE)).toBeNull();
		expect(mergeCommand(GIT_MERGE_FEATURE_A_TRUE)).toBeNull();
	});

	it(IGNORES_UNRELATED_COMMANDS, () => {
		expect(mergeCommand(GIT_PUSH_ORIGIN_FEATURE_AUTH)).toBeNull();
		expect(mergeCommand(ECHO_GH_PR_MERGE_42)).toBeNull();
	});
});

describe("matchesPinnedPr", () => {
	it(MATCHES_A_GH_MERGE_BY_PINNED_URL, async () => {
		const exec = fakeExec({});
		await expect(
			matchesPinnedPr(
				exec,
				REPO_2,
				GH_PR_MERGE_HTTPS_GITHUB_COM_O,
				HTTPS_GITHUB_COM_O_R_PULL_42,
			),
		).resolves.toBe(true);
	});

	it(MATCHES_A_GIT_MERGE_BY_THE_PINNED, async () => {
		const exec = fakeExec({
			"gh pr view https://github.com/o/r/pull/42 --json headRefName": ok(
				HEADREFNAME_FEATURE_AUTH,
			),
		});
		await expect(
			matchesPinnedPr(
				exec,
				REPO_2,
				GIT_MERGE_FEATURE_AUTH,
				HTTPS_GITHUB_COM_O_R_PULL_42,
			),
		).resolves.toBe(true);
	});

	it("rejects a non-completing git merge", async () => {
		const exec = fakeExec({
			"gh pr view https://github.com/o/r/pull/42 --json headRefName": ok(
				HEADREFNAME_FEATURE_AUTH,
			),
		});
		await expect(
			matchesPinnedPr(
				exec,
				REPO_2,
				GIT_MERGE_NO_COMMIT_FEATURE_AUTH,
				HTTPS_GITHUB_COM_O_R_PULL_42,
			),
		).resolves.toBe(false);
	});

	it(REJECTS_AMBIGUOUS_OR_REPOSITORY_SELECTED_GH_MERGE, async () => {
		const exec = fakeExec({
			"gh pr view 42 --json url,headRefName": ok(
				URL_HTTPS_GITHUB_COM_O_R_PULL_2,
			),
		});
		await expect(
			matchesPinnedPr(
				exec,
				REPO_2,
				GH_PR_MERGE_42_43,
				HTTPS_GITHUB_COM_O_R_PULL_42,
			),
		).resolves.toBe(false);
		await expect(
			matchesPinnedPr(
				exec,
				REPO_2,
				GH_PR_MERGE_REPO_OTHER_REPO_42,
				HTTPS_GITHUB_COM_O_R_PULL_42,
			),
		).resolves.toBe(false);
	});

	it(VALIDATES_GH_NUMBER_AND_BRANCH_TARGETS_AGAINST, async () => {
		const exec = fakeExec({
			"gh pr view 42 --json url,headRefName": ok(
				URL_HTTPS_GITHUB_COM_O_R_PULL_2,
			),
			"gh pr view feature/auth --json url,headRefName": ok(
				URL_HTTPS_GITHUB_COM_O_R_PULL_2,
			),
		});
		await expect(
			matchesPinnedPr(
				exec,
				REPO_2,
				GH_PR_MERGE_42,
				HTTPS_GITHUB_COM_O_R_PULL_42,
			),
		).resolves.toBe(true);
		await expect(
			matchesPinnedPr(
				exec,
				REPO_2,
				GH_PR_MERGE_FEATURE_AUTH,
				HTTPS_GITHUB_COM_O_R_PULL_42,
			),
		).resolves.toBe(true);

		const otherRepo = fakeExec({
			"gh pr view 42 --json url,headRefName": ok(
				URL_HTTPS_GITHUB_COM_OTHER_REPO_PULL,
			),
		});
		await expect(
			matchesPinnedPr(
				otherRepo,
				REPO_2,
				GH_PR_MERGE_42,
				HTTPS_GITHUB_COM_O_R_PULL_42,
			),
		).resolves.toBe(false);
	});

	it(REJECTS_AMBIGUOUS_MERGE_TARGETS, async () => {
		const exec = fakeExec({
			"gh pr view https://github.com/o/r/pull/42 --json headRefName": ok(
				HEADREFNAME_FEATURE_AUTH,
			),
		});
		await expect(
			matchesPinnedPr(
				exec,
				REPO_2,
				GIT_MERGE_FEATURE_AUTH_OTHER,
				HTTPS_GITHUB_COM_O_R_PULL_42,
			),
		).resolves.toBe(false);
	});
});
