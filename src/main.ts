import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	appendState,
	registerExtensionEventConsumers,
	registerModuleStateConsumer,
	replaceSessionState,
} from "./event-consumer.ts";
import { RootEventPublisher } from "./event-publishers.ts";
import { createExitProtocolModule } from "./exit-protocol/module.ts";
import { createFooterModule, refreshFooterStatuses } from "./footer/module.ts";
import { installHerdrTabClaim } from "./herdr/module.ts";
import type { PrSession } from "./pr/state.ts";
import { installStateTool } from "./pr/state-tool.ts";
import { createRootPrModule } from "./pr-root.ts";
import { PromptQueue } from "./prompt-queue.ts";
import { createEventHandler } from "./shared/events.ts";
import { isSubagent } from "./shared/session.ts";
import {
	createSessionState,
	type ExtensionDependencies,
	type ExtensionState,
} from "./state.ts";
import { createTodoistModule } from "./todoist/module.ts";
import { createWorktreeModule } from "./worktree/module.ts";

export type { ExtensionDependencies, WorkStateAction } from "./state.ts";

export function createExtensionState(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): ExtensionState {
	const eventHandler = createEventHandler();
	const promptQueue = new PromptQueue();
	const sessionState = createSessionState();
	const lifecycleEpoch = { value: 0 };
	let activeSession: PrSession | null = null;
	let stateToolRegistered = false;
	const getSession = (): PrSession | null => activeSession;
	const setSession = (session: PrSession | null): void => {
		activeSession = session;
	};
	const footer = createFooterModule({
		eventHandler,
		pi,
		dependencies: { openSession: dependencies.openSession },
	});
	const worktree = createWorktreeModule({
		eventHandler,
		sessionState,
		dependencies: { exec: dependencies.exec },
	});
	const pr = createRootPrModule(
		promptQueue,
		eventHandler,
		sessionState,
		dependencies.exec,
		getSession,
		{
			appendState: (state, disabled) => appendState(root, state, disabled),
			replaceSessionState,
			refreshFooterStatuses: (session) =>
				refreshFooterStatuses(footer, session),
			getLifecycleEpoch: () => lifecycleEpoch.value,
		},
	);
	const todoist = createTodoistModule({
		promptQueue,
		eventHandler,
		sessionState,
		getSession,
		dependencies: {
			exec: dependencies.exec,
			taskClaimWorker: dependencies.taskClaimWorker,
			createTodoistClient: dependencies.createTodoistClient,
		},
		appendState: (state, disabled) => appendState(root, state, disabled),
		refreshFooterStatuses: (session) => refreshFooterStatuses(footer, session),
		replaceSessionState,
	});
	const exitProtocol = createExitProtocolModule({
		promptQueue,
		eventHandler,
		worktree,
	});
	const extensionState = {
		pi,
		dependencies,
		sessionState,
		promptQueue,
		eventHandler,
		footer,
		pr,
		todoist,
		worktree,
		exitProtocol,
		registered: false,
	} as ExtensionState;
	const root = {
		pi,
		dependencies,
		eventHandler,
		promptQueue,
		sessionState,
		footer,
		pr,
		todoist,
		worktree,
		exitProtocol,
		getSession,
		setSession,
		registered: () => stateToolRegistered,
		registerStateTool: (sessionGetter: () => PrSession | null) => {
			if (stateToolRegistered) return;
			installStateTool({
				pi,
				registered: false,
				getSession: sessionGetter,
				appendState: (state, disabled) => appendState(root, state, disabled),
				replaceSessionState,
				refreshFooterStatuses: (session) =>
					refreshFooterStatuses(footer, session),
			});
			stateToolRegistered = true;
			extensionState.registered = true;
		},
		publisher: new RootEventPublisher(eventHandler),
		lifecycleEpoch,
		stateUpdatesDrained: async () => undefined,
	};
	return Object.assign(extensionState, { root });
}

function startExtensions(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): void {
	const extensionState = createExtensionState(pi, dependencies);
	const root = (
		extensionState as ExtensionState & {
			root: Parameters<typeof registerExtensionEventConsumers>[0];
		}
	).root;
	root.stateUpdatesDrained = registerModuleStateConsumer(
		extensionState.eventHandler,
		extensionState.sessionState,
		() => root.getSession() !== null,
	);
	registerExtensionEventConsumers(root);
	extensionState.pr.register(pi);
	extensionState.todoist.register();
	installHerdrTabClaim(pi, {
		commandRunner: dependencies.herdrCommandRunner,
		startBackgroundWorker: dependencies.herdrStartBackgroundWorker,
		onFooterUpdate: extensionState.footer.update.bind(extensionState.footer),
	});
}

export default function extension(
	pi: ExtensionAPI,
	dependencies?: ExtensionDependencies,
): void {
	if (isSubagent()) return;
	startExtensions(pi, dependencies ?? {});
}
