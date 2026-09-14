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
import type { ExitProtocolModule } from "./exit-protocol/module.ts";
import {
	createExitProtocolModule,
	exitProtocolStateDescriptor,
} from "./exit-protocol/module.ts";
import type { ExtensionDependencies as BaseExtensionDependencies } from "./extension-dependencies.ts";
import type { FooterModule } from "./footer/module.ts";
import { createFooterModule, footerStateDescriptor } from "./footer/module.ts";
import { HERDR_CLAIM_RETURNED } from "./herdr/constants.ts";
import { installHerdrTabClaim } from "./herdr/module.ts";
import { herdrStateDescriptor } from "./herdr/module-state.ts";
import type { PrModule } from "./pr/module.ts";
import { createPrModule } from "./pr/module.ts";
import { prStateDescriptor } from "./pr/module-state.ts";
import { PromptQueue } from "./prompt-queue.ts";
import {
	type ModuleStateDescriptors,
	serializeSessionState,
} from "./session-state-persistence.ts";
import type { Exec } from "./shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "./shared/constants.ts";
import type { EventHandler } from "./shared/events.ts";
import { createEventHandler } from "./shared/events.ts";
import type { PiWorkerSpawner } from "./shared/pi-worker-data.ts";
import { isSubagent } from "./shared/session.ts";
import { createSessionState } from "./state.ts";
import type { TodoistModule } from "./todoist/module.ts";
import { createTodoistModule } from "./todoist/module.ts";
import { todoistStateDescriptor } from "./todoist/module-state.ts";
import { createWorktreeModule } from "./worktree/module.ts";
import { worktreeStateDescriptor } from "./worktree/module-state.ts";

export interface ExtensionDependencies extends BaseExtensionDependencies {
	createTodoistClient?: (ctx: ExtensionContext, exec: Exec) => unknown;
	taskClaimWorker?: unknown;
	herdrCommandRunner?: (command: string, args: string[]) => string;
	herdrSpawnWorker?: PiWorkerSpawner;
}

interface ExtensionState {
	pi: ExtensionAPI;
	sessionState: import("./state.ts").SessionState;
	promptQueue: PromptQueue;
	eventHandler: EventHandler;
	footer: FooterModule;
	pr: PrModule;
	todoist: TodoistModule;
	worktree: import("./worktree/module.ts").WorktreeCleanup;
	exitProtocol: ExitProtocolModule;
}

interface ModuleSetupDependencies {
	exec?: Exec;
	createTodoistClient?: (ctx: ExtensionContext, exec: Exec) => unknown;
	taskClaimWorker?: unknown;
	herdrCommandRunner?: (command: string, args: string[]) => string;
	herdrSpawnWorker?: PiWorkerSpawner;
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
	} as Parameters<typeof createTodoistModule>[0]);
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
