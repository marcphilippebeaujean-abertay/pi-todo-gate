const CHAINING_RE = /[;&|]|\$\(|`/;
const EMPTY_TEXT = "";
const ALLOWED: RegExp[] = [
	/^echo HERDR_ENV=\$\{?HERDR_ENV\}?$/,
	/^echo HERDR_ENV=['"]?\$\{?HERDR_ENV\}?['"]?$/,
	/^echo ['"]?\$\{?HERDR_ENV\}?['"]?$/,
	/^test "\$\{HERDR_ENV:-\}" = 1$/,
	/^printf '%s\\n' "\$HERDR_WORKSPACE_ID" "\$HERDR_TAB_ID" "\$HERDR_PANE_ID"$/,
	/^herdr pane current(\s.*)?$/,
	/^herdr pane list(\s.*)?$/,
	/^herdr tab get \S+(\s.*)?$/,
	/^herdr agent list(\s.*)?$/,
	/^herdr tab rename \S+ \S+(\s.*)?$/,
	/^herdr pane move \S+ --new-tab\b.*$/,
];

function normalize(command: string): string {
	return command.trim().replace(/\s+/g, " ");
}

export function allowedCommand(command: string): boolean {
	const normalized = normalize(command);
	const hasCommand = normalized !== EMPTY_TEXT;
	const hasNoChaining = !CHAINING_RE.test(normalized);
	const matchesAllowedPattern = ALLOWED.some((pattern) =>
		pattern.test(normalized),
	);
	const commandIsSafe = hasCommand && hasNoChaining;
	return commandIsSafe && matchesAllowedPattern;
}

export function completesClaim(command: string): boolean {
	const normalized = normalize(command);
	return (
		/^herdr tab rename \S+ \S+/.test(normalized) ||
		/^herdr pane move \S+ --new-tab\b/.test(normalized)
	);
}

export function isTabGet(command: string): boolean {
	return /^herdr tab get \S+/.test(normalize(command));
}
