const CHAINING_RE = /[;&|]|\$\(|`/;
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
	return Boolean(
		normalized &&
			!CHAINING_RE.test(normalized) &&
			ALLOWED.some((pattern) => pattern.test(normalized)),
	);
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

function labelIsDescriptive(label: string | undefined | null): boolean {
	if (!label) return false;
	const value = label.trim();
	return Boolean(value) && !/^\d+$/.test(value);
}

function extractLabel(text: string): string | undefined {
	return text.match(/"label"\s*:\s*"([^"]*)"/)?.[1];
}

function textOf(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((part) =>
			typeof part === "object" && part !== null && "text" in part
				? String(part.text)
				: "",
		)
		.join("\n");
}
