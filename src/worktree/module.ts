import "./commands.ts";
import "./git.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import { WorktreeConsumer } from "./event-consumers.ts";
import type { WorktreeModuleOptions } from "./internal-state.ts";

export class WorktreeModule {
	private readonly consumer: WorktreeConsumer;

	constructor(options: WorktreeModuleOptions) {
		this.consumer = new WorktreeConsumer(options);
	}

	private sessionStart(
		context: Parameters<WorktreeConsumer["sessionStart"]>[0],
	) {
		return this.consumer.sessionStart(context);
	}

	private deactivate(): void {
		this.consumer.deactivate();
	}

	hasUncommittedChanges(): Promise<boolean | null> {
		return this.consumer.hasUncommittedChanges();
	}

	removeWorktree(options: { force: boolean }) {
		return this.consumer.removeWorktree(options);
	}
}
