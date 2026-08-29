const PR_CANDIDATE = /https?:\/\/github\.com\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)}\]]+$/g;

export function githubPrUrl(text: string): string | null {
	for (const candidate of text.match(PR_CANDIDATE) ?? []) {
		const trimmed = candidate.replace(TRAILING_PUNCTUATION, "");
		try {
			const url = new URL(trimmed);
			if (url.hostname.toLowerCase() !== "github.com") continue;
			const match = url.pathname.match(
				/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/,
			);
			if (!match) continue;
			return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
		} catch {
			// Ignore malformed URL candidates and continue scanning the text.
		}
	}
	return null;
}

export function firstGithubPrUrl(texts: readonly string[]): string | null {
	for (const text of texts) {
		const url = githubPrUrl(text);
		if (url) return url;
	}
	return null;
}
