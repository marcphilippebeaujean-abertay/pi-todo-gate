const STRING_LITERAL_SIGTERM_39E4715D = "SIGTERM";
const STRING_LITERAL_ABORT_93019CA4 = "abort";
const STRING_LITERAL_DATA_43C26E9F = "data";
const STRING_LITERAL_ERROR_F0240F74 = "error";
const STRING_LITERAL_CLOSE_D1008445 = "close";

import { spawn } from "node:child_process";

export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

export type Exec = (
	command: string,
	args: string[],
	options?: { timeout?: number; signal?: AbortSignal; cwd?: string },
) => Promise<CommandResult>;

export const spawnExec: Exec = (command, args, options = {}) =>
	new Promise((resolveResult) => {
		const child = spawn(command, args, { cwd: options.cwd, shell: false });
		child.stdin?.end();
		let stdout = "";
		let stderr = "";
		let killed = false;
		let settled = false;
		const finish = (result: CommandResult) => {
			if (settled) return;
			settled = true;
			resolveResult(result);
		};
		const timer = options.timeout
			? setTimeout(() => {
					killed = true;
					child.kill(STRING_LITERAL_SIGTERM_39E4715D);
				}, options.timeout)
			: undefined;
		const onAbort = () => {
			killed = true;
			child.kill(STRING_LITERAL_SIGTERM_39E4715D);
		};
		options.signal?.addEventListener(STRING_LITERAL_ABORT_93019CA4, onAbort, {
			once: true,
		});
		child.stdout.on(STRING_LITERAL_DATA_43C26E9F, (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on(STRING_LITERAL_DATA_43C26E9F, (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on(STRING_LITERAL_ERROR_F0240F74, (error) => {
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener(
				STRING_LITERAL_ABORT_93019CA4,
				onAbort,
			);
			finish({ stdout, stderr: `${stderr}${error.message}`, code: 1, killed });
		});
		child.on(STRING_LITERAL_CLOSE_D1008445, (code) => {
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener(
				STRING_LITERAL_ABORT_93019CA4,
				onAbort,
			);
			finish({ stdout, stderr, code: code ?? 1, killed });
		});
	});
