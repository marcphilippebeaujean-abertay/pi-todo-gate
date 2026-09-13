import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerExtensionEventConsumers,
	registerModuleStateConsumer,
} from "./event-consumer.ts";
import { RootEventPublisher } from "./event-publishers.ts";
import { createExitProtocolModule } from "./exit-protocol/module.ts";
import { createFooterModule } from "./footer/module.ts";
import { installHerdrTabClaim } from "./herdr/module.ts";
import { createPrModule } from "./pr/module.ts";
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
	const stateUpdateEpoch = { value: 0 };
	const footer = createFooterModule({
		eventHandler,
		pi,
		dependencies: { openSession: dependencies.openSession },
	});
	const worktree = createWorktreeModule({
		eventHandler,
		sessionState,
		getLifecycleEpoch: () => lifecycleEpoch.value,
		dependencies: { exec: dependencies.exec },
	});
	const pr = createPrModule({
		pi,
		promptQueue,
		eventHandler,
		sessionState,
		getLifecycleEpoch: () => lifecycleEpoch.value,
		dependencies: { exec: dependencies.exec },
	});
	const todoist = createTodoistModule({
		pi,
		promptQueue,
		eventHandler,
		sessionState,
		getLifecycleEpoch: () => lifecycleEpoch.value,
		dependencies: {
			exec: dependencies.exec,
			taskClaimWorker: dependencies.taskClaimWorker,
			createTodoistClient: dependencies.createTodoistClient,
		},
	});
	// Register Todoist merge consumer before Exit Protocol subscribes to prMergedEvent.
	todoist.register();
	const exitProtocol = createExitProtocolModule({
		promptQueue,
		eventHandler,
		worktree,
		getLifecycleEpoch: () => lifecycleEpoch.value,
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
		session: null,
		publisher: new RootEventPublisher(eventHandler),
		lifecycleEpoch,
		stateUpdateEpoch,
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
		() => root.session !== null,
		root.stateUpdateEpoch,
	);
	registerExtensionEventConsumers(root);
	installHerdrTabClaim(pi, {
		commandRunner: dependencies.herdrCommandRunner,
		startBackgroundWorker: dependencies.herdrStartBackgroundWorker,
		onFooterUpdate: extensionState.footer.update.bind(extensionState.footer),
	});
	void root.publisher.publishPiToolRegistrationsBecameAvailable({ pi });
}

export default function extension(
	pi: ExtensionAPI,
	dependencies?: ExtensionDependencies,
): void {
	if (isSubagent()) return;
	startExtensions(pi, dependencies ?? {});
}
