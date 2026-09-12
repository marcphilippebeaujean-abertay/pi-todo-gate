import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";
import type { ModuleContext } from "../shared/module-context.ts";
import type { WorktreeModule } from "../worktree/state.ts";
import {
	addWorktreeExitAction,
	enqueueExitActions,
} from "./event-publishers.ts";
import type { ExitProtocolModule, ExitRequest } from "./state.ts";

export class ExitProtocolConsumer implements ExitProtocolModule {
	private context: ExtensionContext | null = null;
	private readonly promptQueue: PromptQueue;
	private readonly worktree: WorktreeModule | undefined;

	constructor(
		events: EventHandler,
		promptQueue: PromptQueue,
		readonly _moduleContext?: ModuleContext,
		worktree?: WorktreeModule,
	) {
		this.promptQueue = promptQueue;
		this.worktree = worktree;
		events.prMergedEvent.subscribe(this.onPrMerged.bind(this));
	}

	sessionStart(context: ExtensionContext): void {
		this.context = context;
		void this._moduleContext?.eventHandler.moduleStateChangedEvent.emit({
			moduleId: C.module.exitProtocol,
			moduleState: { active: true },
		});
	}

	deactivate(): void {
		this.context = null;
		void this._moduleContext?.eventHandler.moduleStateChangedEvent.emit({
			moduleId: C.module.exitProtocol,
			moduleState: { active: false },
		});
	}

	private onPrMerged(request: ExitRequest): void {
		const context = this.context;
		if (context === null) return;
		addWorktreeExitAction(request, this.worktree);
		enqueueExitActions(
			this.promptQueue,
			context,
			request,
			() => this.context === context,
		);
	}
}
