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
	OriginRequest,
	PrModule,
	PrModuleDependencies,
	PrModuleOptions,
	PrRuntime,
	PrSession,
	PrSessionIdentity,
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

function prStateFromSession(
	session: PrSession,
	operationGeneration: number,
): PrState {
	return {
		remoteOrigin: session.state.remoteOrigin,
		prUrl: session.state.prUrl,
		discoveryDisabled: !session.allowPrDiscovery,
		discoveryTestedUrls: [...session.prDiscoveryTestedUrls],
		operationGeneration,
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
	private generation = -1;

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

	async activateSession(session: PrSession): Promise<void> {
		this.generation = Math.max(
			this.generation + 1,
			this.state.operationGeneration ?? 0,
		);
		this.state = prStateFromSession(session, this.generation);
		await this.emitState(this.state, {
			operationGeneration: this.generation,
			sessionId: session.sessionId,
		});
	}

	deactivateSession(): void {
		this.generation = Math.max(
			this.generation + 1,
			this.state.operationGeneration ?? 0,
		);
		this.state = {
			...this.state,
			operationGeneration: this.generation,
		};
	}

	async syncSessionState(session: PrSession): Promise<void> {
		const operationGeneration =
			this.state.operationGeneration ?? this.generation;
		const isCurrent = this.isCurrentSession(session, operationGeneration);
		if (!isCurrent) return;
		this.state = {
			...this.state,
			...prStateFromSession(session, operationGeneration),
		};
		await this.emitState(this.state, {
			operationGeneration,
			sessionId: session.sessionId,
		});
	}

	async initializeRemoteOrigin(
		ctx: ExtensionContext,
		state: PrWorkState,
	): Promise<PrWorkState> {
		const hasRemoteOrigin = state.remoteOrigin !== undefined;
		if (hasRemoteOrigin) {
			this.state = {
				...this.state,
				...stateFromWorkState(state),
				operationGeneration: this.state.operationGeneration ?? this.generation,
			};
			return state;
		}
		return this.discoverRemoteOrigin(ctx, state, {
			operationGeneration: this.state.operationGeneration ?? this.generation,
			sessionId: this.sessionState.sessionId,
		});
	}

	private async discoverRemoteOrigin(
		ctx: ExtensionContext,
		state: PrWorkState,
		request: OriginRequest,
	): Promise<PrWorkState> {
		const project = await inspectProject(
			this.dependencies.exec ?? spawnExec,
			ctx.cwd,
		);
		const shouldRejectRequest = !this.isCurrentOriginRequest(request);
		if (shouldRejectRequest) return state;
		const remoteOrigin = project.remoteOrigin ?? undefined;
		const previousOrigin = state.remoteOrigin;
		const nextState = { ...state, remoteOrigin };
		this.state = {
			...this.state,
			...stateFromWorkState(nextState),
			operationGeneration: request.operationGeneration,
		};
		const originChanged = previousOrigin !== remoteOrigin;
		const shouldSkipEmission = !originChanged;
		if (shouldSkipEmission) return nextState;
		await this.emitState(this.state, {
			remoteOrigin,
			operationGeneration: request.operationGeneration,
			sessionId: request.sessionId,
		});
		const staleAfterEmission = this.isStaleOriginRequest(request);
		if (staleAfterEmission) return state;
		this.dependencies.appendState?.(nextState);
		return nextState;
	}

	async persistPrIfAvailable(text: string): Promise<void> {
		const session = this.getSession();
		const hasSession = session !== null;
		if (!hasSession) return;
		const canDiscover = session.allowPrDiscovery;
		const hasPinnedPr = session.state.prUrl !== undefined;
		const shouldSkipDiscovery = !canDiscover || hasPinnedPr;
		if (shouldSkipDiscovery) return;
		const operationGeneration =
			this.state.operationGeneration ?? this.generation;
		const remoteOrigin = await this.ensureRemoteOrigin(
			session,
			operationGeneration,
		);
		if (remoteOrigin === null) return;
		const exec = this.dependencies.exec ?? spawnExec;
		for (const url of githubPrUrls(text, remoteOrigin)) {
			const persisted = await this.persistCandidate(
				session,
				url,
				remoteOrigin,
				exec,
				operationGeneration,
			);
			if (persisted) return;
		}
	}

	private async ensureRemoteOrigin(
		session: PrSession,
		operationGeneration: number,
	): Promise<string | null> {
		const knownOrigin = session.state.remoteOrigin;
		if (knownOrigin !== undefined) return knownOrigin;
		const identity = this.captureSessionIdentity(session, operationGeneration);
		const isCurrentBeforeOrigin = this.isSameSessionIdentity(session, identity);
		if (!isCurrentBeforeOrigin) return null;
		const nextState = await this.discoverRemoteOrigin(
			session.context,
			session.state,
			{
				operationGeneration,
				sessionId: session.sessionId,
				session,
				identity,
			},
		);
		const isCurrentAfterOrigin = this.isSameSessionIdentity(session, identity);
		if (!isCurrentAfterOrigin) return null;
		const remoteOrigin = nextState.remoteOrigin;
		const hasRemoteOrigin = remoteOrigin !== undefined;
		if (hasRemoteOrigin)
			this.dependencies.replaceSessionState?.(session, nextState);
		return remoteOrigin ?? null;
	}

	private async recordTestedUrl(
		session: PrSession,
		url: string,
		identity: PrSessionIdentity,
	): Promise<void> {
		const isCurrent = this.isSameSessionIdentity(session, identity);
		if (!isCurrent) return;
		session.prDiscoveryTestedUrls.add(url);
		this.state.discoveryTestedUrls = [...session.prDiscoveryTestedUrls];
		await this.emitState(this.state, {
			operationGeneration: identity.operationGeneration,
			sessionId: session.sessionId,
		});
	}

	private async persistCandidate(
		session: PrSession,
		url: string,
		remoteOrigin: string,
		exec: Exec,
		operationGeneration: number,
	): Promise<boolean> {
		const alreadyTested = session.prDiscoveryTestedUrls.has(url);
		if (alreadyTested) return false;
		const identity = this.captureSessionIdentity(session, operationGeneration);
		const isAvailable = await isGithubPrAvailable(
			exec,
			session.context.cwd,
			url,
			remoteOrigin,
		);
		if (!isAvailable) {
			await this.recordTestedUrl(session, url, identity);
			return false;
		}
		const isCurrentSession = this.isSameSessionIdentity(session, identity);
		const canDiscover = session.allowPrDiscovery;
		const hasPinnedPr = session.state.prUrl !== undefined;
		const currentAndDiscoverable = isCurrentSession && canDiscover;
		const canPersist = currentAndDiscoverable && !hasPinnedPr;
		if (!canPersist) return false;
		session.prDiscoveryTestedUrls.add(url);
		this.state.discoveryTestedUrls = [...session.prDiscoveryTestedUrls];
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
		const session = this.getSession();
		const operationGeneration =
			this.state.operationGeneration ?? this.generation;
		const discoveredOrigin =
			session === null
				? null
				: await this.ensureRemoteOrigin(session, operationGeneration);
		const originDiscoveryFailed = session !== null && discoveredOrigin === null;
		if (originDiscoveryFailed) return;
		const worktree = await inspectProject(
			this.dependencies.exec ?? spawnExec,
			ctx.cwd,
		);
		const branch = worktree.branch;
		const remoteOrigin = discoveredOrigin ?? worktree.remoteOrigin;
		const hasWorktreeBranch = worktree.isWorktree && branch !== null;
		const hasRemoteOrigin = remoteOrigin !== null;
		const canInspectPr = hasWorktreeBranch && hasRemoteOrigin;
		if (!canInspectPr) return;
		const result = await findOpenPr(
			this.dependencies.exec ?? spawnExec,
			ctx.cwd,
			branch,
			remoteOrigin,
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
		const recordedState = recordMergedPr(
			{ ...this.state, prUrl },
			new Date().toISOString(),
		);
		const nextState = {
			...recordedState,
			operationGeneration: this.state.operationGeneration,
		};
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

	private isCurrentOriginRequest(request: OriginRequest): boolean {
		const isCurrentGeneration = this.generation === request.operationGeneration;
		const isCurrentRootSession =
			this.sessionState.sessionId === request.sessionId;
		const guardedSession = request.session;
		const guardedIdentity = request.identity;
		const hasNoSessionGuard = guardedSession === undefined;
		const hasSessionIdentity =
			guardedSession !== undefined && guardedIdentity !== undefined;
		const isCurrentSession = hasNoSessionGuard
			? true
			: hasSessionIdentity &&
				this.isSameSessionIdentity(
					guardedSession as PrSession,
					guardedIdentity as PrSessionIdentity,
				);
		const currentGenerationAndRoot =
			isCurrentGeneration && isCurrentRootSession;
		return currentGenerationAndRoot && isCurrentSession;
	}

	private isStaleOriginRequest(request: OriginRequest): boolean {
		const guardedSession = request.session;
		const guardedIdentity = request.identity;
		const hasSessionIdentity =
			guardedSession !== undefined && guardedIdentity !== undefined;
		const hasStaleIdentity =
			hasSessionIdentity &&
			!this.isSameSessionIdentity(
				guardedSession as PrSession,
				guardedIdentity as PrSessionIdentity,
			);
		return hasStaleIdentity;
	}

	private captureSessionIdentity(
		session: PrSession,
		operationGeneration: number,
	): PrSessionIdentity {
		return {
			state: session.state,
			workRevision: session.workRevision,
			prUrl: session.state.prUrl,
			allowPrDiscovery: session.allowPrDiscovery,
			operationGeneration,
		};
	}

	private isSameSessionIdentity(
		session: PrSession,
		identity: PrSessionIdentity,
	): boolean {
		const activeSession = this.getSession();
		const sameSession = activeSession?.sessionId === session.sessionId;
		const sameRootSession = this.sessionState.sessionId === session.sessionId;
		const sameGeneration =
			this.state.operationGeneration === identity.operationGeneration;
		const sameStateReference = session.state === identity.state;
		const sameWorkRevision = session.workRevision === identity.workRevision;
		const samePrUrl = session.state.prUrl === identity.prUrl;
		const sameDiscoveryEligibility =
			session.allowPrDiscovery === identity.allowPrDiscovery;
		const sameSessionAndRoot = sameSession && sameRootSession;
		const sameWorkIdentity = sameStateReference && sameWorkRevision;
		const samePrIdentity = samePrUrl && sameDiscoveryEligibility;
		const currentSessionAndGeneration = sameSessionAndRoot && sameGeneration;
		const currentWorkAndPr = sameWorkIdentity && samePrIdentity;
		return currentSessionAndGeneration && currentWorkAndPr;
	}

	private isCurrentSession(
		session: PrSession,
		operationGeneration: number,
	): boolean {
		const identity = this.captureSessionIdentity(session, operationGeneration);
		return this.isSameSessionIdentity(session, identity);
	}

	private async emitState(
		moduleState: PrState,
		options?: {
			remoteOrigin?: string;
			operationGeneration?: number;
			sessionId?: string | null;
		},
	): Promise<void> {
		const optionGeneration = options?.operationGeneration;
		const stateGeneration = this.state.operationGeneration;
		const operationGeneration =
			optionGeneration ?? stateGeneration ?? this.generation;
		const sessionId = options?.sessionId ?? this.sessionState.sessionId;
		const sameGeneration =
			this.state.operationGeneration === operationGeneration;
		const sameSession = this.sessionState.sessionId === sessionId;
		const currentEmission = sameGeneration && sameSession;
		if (!currentEmission) return;
		await this.eventHandler.moduleStateChangedEvent.emit({
			moduleId: C.module.pr,
			moduleState: { ...moduleState },
			...(options?.remoteOrigin === undefined
				? {}
				: { gitStatePatch: { remoteOrigin: options.remoteOrigin } }),
		});
	}
}

export function createPrModule(options: PrModuleOptions): PrModule {
	return new PrModuleImpl(options);
}

export { mergeProtocolSkillPath };
