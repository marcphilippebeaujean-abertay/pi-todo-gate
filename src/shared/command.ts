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
					child.kill("SIGTERM");
				}, options.timeout)
			: undefined;
		const onAbort = () => {
			killed = true;
			child.kill("SIGTERM");
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			finish({ stdout, stderr: `${stderr}${error.message}`, code: 1, killed });
		});
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			finish({ stdout, stderr, code: code ?? 1, killed });
		});
	});
