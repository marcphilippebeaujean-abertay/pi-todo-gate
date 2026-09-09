const HTTPS_GITHUB_COM_OWNER_REPO_PULL_42 =
	"https://github.com/owner/repo/pull/42";
const HTTPS_GITHUB_COM_OWNER_REPO_PULL_123456789 =
	"https://github.com/owner/repo/pull/123456789";
const PR_LINK_PREFIX = "| PR Link: ";
const PR_NUMBER = "#42";
const BOUNDED_PR_NUMBER = "#12345…";

import { describe, expect, it } from "vitest";
import { renderPrLabel, renderPrStatus } from "../../src/pr/footer.ts";

const theme = { fg: (_color: string, text: string) => text };

describe("renderPrLabel", () => {
	it("renders a clickable normalized pull request label", () => {
		const label = renderPrLabel(HTTPS_GITHUB_COM_OWNER_REPO_PULL_42, theme);

		expect(label).toContain("PR #42");
		expect(label).toContain(HTTPS_GITHUB_COM_OWNER_REPO_PULL_42);
	});

	it("renders no PR for missing or invalid values", () => {
		expect(renderPrLabel(undefined, theme)).toBe("PR: none");
		expect(renderPrLabel("https://example.com/pr/42", theme)).toBe("PR: none");
	});
});

describe("renderPrStatus", () => {
	it("renders the PR link status with a clickable number", () => {
		const status = renderPrStatus(HTTPS_GITHUB_COM_OWNER_REPO_PULL_42, theme);

		expect(status).toContain(PR_LINK_PREFIX);
		expect(status).toContain(PR_NUMBER);
		expect(status).toContain(HTTPS_GITHUB_COM_OWNER_REPO_PULL_42);
	});

	it("bounds long PR numbers", () => {
		const status = renderPrStatus(
			HTTPS_GITHUB_COM_OWNER_REPO_PULL_123456789,
			theme,
		);

		expect(status).toContain(BOUNDED_PR_NUMBER);
		expect(status).not.toContain("#123456789");
	});
});
