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
	if (typeof value !== "object" || value === null) return "";
	const message = value as { role?: unknown; content?: unknown };
	if (message.role !== "assistant") return "";
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.map((part) =>
			typeof part === "object" && part !== null && "text" in part
				? String((part as { text?: unknown }).text ?? "")
				: "",
		)
		.join(separator);
}
