const ACCEPTS_A_VALID_GITHUB_PULL_REQUEST_URL =
	"accepts a valid GitHub pull request URL";
const HTTPS_GITHUB_COM_OWNER_REPO_PULL_42 =
	"https://github.com/owner/repo/pull/42";
const REMOVES_QUERY_HASH_AND_TRAILING_PUNCTUATION =
	"removes query, hash, and trailing punctuation";
const SEE_HTTPS_GITHUB_COM_OWNER_REPO_PULL =
	"See (https://github.com/owner/repo/pull/42?tab=files#x).";
const REJECTS_INVALID_PATHS_AND_NON_GITHUB_URLS =
	"rejects invalid paths and non-GitHub URLs";
const HTTPS_GITHUB_COM_OWNER_REPO_ISSUES_42 =
	"https://github.com/owner/repo/issues/42";
const HTTPS_GITLAB_COM_OWNER_REPO_PULL_42 =
	"https://gitlab.com/owner/repo/pull/42";
const HTTPS_GITHUB_COM_OWNER_REPO_PULL_0 =
	"https://github.com/owner/repo/pull/0";
const SCANS_OLDEST_TO_NEWEST_AND_KEEPS_THE =
	"scans oldest-to-newest and keeps the first valid URL";
const NO_PULL_REQUEST_HERE = "No pull request here";
const HTTPS_GITHUB_COM_OLD_REPO_PULL_7 = "https://github.com/old/repo/pull/7";
const HTTPS_GITHUB_COM_NEW_REPO_PULL_8 = "https://github.com/new/repo/pull/8";
const ACCEPTS_A_PLACEHOLDER_SHAPED_PR_URL =
	"accepts a placeholder-shaped PR URL for later verification";
const HTTPS_GITHUB_COM_O_R_PULL_2 = "https://github.com/o/r/pull/2";
const FILTERS_INVALID_AND_NON_GITHUB_PR_LINKS =
	"filters invalid and non-GitHub PR links";

import { describe, expect, it } from "vitest";
import {
	firstGithubPrUrl,
	githubPrUrl,
	githubPrUrls,
} from "../../src/pr/module.ts";

describe("githubPrUrl", () => {
	it(ACCEPTS_A_VALID_GITHUB_PULL_REQUEST_URL, () => {
		expect(githubPrUrl(HTTPS_GITHUB_COM_OWNER_REPO_PULL_42)).toBe(
			HTTPS_GITHUB_COM_OWNER_REPO_PULL_42,
		);
	});

	it(REMOVES_QUERY_HASH_AND_TRAILING_PUNCTUATION, () => {
		expect(githubPrUrl(SEE_HTTPS_GITHUB_COM_OWNER_REPO_PULL)).toBe(
			HTTPS_GITHUB_COM_OWNER_REPO_PULL_42,
		);
	});

	it(REJECTS_INVALID_PATHS_AND_NON_GITHUB_URLS, () => {
		expect(githubPrUrl(HTTPS_GITHUB_COM_OWNER_REPO_ISSUES_42)).toBeNull();
		expect(githubPrUrl(HTTPS_GITLAB_COM_OWNER_REPO_PULL_42)).toBeNull();
		expect(githubPrUrl(HTTPS_GITHUB_COM_OWNER_REPO_PULL_0)).toBeNull();
	});
});

describe("githubPrUrls", () => {
	it(FILTERS_INVALID_AND_NON_GITHUB_PR_LINKS, () => {
		expect(
			githubPrUrls(
				[
					HTTPS_GITHUB_COM_OWNER_REPO_PULL_42,
					HTTPS_GITHUB_COM_OWNER_REPO_ISSUES_42,
					HTTPS_GITLAB_COM_OWNER_REPO_PULL_42,
				].join(" "),
			),
		).toEqual([HTTPS_GITHUB_COM_OWNER_REPO_PULL_42]);
	});
});

describe("firstGithubPrUrl", () => {
	it(SCANS_OLDEST_TO_NEWEST_AND_KEEPS_THE, () => {
		expect(
			firstGithubPrUrl([
				NO_PULL_REQUEST_HERE,
				HTTPS_GITHUB_COM_OLD_REPO_PULL_7,
				HTTPS_GITHUB_COM_NEW_REPO_PULL_8,
			]),
		).toBe(HTTPS_GITHUB_COM_OLD_REPO_PULL_7);
	});

	it(ACCEPTS_A_PLACEHOLDER_SHAPED_PR_URL, () => {
		expect(firstGithubPrUrl([HTTPS_GITHUB_COM_O_R_PULL_2])).toBe(
			HTTPS_GITHUB_COM_O_R_PULL_2,
		);
	});
});
