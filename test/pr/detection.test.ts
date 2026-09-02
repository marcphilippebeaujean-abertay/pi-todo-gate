import { describe, expect, it } from "vitest";
import {
	firstGithubPrUrl,
	firstUnmergedGithubPrUrl,
	githubPrUrl,
} from "../../src/pr/detection.ts";

describe("githubPrUrl", () => {
	it("accepts a valid GitHub pull request URL", () => {
		expect(githubPrUrl("https://github.com/owner/repo/pull/42")).toBe(
			"https://github.com/owner/repo/pull/42",
		);
	});

	it("removes query, hash, and trailing punctuation", () => {
		expect(
			githubPrUrl("See (https://github.com/owner/repo/pull/42?tab=files#x)."),
		).toBe("https://github.com/owner/repo/pull/42");
	});

	it("rejects invalid paths and non-GitHub URLs", () => {
		expect(githubPrUrl("https://github.com/owner/repo/issues/42")).toBeNull();
		expect(githubPrUrl("https://gitlab.com/owner/repo/pull/42")).toBeNull();
		expect(githubPrUrl("https://github.com/owner/repo/pull/0")).toBeNull();
	});
});

describe("firstGithubPrUrl", () => {
	it("scans oldest-to-newest and keeps the first valid URL", () => {
		expect(
			firstGithubPrUrl([
				"No pull request here",
				"https://github.com/old/repo/pull/7",
				"https://github.com/new/repo/pull/8",
			]),
		).toBe("https://github.com/old/repo/pull/7");
	});
});

describe("firstUnmergedGithubPrUrl", () => {
	it("skips merged URLs and returns next discovered URL", () => {
		expect(
			firstUnmergedGithubPrUrl(
				[
					"https://github.com/old/repo/pull/7 https://github.com/new/repo/pull/8",
				],
				["https://github.com/old/repo/pull/7"],
			),
		).toBe("https://github.com/new/repo/pull/8");
	});
});
