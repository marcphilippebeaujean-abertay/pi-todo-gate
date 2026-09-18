import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerExtensionEventConsumers,
	registerModuleStateConsumer,
} from "./event-consumer.ts";
import { RootEventPublisher } from "./event-publishers.ts";
import type { ExtensionDependencies as BaseExtensionDependencies } from "./extension-dependencies.ts";
import type { FooterModule } from "./footer/module.ts";
import { createFooterModule, footerStateDescriptor } from "./footer/module.ts";
import { createHerdrModule } from "./herdr/module.ts";
import { herdrStateDescriptor } from "./herdr/module-state.ts";
import { isInsideHerdr } from "./herdr/runtime.ts";
import type { PrModule } from "./pr/module.ts";
import { createPrModule } from "./pr/module.ts";
import { prStateDescriptor } from "./pr/module-state.ts";
import {
	createPromptQueueModule,
	type PromptQueueModule,
} from "./prompt-queue/module.ts";
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
import type { TodoistModule } from "./todoist/module.ts";
import { createTodoistModule } from "./todoist/module.ts";
import { todoistStateDescriptor } from "./todoist/module-state.ts";
import { createWorktreeModule } from "./worktree/module.ts";
import { worktreeStateDescriptor } from "./worktree/module-state.ts";

type TodoistModuleOptions = Parameters<typeof createTodoistModule>[0];
type TodoistClientFactory = TodoistModuleOptions["createTodoistClient"];
type TaskClaimWorker = TodoistModuleOptions["taskClaimWorker"];
type TaskRefreshWorker = TodoistModuleOptions["taskRefreshWorker"];
type HerdrSetupOptions = Parameters<typeof createHerdrModule>[1];
type HerdrClient = NonNullable<HerdrSetupOptions["herdrClient"]>;
type HerdrWorkerSpawner = NonNullable<HerdrSetupOptions["spawnWorker"]>;

export interface ExtensionDependencies extends BaseExtensionDependencies {
	createTodoistClient?: TodoistClientFactory;
	taskClaimWorker?: TaskClaimWorker;
	taskRefreshWorker?: TaskRefreshWorker;
	herdrClient?: HerdrClient;
	herdrSpawnWorker?: HerdrWorkerSpawner;
}

interface ExtensionState {
	pi: ExtensionAPI;
	sessionState: import("./state.ts").SessionState;
	promptQueue: PromptQueueModule;
	eventHandler: EventHandler;
	footer: FooterModule;
	pr: PrModule;
	todoist: TodoistModule;
	worktree: import("./worktree/module.ts").WorktreeCleanup;
}

interface ModuleSetupDependencies {
	loadConfig?: (path?: string) => Promise<unknown>;
	exec?: Exec;
	createTodoistClient?: TodoistClientFactory;
	taskClaimWorker?: TaskClaimWorker;
	taskRefreshWorker?: TaskRefreshWorker;
	herdrClient?: HerdrClient;
	herdrSpawnWorker?: HerdrWorkerSpawner;
}

export function createExtensionState(
	pi: ExtensionAPI,
	dependencies?: ExtensionDependencies,
): ExtensionState {
	const providedDependencies = dependencies ?? {};
	const moduleDependencies: ModuleSetupDependencies = providedDependencies;
	const eventHandler = createEventHandler();
	const sessionState = createSessionState();
	const stateDescriptors: ModuleStateDescriptors = {
		pr: prStateDescriptor,
		todoist: todoistStateDescriptor,
		herdr: herdrStateDescriptor,
		worktree: worktreeStateDescriptor,
		footer: footerStateDescriptor,
	};
	const persistSessionState = (state: typeof sessionState): void => {
		pi.appendEntry(
			C.entry.state,
			serializeSessionState(state, stateDescriptors),
		);
	};
	const stateUpdateEpoch = { value: 0 };
	const footer = createFooterModule({
		eventHandler,
		sessionState,
	});
	const worktree = createWorktreeModule({
		eventHandler,
		sessionState,
		exec: moduleDependencies.exec,
		changeDirectoryToRoot: isInsideHerdr() ? process.chdir : undefined,
	});
	const pr = createPrModule({
		pi,
		eventHandler,
		sessionState,
		exec: moduleDependencies.exec,
	});
	const todoist = createTodoistModule({
		pi,
		eventHandler,
		sessionState,
		exec: moduleDependencies.exec,
		loadConfig: moduleDependencies.loadConfig,
		taskClaimWorker: moduleDependencies.taskClaimWorker,
		taskRefreshWorker: moduleDependencies.taskRefreshWorker,
		createTodoistClient: moduleDependencies.createTodoistClient,
	});
	const promptQueue = createPromptQueueModule({
		pi,
		eventHandler,
		sessionState,
		pr,
		todoist,
		worktree,
		footer,
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
	} as ExtensionState;
	const root = {
		pi,
		dependencies: {
			openSession: providedDependencies.openSession,
		},
		eventHandler,
		promptQueue,
		sessionState,
		footer,
		pr,
		todoist,
		worktree,
		session: null,
		publisher: new RootEventPublisher(eventHandler),
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
	const moduleDependencies: ModuleSetupDependencies = dependencies;
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
		root.persistSessionState,
	);
	registerExtensionEventConsumers(root);
	createHerdrModule(pi, {
		eventHandler: extensionState.eventHandler,
		sessionState: extensionState.sessionState,
		herdrClient: moduleDependencies.herdrClient,
		spawnWorker: moduleDependencies.herdrSpawnWorker,
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
