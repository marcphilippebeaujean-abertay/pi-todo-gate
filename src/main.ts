import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	registerExtensionEventConsumers,
	registerModuleStateConsumer,
} from "./event-consumer.ts";
import {
	createModuleStatePublisher,
	RootEventPublisher,
} from "./event-publishers.ts";
import { createExitProtocolModule } from "./exit-protocol/module.ts";
import type { ExitProtocolModule } from "./exit-protocol/state.ts";
import { exitProtocolStateDescriptor } from "./exit-protocol/state.ts";
import type { ExtensionDependencies as BaseExtensionDependencies } from "./extension-dependencies.ts";
import { createFooterModule } from "./footer/module.ts";
import type { FooterModule } from "./footer/state.ts";
import { footerStateDescriptor } from "./footer/state.ts";
import { HERDR_CLAIM_RETURNED } from "./herdr/constants.ts";
import { installHerdrTabClaim } from "./herdr/module.ts";
import type { CommandRunner, WorkerSpawner } from "./herdr/state.ts";
import { herdrStateDescriptor } from "./herdr/state.ts";
import { createPrModule } from "./pr/module.ts";
import type { PrModule } from "./pr/state.ts";
import { prStateDescriptor } from "./pr/state.ts";
import { PromptQueue } from "./prompt-queue.ts";
import {
	type ModuleStateDescriptors,
	serializeSessionState,
} from "./session-state-persistence.ts";
import type { Exec } from "./shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "./shared/constants.ts";
import type { EventHandler } from "./shared/events.ts";
import { createEventHandler } from "./shared/events.ts";
import { isSubagent } from "./shared/session.ts";
import { createSessionState } from "./state.ts";
import { createTodoistModule } from "./todoist/module.ts";
import type {
	TaskClaimWorker,
	TodoistClientLike,
	TodoistModule,
} from "./todoist/state.ts";
import { todoistStateDescriptor } from "./todoist/state.ts";
import { createWorktreeModule } from "./worktree/module.ts";
import { worktreeStateDescriptor } from "./worktree/state.ts";

export interface ExtensionDependencies extends BaseExtensionDependencies {
	createTodoistClient?: (
		ctx: ExtensionContext,
		exec: Exec,
	) => TodoistClientLike;
	taskClaimWorker?: TaskClaimWorker;
	herdrCommandRunner?: CommandRunner;
	herdrSpawnWorker?: WorkerSpawner;
}

interface ExtensionState {
	pi: ExtensionAPI;
	sessionState: import("./state.ts").SessionState;
	promptQueue: PromptQueue;
	eventHandler: EventHandler;
	footer: FooterModule;
	pr: PrModule;
	todoist: TodoistModule;
	worktree: import("./worktree/state.ts").WorktreeModule;
	exitProtocol: ExitProtocolModule;
}

interface ModuleSetupDependencies {
	exec?: Exec;
	createTodoistClient?: (
		ctx: ExtensionContext,
		exec: Exec,
	) => TodoistClientLike;
	taskClaimWorker?: TaskClaimWorker;
	herdrCommandRunner?: CommandRunner;
	herdrSpawnWorker?: WorkerSpawner;
}

export function createExtensionState(
	pi: ExtensionAPI,
	dependencies?: ExtensionDependencies,
): ExtensionState {
	const providedDependencies = dependencies ?? {};
	const moduleDependencies =
		providedDependencies as unknown as ModuleSetupDependencies;
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
		exec: moduleDependencies.exec,
	});
	const pr = createPrModule({
		pi,
		promptQueue,
		eventHandler,
		sessionState,
		getLifecycleEpoch: () => lifecycleEpoch.value,
		exec: moduleDependencies.exec,
	});
	const todoist = createTodoistModule({
		pi,
		promptQueue,
		eventHandler,
		sessionState,
		getLifecycleEpoch: () => lifecycleEpoch.value,
		exec: moduleDependencies.exec,
		taskClaimWorker: moduleDependencies.taskClaimWorker,
		createTodoistClient: moduleDependencies.createTodoistClient,
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
		dependencies: {
			loadConfig: providedDependencies.loadConfig,
			openSession: providedDependencies.openSession,
		},
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
	const moduleDependencies = dependencies as unknown as ModuleSetupDependencies;
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
		commandRunner: moduleDependencies.herdrCommandRunner,
		spawnWorker: moduleDependencies.herdrSpawnWorker,
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
