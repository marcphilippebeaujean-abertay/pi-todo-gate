const PR_CANDIDATE = /https?:\/\/github\.com\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)}\]]+$/g;
const GITHUB_HOSTNAME = "github.com";
const SCP_ORIGIN = /^(?:[^@/]+@)?([^:]+):(.+)$/;
const GIT_SUFFIX = /\.git$/i;

function repositoryKey(hostname: string, pathname: string): string | null {
	const isGithubHostname = hostname.toLowerCase() === GITHUB_HOSTNAME;
	if (!isGithubHostname) return null;
	const path = pathname.replace(/^\/+|\/+$/g, "").replace(GIT_SUFFIX, "");
	const parts = path.split("/");
	const hasTwoPathParts = parts.length === 2;
	const hasNonEmptyPathParts = parts.every(Boolean);
	const hasRepositoryPath = hasTwoPathParts && hasNonEmptyPathParts;
	if (!hasRepositoryPath) return null;
	return parts.map((part) => part.toLowerCase()).join("/");
}

function repositoryKeyFromOrigin(remoteOrigin: string): string | null {
	const value = remoteOrigin.trim();
	const hasUriScheme = value.includes("://");
	const scpMatch = hasUriScheme ? null : value.match(SCP_ORIGIN);
	const hasScpMatch = scpMatch !== null;
	if (hasScpMatch) {
		return repositoryKey(scpMatch[1] ?? "", scpMatch[2] ?? "");
	}
	try {
		const url = new URL(value);
		return repositoryKey(url.hostname, url.pathname);
	} catch {
		return null;
	}
}

function normalizedGithubPrUrl(candidate: string): string | null {
	const trimmed = candidate.replace(TRAILING_PUNCTUATION, "");
	try {
		const url = new URL(trimmed);
		const match = url.pathname.match(
			/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/,
		);
		const hasMatch = Array.isArray(match);
		if (!hasMatch) return null;
		const repository = repositoryKey(url.hostname, `/${match[1]}/${match[2]}`);
		if (repository === null) return null;
		return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
	} catch {
		return null;
	}
}

function belongsToOrigin(url: string, remoteOrigin: string): boolean {
	const originRepository = repositoryKeyFromOrigin(remoteOrigin);
	if (originRepository === null) return false;
	const parsedUrl = new URL(url);
	const match = parsedUrl.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\//);
	if (match === null) return false;
	const prRepository = repositoryKey(
		parsedUrl.hostname,
		`/${match[1]}/${match[2]}`,
	);
	return prRepository === originRepository;
}

export function githubPrUrls(
	text: string,
	remoteOrigin?: string | null,
): string[] {
	const urls: string[] = [];
	for (const candidate of text.match(PR_CANDIDATE) ?? []) {
		const normalized = normalizedGithubPrUrl(candidate);
		const hasNormalized = normalized !== null;
		if (!hasNormalized) continue;
		switch (remoteOrigin) {
			case undefined:
				urls.push(normalized);
				continue;
			case null:
				continue;
			default: {
				const hasMatchingOrigin = belongsToOrigin(normalized, remoteOrigin);
				if (hasMatchingOrigin) urls.push(normalized);
			}
		}
	}
	return urls;
}

export function githubPrUrl(
	text: string,
	remoteOrigin?: string | null,
): string | null {
	return githubPrUrls(text, remoteOrigin)[0] ?? null;
}

export function firstGithubPrUrl(
	texts: readonly string[],
	remoteOrigin?: string | null,
): string | null {
	for (const text of texts) {
		const url = githubPrUrl(text, remoteOrigin);
		const hasUrl = url !== null;
		if (hasUrl) return url;
	}
	return null;
}

export function firstUnmergedGithubPrUrl(
	texts: readonly string[],
	mergedPrs: readonly string[],
	remoteOrigin?: string | null,
): string | null {
	const merged = new Set(mergedPrs);
	for (const text of texts) {
		for (const url of githubPrUrls(text, remoteOrigin)) {
			const isUnmerged = !merged.has(url);
			if (isUnmerged) return url;
		}
	}
	return null;
}
