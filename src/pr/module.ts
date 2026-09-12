import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";
import { branchTexts } from "../shared/extension-message.ts";
import { inspectProject } from "../shared/project.ts";
import type { SessionState } from "../state.ts";
import { register as registerMergeProtocol } from "./commands.ts";
import { mergeProtocolSkillPath } from "./constants.ts";
import { handlePrToolResult, isCurrentMerge } from "./event-consumers.ts";
import { findOpenPr, isGithubPrAvailable } from "./git.ts";
import { githubPrUrls, recordMergedPr } from "./parsing.ts";
import type {
	PrModule,
	PrModuleDependencies,
	PrModuleOptions,
	PrRuntime,
	PrSession,
	PrState,
	PrWorkState,
} from "./state.ts";

export * from "./commands.ts";
export { register as registerMergeProtocol } from "./commands.ts";
export * from "./constants.ts";
export * from "./event-consumers.ts";
export * from "./event-publishers.ts";
export * from "./events.ts";
export * from "./git.ts";
export * from "./notifications.ts";
export * from "./parsing.ts";
export * from "./state.ts";
export * from "./user-prompts.ts";

function prStateFromSession(session: PrSession): PrState {
	return {
		remoteOrigin: session.state.remoteOrigin,
		prUrl: session.state.prUrl,
		discoveryDisabled: !session.allowPrDiscovery,
		discoveryTestedUrls: [...session.prDiscoveryTestedUrls],
		operationGeneration: 0,
		mergeCompletedAt: session.state.mergeCompletedAt,
		todoistCompletionAttemptedAt: session.state.todoistCompletionAttemptedAt,
	};
}

function stateFromWorkState(state: PrWorkState): PrState {
	return {
		remoteOrigin: state.remoteOrigin,
		prUrl: state.prUrl,
		mergeCompletedAt: state.mergeCompletedAt,
		todoistCompletionAttemptedAt: state.todoistCompletionAttemptedAt,
	};
}

class PrModuleImpl implements PrModule {
	private readonly promptQueue: PromptQueue;
	private readonly eventHandler: EventHandler;
	private readonly sessionState: SessionState;
	private readonly getSession: () => PrSession | null;
	private readonly dependencies: PrModuleDependencies;
	private state: PrState = {};

	constructor(options: PrModuleOptions) {
		this.promptQueue = options.promptQueue;
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
		this.getSession = options.getSession;
		this.dependencies = options.dependencies ?? {};
		this.eventHandler.toolResultEvent.subscribe(({ event, context }) =>
			this.handleToolResult(event, context),
		);
		this.eventHandler.prMergedEvent.subscribe((event) =>
			this.recordMerge(event.prUrl),
		);
	}

	register(pi: ExtensionAPI): void {
		registerMergeProtocol(pi, this.runtime());
	}

	activateSession(session: PrSession): void {
		this.state = {
			...prStateFromSession(session),
			operationGeneration: this.state.operationGeneration ?? 0,
		};
	}

	deactivateSession(): void {
		this.state = {
			operationGeneration: (this.state.operationGeneration ?? 0) + 1,
		};
	}

	async initializeRemoteOrigin(
		ctx: ExtensionContext,
		state: PrWorkState,
	): Promise<PrWorkState> {
		const hasRemoteOrigin = state.remoteOrigin !== undefined;
		if (hasRemoteOrigin) {
			this.state = { ...this.state, ...stateFromWorkState(state) };
			return state;
		}
		const project = await inspectProject(
			this.dependencies.exec ?? spawnExec,
			ctx.cwd,
		);
		const remoteOrigin = project.remoteOrigin ?? undefined;
		const previousOrigin = state.remoteOrigin;
		const nextState = { ...state, remoteOrigin };
		this.state = { ...this.state, ...stateFromWorkState(nextState) };
		const originChanged = previousOrigin !== remoteOrigin;
		if (originChanged) {
			await this.emitState({ remoteOrigin }, remoteOrigin);
			this.dependencies.appendState?.(nextState);
		}
		return nextState;
	}

	async persistPrIfAvailable(text: string): Promise<void> {
		const session = this.getSession();
		const hasSession = session !== null;
		const canDiscover = hasSession && session.allowPrDiscovery;
		const hasPinnedPr = hasSession && session.state.prUrl !== undefined;
		if (!hasSession) return;
		const shouldSkipDiscovery = !canDiscover || hasPinnedPr;
		if (shouldSkipDiscovery) return;
		const remoteOrigin = await this.ensureRemoteOrigin(session);
		if (remoteOrigin === null) return;
		const exec = this.dependencies.exec ?? spawnExec;
		for (const url of githubPrUrls(text, remoteOrigin)) {
			const persisted = await this.persistCandidate(
				session,
				url,
				remoteOrigin,
				exec,
			);
			if (persisted) return;
		}
	}

	private async ensureRemoteOrigin(session: PrSession): Promise<string | null> {
		const knownOrigin = session.state.remoteOrigin;
		if (knownOrigin !== undefined) return knownOrigin;
		const nextState = await this.initializeRemoteOrigin(
			session.context,
			session.state,
		);
		const isCurrentSession = this.getSession()?.sessionId === session.sessionId;
		if (!isCurrentSession) return null;
		const remoteOrigin = nextState.remoteOrigin;
		const hasRemoteOrigin = remoteOrigin !== undefined;
		if (hasRemoteOrigin)
			this.dependencies.replaceSessionState?.(session, nextState);
		return remoteOrigin ?? null;
	}

	private async persistCandidate(
		session: PrSession,
		url: string,
		remoteOrigin: string,
		exec: Exec,
	): Promise<boolean> {
		const alreadyTested = session.prDiscoveryTestedUrls.has(url);
		if (alreadyTested) return false;
		session.prDiscoveryTestedUrls.add(url);
		this.state.discoveryTestedUrls = [...session.prDiscoveryTestedUrls];
		const isAvailable = await isGithubPrAvailable(
			exec,
			session.context.cwd,
			url,
			remoteOrigin,
		);
		if (!isAvailable) return false;
		const isCurrentSession = this.getSession()?.sessionId === session.sessionId;
		const canDiscover = session.allowPrDiscovery;
		const hasPinnedPr = session.state.prUrl !== undefined;
		const currentAndDiscoverable = isCurrentSession && canDiscover;
		const canPersist = currentAndDiscoverable && !hasPinnedPr;
		if (!canPersist) return false;
		const nextState = { ...session.state, prUrl: url };
		session.allowPrDiscovery = false;
		this.state = {
			...this.state,
			prUrl: url,
			discoveryDisabled: true,
			discoveryTestedUrls: [...session.prDiscoveryTestedUrls],
		};
		this.dependencies.replaceSessionState?.(session, nextState);
		this.dependencies.appendState?.(nextState);
		this.dependencies.refreshFooterStatuses?.(session);
		await this.emitState(this.state);
		return true;
	}

	async persistInitialPr(branch: readonly unknown[]): Promise<void> {
		await this.persistPrIfAvailable(branchTexts(branch).join("\n"));
	}

	isDiscoveryAllowed(
		stateEntry: Record<string, unknown> | null,
		state: PrWorkState,
		handoffContext: boolean,
	): boolean {
		const disabled = stateEntry?.prDiscoveryDisabled === true;
		const notHandoff = !handoffContext;
		const discoveryEnabled = !disabled;
		const hasPinnedPr = state.prUrl !== undefined;
		const hasNoPinnedPr = !hasPinnedPr;
		const eligible = notHandoff && discoveryEnabled;
		return eligible && hasNoPinnedPr;
	}

	async appendBeforeAgentPrompt(
		ctx: ExtensionContext,
		messages: string[],
	): Promise<void> {
		const worktree = await inspectProject(
			this.dependencies.exec ?? spawnExec,
			ctx.cwd,
		);
		const hasWorktreeBranch = worktree.isWorktree && worktree.branch !== null;
		const hasRemoteOrigin = worktree.remoteOrigin !== null;
		const canInspectPr = hasWorktreeBranch && hasRemoteOrigin;
		if (!canInspectPr) return;
		const result = await findOpenPr(
			this.dependencies.exec ?? spawnExec,
			ctx.cwd,
			worktree.branch as string,
			worktree.remoteOrigin,
		);
		switch (result.state.toLowerCase()) {
			case C.value.unknown:
				messages.push(C.message.lookupUnavailable);
				return;
			case "open":
				return;
			default:
				messages.push(C.message.createPr);
				return;
		}
	}

	isCurrentMerge(
		session: PrSession,
		workRevision: number,
		operationGeneration: number,
		taskRef: string | undefined,
		prUrl: string,
	): boolean {
		return isCurrentMerge(
			this.sessionState,
			this.state,
			session,
			workRevision,
			operationGeneration,
			taskRef,
			prUrl,
		);
	}

	private isCurrentOperation(_session: PrSession, generation: number): boolean {
		return this.state.operationGeneration === generation;
	}

	private enqueueSessionOperation<T>(
		_session: PrSession,
		operation: () => Promise<T>,
	): Promise<T> {
		return this.promptQueue
			.enqueue(() => operation())
			.then((result) => result as T);
	}

	private runtime(): PrRuntime {
		return {
			sessionState: this.sessionState,
			eventHandler: this.eventHandler,
			dependencies: { exec: this.dependencies.exec },
			getSession: this.getSession,
			prState: () => this.state,
			isCurrentOperation: this.isCurrentOperation.bind(this),
			enqueueSessionOperation: this.enqueueSessionOperation.bind(this),
		};
	}

	private async recordMerge(prUrl: string | null): Promise<void> {
		if (prUrl === null) return;
		const nextState = recordMergedPr(
			{ ...this.state, prUrl },
			new Date().toISOString(),
		);
		const changed = nextState !== this.state;
		if (!changed) return;
		this.state = nextState;
		await this.emitState(this.state);
	}

	private async handleToolResult(
		event: Parameters<typeof handlePrToolResult>[3],
		ctx: ExtensionContext,
	): Promise<void> {
		await handlePrToolResult(
			this.getSession,
			this.sessionState,
			this.state,
			event,
			ctx,
			(prUrl) =>
				this.eventHandler.prMergedEvent.emit({
					prUrl,
					taskMarkedAsCompleted: false,
				}),
			this.dependencies.exec ?? spawnExec,
		);
	}

	private async emitState(
		moduleState: PrState,
		remoteOrigin?: string,
	): Promise<void> {
		await this.eventHandler.moduleStateChangedEvent.emit({
			moduleId: C.module.pr,
			moduleState: { ...moduleState },
			...(remoteOrigin === undefined
				? {}
				: { gitStatePatch: { remoteOrigin } }),
		});
	}
}

export function createPrModule(options: PrModuleOptions): PrModule {
	return new PrModuleImpl(options);
}

export { mergeProtocolSkillPath };
