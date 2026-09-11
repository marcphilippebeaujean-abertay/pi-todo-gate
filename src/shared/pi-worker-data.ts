export interface WorkerOutputStream {
	on(event: "data", listener: (chunk: Buffer | string) => void): void;
}

export interface PiWorkerProcess {
	stdout: WorkerOutputStream;
	stderr: WorkerOutputStream;
	on(event: "close" | "error", listener: (...args: unknown[]) => void): void;
	kill(signal?: NodeJS.Signals): boolean;
}

export interface PiWorkerSpawnOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	shell: false;
	stdio: ["ignore", "pipe", "pipe"];
}

export type PiWorkerSpawner = (
	command: string,
	args: readonly string[],
	options: PiWorkerSpawnOptions,
) => PiWorkerProcess;

export interface PiWorkerRequest<TResult> {
	prompt: string;
	instructions: string;
	parseResult(output: string): TResult | undefined;
	onResult(result: TResult): void;
	onFailure(message: string): void;
}

export interface PiWorkerRuntimeOptions {
	command?: string;
	cwd?: string;
	spawnWorker?: PiWorkerSpawner;
}

export interface PiWorkerHandle {
	cancel(): void;
}
