function isString(value: unknown): value is string {
	return typeof value === "string";
}

function textFromPart(part: unknown): string {
	if (typeof part !== "object") return "";
	if (part === null) return "";
	const hasText = "text" in part;
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
			: ["--append-system-prompt", options.instructions]),
		...(options.thinking === undefined ? [] : ["--thinking", options.thinking]),
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
	const isAssistantMessage = message.role === "assistant";
	if (!isAssistantMessage) return "";
	const hasTextContent = isString(message.content);
	const textContent = hasTextContent ? (message.content as string) : undefined;
	if (textContent !== undefined) return textContent;
	if (!Array.isArray(message.content)) return "";
	return message.content.map(textFromPart).join(separator);
}
