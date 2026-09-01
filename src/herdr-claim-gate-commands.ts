const HERDR_COMMAND = "herdr";
const HERDR_ENVIRONMENT = "HERDR_ENV";
const HERDR_ENV_VALUE = "$HERDR_ENV";
const HERDR_ENV_BRACED_VALUE = `\${${HERDR_ENVIRONMENT}}`;
const HERDR_ENV_DEFAULT_VALUE = `\${${HERDR_ENVIRONMENT}:-}`;
const WORKSPACE_VALUE = "$HERDR_WORKSPACE_ID";
const TAB_VALUE = "$HERDR_TAB_ID";
const PANE_VALUE = "$HERDR_PANE_ID";
const ECHO = "echo";
const TEST = "test";
const PRINTF = "printf";
const PANE = "pane";
const TAB = "tab";
const AGENT = "agent";
const CURRENT = "current";
const LIST = "list";
const GET = "get";
const RENAME = "rename";
const MOVE = "move";
const WORKSPACE_OPTION = "--workspace";
const NEW_TAB_OPTION = "--new-tab";
const LABEL_OPTION = "--label";
const FOCUS_OPTION = "--focus";
const PRINTF_FORMAT = "%s\\n";
const HERDR_ENV_ECHO_PREFIX = `${HERDR_ENVIRONMENT}=`;
const ECHO_ENVIRONMENT_COMMANDS = new Set([
	`${HERDR_ENV_ECHO_PREFIX}${HERDR_ENV_VALUE}`,
	`${HERDR_ENV_ECHO_PREFIX}${HERDR_ENV_BRACED_VALUE}`,
	HERDR_ENV_VALUE,
	HERDR_ENV_BRACED_VALUE,
	HERDR_ENV_DEFAULT_VALUE,
]);
const FORBIDDEN_SHELL_CHARACTERS = /[;&|<>()`\r\n\\]/;
const ARGUMENT_PATTERN = /^[A-Za-z0-9_:./-]+$/;

type Tokens = string[] | undefined;

import { hasUnclosedQuote, shellSegments, shellWords } from "./shell-parser.ts";

function tokenize(command: string): Tokens {
	const hasForbiddenCharacter = FORBIDDEN_SHELL_CHARACTERS.test(command);
	if (hasForbiddenCharacter) return undefined;
	const hasInvalidQuote = hasUnclosedQuote(command);
	if (hasInvalidQuote) return undefined;
	const segments = shellSegments(command);
	const hasSingleSegment = segments.length === 1;
	if (!hasSingleSegment) return undefined;
	return shellWords(segments[0] ?? "");
}

function matches(tokens: Tokens, expected: readonly string[]): boolean {
	if (tokens === undefined) return false;
	const hasExpectedLength = tokens.length === expected.length;
	if (!hasExpectedLength) return false;
	return tokens.every((token, index) => token === expected[index]);
}

function hasValue(value: string): boolean {
	return ARGUMENT_PATTERN.test(value);
}

function isAllowedHerdrAction(args: string[]): boolean {
	const action = `${args[0] ?? ""}:${args[1] ?? ""}`;
	switch (action) {
		case `${TAB}:${GET}`: {
			const hasExpectedLength = args.length === 3;
			if (!hasExpectedLength) return false;
			return hasValue(args[2] ?? "");
		}
		case `${TAB}:${RENAME}`: {
			const hasExpectedLength = args.length === 4;
			if (!hasExpectedLength) return false;
			return args.slice(2).every(hasValue);
		}
		case `${PANE}:${MOVE}`: {
			const hasExpectedLength = args.length === 7;
			if (!hasExpectedLength) return false;
			const hasPaneId = hasValue(args[2] ?? "");
			const hasLabel = hasValue(args[5] ?? "");
			const hasValidIds = hasPaneId && hasLabel;
			if (!hasValidIds) return false;
			return matches(args.slice(3), [
				NEW_TAB_OPTION,
				LABEL_OPTION,
				args[5] ?? "",
				FOCUS_OPTION,
			]);
		}
		default:
			return false;
	}
}

function isAllowedHerdrCommand(tokens: Tokens): boolean {
	if (tokens === undefined) return false;
	const isHerdrCommand = tokens[0] === HERDR_COMMAND;
	if (!isHerdrCommand) return false;
	const args = tokens.slice(1);
	const fixedCommands = [
		[PANE, CURRENT],
		[AGENT, LIST],
		[PANE, LIST, WORKSPACE_OPTION, WORKSPACE_VALUE],
	];
	for (const expected of fixedCommands) {
		const isFixedCommand = matches(args, expected);
		if (isFixedCommand) return true;
	}
	return isAllowedHerdrAction(args);
}

function isEnvironmentCommand(tokens: Tokens): boolean {
	const hasTokens = tokens !== undefined;
	if (!hasTokens) return false;
	if (tokens === undefined) return false;
	const isEcho = tokens[0] === ECHO;
	const hasEchoArgument = tokens.length === 2;
	const isEchoWithArgument = isEcho && hasEchoArgument;
	if (isEchoWithArgument) return ECHO_ENVIRONMENT_COMMANDS.has(tokens[1] ?? "");
	return (
		matches(tokens, [TEST, HERDR_ENV_DEFAULT_VALUE, "=", "1"]) ||
		matches(tokens, [
			PRINTF,
			PRINTF_FORMAT,
			WORKSPACE_VALUE,
			TAB_VALUE,
			PANE_VALUE,
		])
	);
}

export function allowedCommand(command: string): boolean {
	const tokens = tokenize(command);
	return isEnvironmentCommand(tokens) || isAllowedHerdrCommand(tokens);
}

export function completesClaim(command: string): boolean {
	const tokens = tokenize(command);
	const hasHerdrTokens = tokens !== undefined && tokens[0] === HERDR_COMMAND;
	if (!hasHerdrTokens) return false;
	if (tokens === undefined) return false;
	const args = tokens.slice(1);
	const isRename = matches(args.slice(0, 2), [TAB, RENAME]);
	const isCompleteRename = isRename && args.length === 4;
	if (isCompleteRename) return true;
	const isMove = matches(args.slice(0, 2), [PANE, MOVE]);
	return isMove && args.length === 7;
}

export function isTabGet(command: string): boolean {
	const tokens = tokenize(command);
	if (tokens === undefined) return false;
	const isHerdrCommand = tokens[0] === HERDR_COMMAND;
	if (!isHerdrCommand) return false;
	const isTabCommand = tokens[1] === TAB;
	if (!isTabCommand) return false;
	const isGetCommand = tokens[2] === GET;
	if (!isGetCommand) return false;
	return tokens.length === 4;
}
