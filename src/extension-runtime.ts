import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExitProtocolModule } from "./exit-protocol/module.ts";
import { registerTodoistExitAction } from "./exit-protocol/todoist-action.ts";
import type {
	ExtensionDependencies,
	ExtensionRuntime,
} from "./extension-types.ts";
import { createFooterModule } from "./footer/module.ts";
import { createSharedEvents } from "./shared/events.ts";
import { createWorktreeModule } from "./worktree/module.ts";

export function createExtensionRuntime(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): ExtensionRuntime {
	const events = createSharedEvents();
	const runtime: ExtensionRuntime = {
		pi,
		dependencies,
		events,
		exitProtocol: createExitProtocolModule(events),
		footer: createFooterModule(pi, {
			openSession: dependencies.openSession,
		}),
		worktree: createWorktreeModule(events, { exec: dependencies.exec }),
		active: null,
		registered: false,
	};
	registerTodoistExitAction(runtime);
	return runtime;
}
