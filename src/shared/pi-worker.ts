const STRING_LITERAL_APPEND_SYSTEM_PROMPT_37FFD3BC = "--append-system-prompt";
const STRING_LITERAL_THINKING_F687683B = "--thinking";
const STRING_LITERAL_TEXT_FF4FD29E = "text";
const STRING_LITERAL_ASSISTANT_4E38B6B0 = "assistant";
const STRING_LITERAL_STRING_9B5A5E11 = "string";

function isString(value: unknown): value is string {
	return typeof value === STRING_LITERAL_STRING_9B5A5E11;
}

function textFromPart(part: unknown): string {
	if (typeof part !== "object") return "";
	if (part === null) return "";
	const hasText = STRING_LITERAL_TEXT_FF4FD29E in part;
	if (!hasText) return "";
	return String((part as { text?: unknown }).text ?? "");
}

const BASE_PI_WORKER_ARGS = [
	"--mode",
	"json",
	"-p",
	"--no-extensions",
	"--no-context-files",
	"--tools",
	"bash",
] as const;

export interface PiWorkerOptions {
	instructions?: string;
	thinking?: string;
}

export function buildPiWorkerArgs(
	prompt: string,
	options: PiWorkerOptions = {},
): string[] {
	return [
		...BASE_PI_WORKER_ARGS,
		...(options.instructions === undefined
			? []
			: [STRING_LITERAL_APPEND_SYSTEM_PROMPT_37FFD3BC, options.instructions]),
		...(options.thinking === undefined
			? []
			: [STRING_LITERAL_THINKING_F687683B, options.thinking]),
		prompt,
	];
}

export function textFromAssistantMessage(
	value: unknown,
	separator = "\n",
): string {
	if (typeof value !== "object") return "";
	if (value === null) return "";
	const message = value as { role?: unknown; content?: unknown };
	const isAssistantMessage = message.role === STRING_LITERAL_ASSISTANT_4E38B6B0;
	if (!isAssistantMessage) return "";
	const textContent = isString(message.content) ? message.content : undefined;
	if (textContent !== undefined) return textContent;
	if (!Array.isArray(message.content)) return "";
	return message.content.map(textFromPart).join(separator);
}
