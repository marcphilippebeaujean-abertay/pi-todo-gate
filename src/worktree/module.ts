import "./commands.ts";
import "./git.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import { Worktree } from "./event-consumers.ts";
import type { WorktreeModuleOptions } from "./internal-state.ts";

export class WorktreeModule {
	private readonly consumer: Worktree;

	constructor(options: WorktreeModuleOptions) {
		this.consumer = new Worktree(options);
	}

	private sessionStart(context: Parameters<Worktree["sessionStart"]>[0]) {
		return this.consumer.sessionStart(context);
	}

	private deactivate(): void {
		this.consumer.deactivate();
	}

	getWorktreeInfo() {
		return this.consumer.getWorktreeInfo();
	}

	hasUncommittedChanges(): Promise<boolean | null> {
		return this.consumer.hasUncommittedChanges();
	}

	removeWorktree(options: { force: boolean }) {
		return this.consumer.removeWorktree(options);
	}
}
