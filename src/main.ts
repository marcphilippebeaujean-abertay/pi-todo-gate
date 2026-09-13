import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerExtensionEventConsumers,
	registerModuleStateConsumer,
} from "./event-consumer.ts";
import {
	createModuleStatePublisher,
	RootEventPublisher,
} from "./event-publishers.ts";
import { createExitProtocolModule } from "./exit-protocol/module.ts";
import { exitProtocolStateDescriptor } from "./exit-protocol/state.ts";
import { createFooterModule } from "./footer/module.ts";
import { footerStateDescriptor } from "./footer/state.ts";
import { HERDR_CLAIM_RETURNED } from "./herdr/constants.ts";
import { installHerdrTabClaim } from "./herdr/module.ts";
import { herdrStateDescriptor } from "./herdr/state.ts";
import { createPrModule } from "./pr/module.ts";
import { prStateDescriptor } from "./pr/state.ts";
import { PromptQueue } from "./prompt-queue.ts";
import {
	type ModuleStateDescriptors,
	serializeSessionState,
} from "./session-state-persistence.ts";
import { EXTENSION_CONSTANTS as C } from "./shared/constants.ts";
import { createEventHandler } from "./shared/events.ts";
import { isSubagent } from "./shared/session.ts";
import {
	createSessionState,
	type ExtensionDependencies,
	type ExtensionState,
} from "./state.ts";
import { createTodoistModule } from "./todoist/module.ts";
import { todoistStateDescriptor } from "./todoist/state.ts";
import { createWorktreeModule } from "./worktree/module.ts";
import { worktreeStateDescriptor } from "./worktree/state.ts";

export type { ExtensionDependencies } from "./state.ts";

export function createExtensionState(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): ExtensionState {
	const eventHandler = createEventHandler();
	const promptQueue = new PromptQueue();
	const sessionState = createSessionState();
	const stateDescriptors: ModuleStateDescriptors = {
		pr: prStateDescriptor,
		todoist: todoistStateDescriptor,
		herdr: herdrStateDescriptor,
		worktree: worktreeStateDescriptor,
		footer: footerStateDescriptor,
		exitProtocol: exitProtocolStateDescriptor,
	};
	const persistSessionState = (state: typeof sessionState): void => {
		pi.appendEntry(
			C.entry.state,
			serializeSessionState(state, stateDescriptors),
		);
	};
	const lifecycleEpoch = { value: 0 };
	const stateUpdateEpoch = { value: 0 };
	const footer = createFooterModule({
		eventHandler,
		sessionState,
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
		sessionState,
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
		stateDescriptors,
		persistSessionState,
	};
	return Object.assign(extensionState, { root });
}

function startExtensions(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): void {
	const extensionState = createExtensionState(pi, dependencies);
	const herdrStatePublisher = createModuleStatePublisher(
		extensionState.eventHandler,
		"herdr",
	);
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
		root.persistSessionState,
	);
	registerExtensionEventConsumers(root);
	installHerdrTabClaim(pi, {
		commandRunner: dependencies.herdrCommandRunner,
		startBackgroundWorker: dependencies.herdrStartBackgroundWorker,
		publishClaimInProgress: (claimInProgress) => {
			const current = extensionState.sessionState.moduleState.herdr;
			return herdrStatePublisher.publish(
				{ ...current, claimInProgress },
				{ persist: false },
			);
		},
		hasClaimReturnedSuccessfully: () =>
			extensionState.sessionState.moduleState.herdr
				.herdrClaimReturnedSuccessfully === HERDR_CLAIM_RETURNED,
		onClaimReturnedSuccessfully: () => {
			const current = extensionState.sessionState.moduleState.herdr;
			return herdrStatePublisher.publish(
				{
					...current,
					claimInProgress: false,
					herdrClaimReturnedSuccessfully: HERDR_CLAIM_RETURNED,
				},
				{ persist: true },
			);
		},
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
