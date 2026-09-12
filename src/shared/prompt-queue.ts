export type PromptTask<T> = (isCurrent: () => boolean) => Promise<T> | T;

export class PromptQueue {
	private queue = Promise.resolve();
	private epoch = 0;

	enqueue<T>(task: PromptTask<T>): Promise<T | undefined> {
		const taskEpoch = this.epoch;
		const run = (): Promise<T | undefined> => this.run(task, taskEpoch);
		const next = this.queue.then(run, run);
		this.queue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	reset(): void {
		this.epoch += 1;
	}

	private async run<T>(
		task: PromptTask<T>,
		taskEpoch: number,
	): Promise<T | undefined> {
		const isStale = taskEpoch !== this.epoch;
		if (isStale) return undefined;
		return task(this.isCurrent.bind(this, taskEpoch));
	}

	private isCurrent(taskEpoch: number): boolean {
		return taskEpoch === this.epoch;
	}

	drain(): Promise<void> {
		return this.queue;
	}
}
