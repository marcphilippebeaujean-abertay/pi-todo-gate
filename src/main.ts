import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerExtensionEventConsumers,
	registerModuleStateConsumer,
} from "./event-consumer.ts";
import { RootEventPublisher } from "./event-publishers.ts";
import type { ExtensionDependencies as BaseExtensionDependencies } from "./extension-dependencies.ts";
import { FooterModule } from "./footer/module.ts";
import { footerStateDescriptor } from "./footer/module-state.ts";
import { HerdrTabRenameModule } from "./herdr-tab-rename/module.ts";
import { herdrTabRenameStateDescriptor } from "./herdr-tab-rename/module-state.ts";
import { PrModule } from "./pr/module.ts";
import { prStateDescriptor } from "./pr/module-state.ts";
import { PromptQueueModule } from "./prompt-queue/module.ts";
import { ReviewModule } from "./review/module.ts";
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
import type { SessionProject } from "./shared/session-state.ts";
import { createSessionState } from "./state.ts";
import { TodoistModule } from "./todoist/module.ts";
import { todoistStateDescriptor } from "./todoist/module-state.ts";
import type { TodoistProjectMapping } from "./todoist/parsing.ts";
import {
	loadConfig as loadTodoistConfig,
	parseProjectEntry,
	resolveConfiguredProject,
} from "./todoist/parsing.ts";
import { WorktreeModule } from "./worktree/module.ts";
import { worktreeStateDescriptor } from "./worktree/module-state.ts";

type TodoistModuleOptions = ConstructorParameters<typeof TodoistModule>[0];
type TodoistClientFactory = TodoistModuleOptions["createTodoistClient"];
type TaskClaimWorker = TodoistModuleOptions["taskClaimWorker"];
type TaskRefreshWorker = TodoistModuleOptions["taskRefreshWorker"];
type HerdrSetupOptions = ConstructorParameters<typeof HerdrTabRenameModule>[1];
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
	promptQueue: PromptQueueModule | null;
	eventHandler: EventHandler;
	footer: FooterModule;
	pr: PrModule | null;
	todoist: TodoistModule | null;
	worktree: WorktreeModule | null;
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
	const footer = new FooterModule({
		eventHandler,
		getSessionState: () => sessionState,
	});
	const worktree = stateOptions.lazyModules
		? null
		: new WorktreeModule({
				eventHandler,
				sessionState,
				exec: moduleDependencies.exec,
			});
	const pr = stateOptions.lazyModules
		? null
		: new PrModule({
				pi,
				eventHandler,
				sessionState,
				exec: moduleDependencies.exec,
			});
	const todoist = stateOptions.lazyModules
		? null
		: new TodoistModule({
				pi,
				eventHandler,
				sessionState,
				exec: moduleDependencies.exec,
				taskClaimWorker: moduleDependencies.taskClaimWorker,
				taskRefreshWorker: moduleDependencies.taskRefreshWorker,
				createTodoistClient: moduleDependencies.createTodoistClient,
			});
	const promptQueue = stateOptions.lazyModules
		? null
		: new PromptQueueModule({
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
			resolveConfiguredProject:
				providedDependencies.resolveConfiguredProject ??
				resolveConfiguredSessionProject.bind(null, moduleDependencies),
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
): Promise<SessionProject | null> {
	const loaded = dependencies.loadConfig
		? await dependencies.loadConfig()
		: await loadTodoistConfig();
	const resolved = resolveConfiguredProject(cwd, todoistProjectMapping(loaded));
	if (resolved === null) return null;
	return {
		codingRoot: resolved.codingRoot,
		todoistProjectRef: resolved.todoistProjectRef,
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
	const resolveConfiguredProject =
		dependencies.resolveConfiguredProject ??
		resolveConfiguredSessionProject.bind(null, moduleDependencies);
	const extensionState = createExtensionState(
		pi,
		{
			...dependencies,
			...moduleDependencies,
			resolveConfiguredProject,
		},
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
	root.installModules = (project: SessionProject) => {
		const isGitProject = project.isGitProject === true;
		const isTodoistProject = project.isTodoistProject === true;
		const worktree =
			root.worktree ??
			(isGitProject
				? new WorktreeModule({
						eventHandler: extensionState.eventHandler,
						sessionState: extensionState.sessionState,
						exec: moduleDependencies.exec,
					})
				: null);
		const pr =
			root.pr ??
			(isGitProject
				? new PrModule({
						pi,
						eventHandler: extensionState.eventHandler,
						sessionState: extensionState.sessionState,
						exec: moduleDependencies.exec,
					})
				: null);
		const todoist =
			root.todoist ??
			(isTodoistProject
				? new TodoistModule({
						pi,
						eventHandler: extensionState.eventHandler,
						sessionState: extensionState.sessionState,
						exec: moduleDependencies.exec,
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
		if (extensionState.promptQueue === null) {
			extensionState.promptQueue = new PromptQueueModule({
				pi,
				eventHandler: extensionState.eventHandler,
				sessionState: extensionState.sessionState,
				pr,
				todoist,
				worktree,
			});
			root.promptQueue = extensionState.promptQueue;
		}
		if (reviewRegistered) return;
		if (!isGitProject) return;
		if (!isInsideHerdr()) return;
		reviewRegistered = true;
		new ReviewModule({
			pi,
			sessionState: extensionState.sessionState,
			herdrClient: moduleDependencies.herdrClient,
		});
	};
	if (isInsideHerdr())
		new HerdrTabRenameModule(pi, {
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
