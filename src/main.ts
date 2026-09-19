import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerExtensionEventConsumers,
	registerModuleStateConsumer,
} from "./event-consumer.ts";
import { RootEventPublisher } from "./event-publishers.ts";
import type { ExtensionDependencies as BaseExtensionDependencies } from "./extension-dependencies.ts";
import type { FooterModule } from "./footer/module.ts";
import { createFooterModule, footerStateDescriptor } from "./footer/module.ts";
import { createHerdrTabRenameModule } from "./herdr-tab-rename/module.ts";
import { herdrTabRenameStateDescriptor } from "./herdr-tab-rename/module-state.ts";
import type { PrModule } from "./pr/module.ts";
import { createPrModule } from "./pr/module.ts";
import { prStateDescriptor } from "./pr/module-state.ts";
import {
	createPromptQueueModule,
	type PromptQueueModule,
} from "./prompt-queue/module.ts";
import { createReviewModule } from "./review/module.ts";
import { reviewStateDescriptor } from "./review/module-state.ts";
import {
	type ModuleStateDescriptors,
	serializeSessionState,
} from "./session-state-persistence.ts";
import type { Exec } from "./shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "./shared/constants.ts";
import type { EventHandler } from "./shared/events.ts";
import { createEventHandler } from "./shared/events.ts";

import { isInsideHerdr } from "./shared/herdr-client.ts";
import { isRecord } from "./shared/records.ts";
import { isSubagent } from "./shared/session.ts";
import { createSessionState } from "./state.ts";
import type { TodoistModule } from "./todoist/module.ts";
import { createTodoistModule } from "./todoist/module.ts";
import { todoistStateDescriptor } from "./todoist/module-state.ts";
import type { TodoistProjectMapping } from "./todoist/parsing.ts";
import {
	loadConfig as loadTodoistConfig,
	parseProjectEntry,
	resolveConfiguredProject,
} from "./todoist/parsing.ts";
import type { WorktreeCleanup } from "./worktree/module.ts";
import { createWorktreeModule } from "./worktree/module.ts";
import { worktreeStateDescriptor } from "./worktree/module-state.ts";

type TodoistModuleOptions = Parameters<typeof createTodoistModule>[0];
type TodoistClientFactory = TodoistModuleOptions["createTodoistClient"];
type TaskClaimWorker = TodoistModuleOptions["taskClaimWorker"];
type TaskRefreshWorker = TodoistModuleOptions["taskRefreshWorker"];
type HerdrSetupOptions = Parameters<typeof createHerdrTabRenameModule>[1];
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
	pr: PrModule | null;
	todoist: TodoistModule | null;
	worktree: WorktreeCleanup | null;
}

interface CreateExtensionStateOptions {
	lazyModules?: boolean;
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
	options?: CreateExtensionStateOptions,
): ExtensionState {
	const stateOptions = options ?? {};
	const providedDependencies = dependencies ?? {};
	const moduleDependencies: ModuleSetupDependencies = providedDependencies;
	const eventHandler = createEventHandler();
	const sessionState = createSessionState();
	const stateDescriptors: ModuleStateDescriptors = {
		pr: prStateDescriptor,
		todoist: todoistStateDescriptor,
		review: reviewStateDescriptor,
		herdrTabRename: herdrTabRenameStateDescriptor,
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
		getSessionState: () => sessionState,
	});
	const worktree = stateOptions.lazyModules
		? null
		: createWorktreeModule({
				eventHandler,
				sessionState,
				exec: moduleDependencies.exec,
			});
	const pr = stateOptions.lazyModules
		? null
		: createPrModule({
				pi,
				eventHandler,
				sessionState,
				exec: moduleDependencies.exec,
			});
	const todoist = stateOptions.lazyModules
		? null
		: createTodoistModule({
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
			exec: providedDependencies.exec,
			resolveSessionProject: providedDependencies.resolveSessionProject,
		},
		eventHandler,
		promptQueue,
		sessionState,
		footer,
		pr,
		todoist,
		worktree,
		installModules: () => undefined,
		session: null,
		publisher: new RootEventPublisher(eventHandler),
		stateUpdateEpoch,
		stateUpdatesDrained: async () => undefined,
		stateDescriptors,
		persistSessionState,
	};
	return Object.assign(extensionState, { root });
}

function todoistProjectMapping(value: unknown): TodoistProjectMapping {
	if (!isRecord(value) || !isRecord(value.projects)) return { projects: {} };
	const projects: TodoistProjectMapping["projects"] = {};
	for (const [path, project] of Object.entries(value.projects)) {
		const parsed = parseProjectEntry(path, project);
		if (parsed !== null) projects[parsed[0]] = parsed[1];
	}
	return { projects };
}

async function resolveConfiguredSessionProject(
	dependencies: ModuleSetupDependencies,
	cwd: string,
): Promise<{
	codingRoot: string;
	triggersOnlyOnWorktree?: boolean;
} | null> {
	const loaded = dependencies.loadConfig
		? await dependencies.loadConfig()
		: await loadTodoistConfig();
	const resolved = resolveConfiguredProject(cwd, todoistProjectMapping(loaded));
	if (resolved === null) return null;
	return {
		codingRoot: resolved.codingRoot,
		triggersOnlyOnWorktree: resolved.triggersOnlyOnWorktree,
	};
}

function startExtensions(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): void {
	let hasCachedConfig = false;
	let cachedConfig: unknown;
	const moduleDependencies: ModuleSetupDependencies = {
		...dependencies,
		loadConfig: async (path) => {
			if (hasCachedConfig) return cachedConfig;
			cachedConfig = dependencies.loadConfig
				? await dependencies.loadConfig(path)
				: await loadTodoistConfig(path);
			hasCachedConfig = true;
			return cachedConfig;
		},
	};
	const resolveSessionProject =
		dependencies.resolveSessionProject ??
		resolveConfiguredSessionProject.bind(null, moduleDependencies);
	const extensionState = createExtensionState(
		pi,
		{ ...dependencies, ...moduleDependencies, resolveSessionProject },
		{ lazyModules: true },
	);
	extensionState.eventHandler.sessionResetEvent.subscribe(() => {
		hasCachedConfig = false;
		cachedConfig = undefined;
	});
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
	let reviewRegistered = false;
	root.installModules = ({ isGitProject, isTodoistProject }) => {
		const worktree =
			root.worktree ??
			(isGitProject
				? createWorktreeModule({
						eventHandler: extensionState.eventHandler,
						sessionState: extensionState.sessionState,
						exec: moduleDependencies.exec,
					})
				: null);
		const pr =
			root.pr ??
			(isGitProject
				? createPrModule({
						pi,
						eventHandler: extensionState.eventHandler,
						sessionState: extensionState.sessionState,
						exec: moduleDependencies.exec,
					})
				: null);
		const todoist =
			root.todoist ??
			(isTodoistProject
				? createTodoistModule({
						pi,
						eventHandler: extensionState.eventHandler,
						sessionState: extensionState.sessionState,
						exec: moduleDependencies.exec,
						loadConfig: moduleDependencies.loadConfig,
						taskClaimWorker: moduleDependencies.taskClaimWorker,
						taskRefreshWorker: moduleDependencies.taskRefreshWorker,
						createTodoistClient: moduleDependencies.createTodoistClient,
					})
				: null);
		extensionState.pr = pr;
		extensionState.todoist = todoist;
		extensionState.worktree = worktree;
		root.pr = pr;
		root.todoist = todoist;
		root.worktree = worktree;
		extensionState.promptQueue.setModules({ pr, todoist, worktree });
		if (reviewRegistered) return;
		if (!isGitProject) return;
		if (!isInsideHerdr()) return;
		reviewRegistered = true;
		createReviewModule({
			pi,
			sessionState: extensionState.sessionState,
			herdrClient: moduleDependencies.herdrClient,
		});
	};
	if (isInsideHerdr())
		createHerdrTabRenameModule(pi, {
			eventHandler: extensionState.eventHandler,
			sessionState: extensionState.sessionState,
			herdrClient: moduleDependencies.herdrClient,
			spawnWorker: moduleDependencies.herdrSpawnWorker,
		});
}

export default function extension(
	pi: ExtensionAPI,
	dependencies?: ExtensionDependencies,
): void {
	if (isSubagent()) return;
	startExtensions(pi, dependencies ?? {});
}
