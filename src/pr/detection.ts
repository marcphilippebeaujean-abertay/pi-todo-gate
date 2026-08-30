const PR_CANDIDATE = /https?:\/\/github\.com\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)}\]]+$/g;

function normalizedGithubPrUrl(candidate: string): string | null {
	const trimmed = candidate.replace(TRAILING_PUNCTUATION, "");
	try {
		const url = new URL(trimmed);
		if (url.hostname.toLowerCase() !== "github.com") return null;
		const match = url.pathname.match(
			/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/,
		);
		if (!match) return null;
		return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
	} catch {
		return null;
	}
}

function githubPrUrls(text: string): string[] {
	const urls: string[] = [];
	for (const candidate of text.match(PR_CANDIDATE) ?? []) {
		const normalized = normalizedGithubPrUrl(candidate);
		if (normalized) urls.push(normalized);
	}
	return urls;
}

export function githubPrUrl(text: string): string | null {
	return githubPrUrls(text)[0] ?? null;
}

export function firstGithubPrUrl(texts: readonly string[]): string | null {
	for (const text of texts) {
		const url = githubPrUrl(text);
		if (url) return url;
	}
	return null;
}

export function firstUnmergedGithubPrUrl(
	texts: readonly string[],
	mergedPrs: readonly string[],
): string | null {
	const merged = new Set(mergedPrs);
	for (const text of texts) {
		for (const url of githubPrUrls(text)) {
			if (!merged.has(url)) return url;
		}
	}
	return null;
}
