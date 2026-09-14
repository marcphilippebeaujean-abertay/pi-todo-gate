import "./commands.ts";
import "./client.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./events.ts";
import "./parsing.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./user-prompts.ts";
import "./notifications.ts";

export { TodoistClient } from "./client.ts";
export * from "./module-state.ts";
export {
	TodoistError,
	TodoistOperationCancelled,
} from "./parsing.ts";

import { createModuleStatePublisher } from "../event-publishers.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { isRecord } from "../shared/records.ts";
import { completeMergedTask } from "./completion.ts";
import {
	maybeAnalyzeTaskClaim as analyzeTaskClaim,
	registerTodoistLifecycleConsumers,
	registerTodoistMergeConsumer,
} from "./event-consumers.ts";
import type {
	ResolvedProject,
	TodoistModuleOptions,
	TodoistOperations,
	TodoistProjectMapping,
	TodoistSession,
	TodoistState,
	TodoistStateUpdateOptions,
} from "./internal-state.ts";
import {
	loadConfig as loadTodoistConfig,
	parseProjectEntry,
	resolveConfiguredProject,
} from "./parsing.ts";

export interface SessionProject {
	codingRoot: string;
	triggersOnlyOnWorktree?: boolean;
}

export interface TodoistModule {
	resolveSessionProject(cwd: string): Promise<SessionProject | null>;
}

function recordValue(value: unknown): Record<string, unknown> | null {
	const isValueRecord = isRecord(value);
	if (!isValueRecord) return null;
	return value;
}

class TodoistModuleImpl implements TodoistModule {
	private readonly publishState;
	private currentSession: TodoistSession | null = null;
	private currentProjectRef = "";
	private readonly pendingProjects = new Map<string, ResolvedProject | null>();
	readonly taskClaim = {
		pending: false,
		completed: false,
		session: undefined as TodoistSession | undefined,
	};
	private registered = false;

	constructor(private readonly options: TodoistModuleOptions) {
		this.publishState = createModuleStatePublisher(
			this.options.eventHandler,
			C.module.todoist,
		);
		registerTodoistLifecycleConsumers({
			eventHandler: this.options.eventHandler,
			sessionState: this.options.sessionState,
			getSession: () => this.currentSession,
			activateSession: this.activateSession.bind(this),
			resetSession: this.resetSession.bind(this),
			maybeAnalyzeTaskClaim: this.maybeAnalyzeTaskClaim.bind(this),
		});
		this.register();
	}

	private resetSession(): void {
		this.currentSession = null;
		this.currentProjectRef = "";
		this.pendingProjects.clear();
		this.resetTaskClaim();
	}

	private async loadProjectMapping(): Promise<TodoistProjectMapping> {
		const hasConfigLoader = this.options.loadConfig !== undefined;
		const loaded = hasConfigLoader
			? await this.options.loadConfig?.()
			: await loadTodoistConfig();
		const loadedRecord = recordValue(loaded);
		const hasLoadedRecord = loadedRecord !== null;
		if (!hasLoadedRecord) return { projects: {} };
		const projectRecord = recordValue(loadedRecord.projects);
		const hasProjectRecord = projectRecord !== null;
		if (!hasProjectRecord) return { projects: {} };
		const projects: TodoistProjectMapping["projects"] = {};
		for (const [path, project] of Object.entries(projectRecord)) {
			const parsed = parseProjectEntry(path, project);
			const hasParsedProject = parsed !== null;
			if (!hasParsedProject) continue;
			projects[parsed[0]] = parsed[1];
		}
		return { projects };
	}

	private async resolveConfiguredProject(
		cwd: string,
	): Promise<ResolvedProject | null> {
		const config = await this.loadProjectMapping();
		return resolveConfiguredProject(cwd, config);
	}

	async resolveSessionProject(cwd: string): Promise<SessionProject | null> {
		const resolved = await this.resolveConfiguredProject(cwd);
		this.pendingProjects.set(cwd, resolved);
		if (resolved === null) return null;
		return {
			codingRoot: resolved.codingRoot,
			triggersOnlyOnWorktree: resolved.triggersOnlyOnWorktree,
		};
	}

	private async activateSession(
		session: import("../shared/session-state.ts").SessionRecord,
		sessionId: string,
	): Promise<void> {
		const hasPendingProject = this.pendingProjects.has(session.context.cwd);
		const resolved = hasPendingProject
			? (this.pendingProjects.get(session.context.cwd) ?? null)
			: await this.resolveConfiguredProject(session.context.cwd);
		this.pendingProjects.delete(session.context.cwd);
		const activeSessionId = this.options.sessionState.session.activeSessionId;
		const hasCurrentSessionId = activeSessionId === sessionId;
		const isCurrentSession = hasCurrentSessionId;
		const hasResolvedProject = resolved !== null;
		const canActivate = hasResolvedProject && isCurrentSession;
		if (!canActivate) return;
		this.resetTaskClaim();
		this.currentSession = session;
		this.currentProjectRef = resolved.todoistProjectRef;
		await this.syncSessionState(session);
	}

	private async syncSessionState(session: TodoistSession): Promise<void> {
		const activeSessionId = this.options.sessionState.session.activeSessionId;
		const hasCurrentSessionId = activeSessionId === session.sessionId;
		const currentSession = this.currentSession;
		const hasCurrentSession =
			currentSession === null || currentSession === session;
		const isCurrentSession = hasCurrentSession && hasCurrentSessionId;
		if (!isCurrentSession) return;
		await this.publishState.publish(
			this.options.sessionState.moduleState.todoist,
			{ persist: false },
		);
	}

	private resetTaskClaim(): void {
		this.taskClaim.pending = false;
		this.taskClaim.completed = false;
		this.taskClaim.session = undefined;
	}

	private updateState(
		state: TodoistState,
		options: TodoistStateUpdateOptions,
	): Promise<void> {
		const previousTaskRef =
			this.options.sessionState.moduleState.todoist.taskRef;
		const taskIdentityChanged = previousTaskRef !== state.taskRef;
		const hasCurrentSession = this.currentSession !== null;
		const shouldIncrementRevision = taskIdentityChanged && hasCurrentSession;
		if (shouldIncrementRevision) {
			const currentSession = this.currentSession;
			if (currentSession !== null) currentSession.workRevision += 1;
		}
		return this.publishState.publish(state, options);
	}

	private updateTodoistState(
		state: TodoistState,
		options: TodoistStateUpdateOptions,
	): Promise<void> {
		return this.updateState(state, options);
	}

	private operations(): TodoistOperations {
		const legacyDependencies = this.options.dependencies ?? {};
		const exec = this.options.exec ?? legacyDependencies.exec;
		const taskClaimWorker =
			this.options.taskClaimWorker ?? legacyDependencies.taskClaimWorker;
		const createTodoistClient =
			this.options.createTodoistClient ??
			legacyDependencies.createTodoistClient;
		const sessionState = this.options.sessionState;
		const operations: TodoistOperations = {
			sessionState,
			getSession: () => this.currentSession,
			projectRef: this.currentProjectRef,
			todoist: this,
			promptQueue: this.options.promptQueue,
			exec,
			taskClaimWorker,
			createTodoistClient,
			eventHandler: this.options.eventHandler,
			emitState: this.syncSessionState.bind(this),
			updateTodoistState: this.updateTodoistState.bind(this),
			dependencies: {
				exec,
				taskClaimWorker,
				createTodoistClient,
			},
			completeMergedTask: undefined,
		};
		if (operations.completeMergedTask === undefined)
			operations.completeMergedTask = (
				session,
				taskRef,
				snapshot,
				revision,
				sessionId,
			) =>
				completeMergedTask(
					operations,
					session,
					session.context,
					taskRef,
					snapshot,
					revision,
					sessionId,
				);
		return operations;
	}

	private register(): void {
		const alreadyRegistered = this.registered;
		if (alreadyRegistered) return;
		const operations = this.operations();
		const hasOperations = operations !== null;
		const shouldSkipRegistration = !hasOperations;
		if (shouldSkipRegistration) return;
		this.registered = true;
		registerTodoistMergeConsumer(operations);
	}

	private maybeAnalyzeTaskClaim(prompt: string): void {
		const session = this.currentSession;
		if (session === null) return;
		const operations = this.operations();
		const hasOperations = operations !== null;
		if (!hasOperations) return;
		analyzeTaskClaim(operations, session, prompt);
	}
}

export function createTodoistModule(
	options: TodoistModuleOptions,
): TodoistModule {
	return new TodoistModuleImpl(options);
}
