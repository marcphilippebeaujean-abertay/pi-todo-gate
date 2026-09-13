import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type {
	EventHandler,
	PiToolRegistrationsBecameAvailableEvent,
	PrMergedEvent,
} from "../shared/events.ts";
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
	PrCommandOptions,
	PrModule,
	PrModuleDependencies,
	PrModuleOptions,
	PrSession,
	PrSessionIdentity,
	PrState,
	PrWorkState,
} from "./state.ts";
import { installStateTool } from "./state-tool.ts";

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
	};
}

function stateFromWorkState(state: PrWorkState): PrState {
	return {
		remoteOrigin: state.remoteOrigin,
		prUrl: state.prUrl,
	};
}

class PrModuleImpl implements PrModule {
	private readonly promptQueue: PromptQueue;
	private readonly pi: ExtensionAPI | undefined;
	private readonly eventHandler: EventHandler;
	private readonly sessionState: SessionState;
	private currentSession: PrSession | null = null;
	private readonly dependencies: PrModuleDependencies;
	private readonly getLifecycleEpoch: () => number;
	private registrationsAvailable = false;
	private state: PrState = {};
	private generation = -1;

	constructor(options: PrModuleOptions) {
		this.promptQueue = options.promptQueue;
		this.pi = options.pi;
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
		this.getLifecycleEpoch = options.getLifecycleEpoch ?? (() => 0);
		this.dependencies = options.dependencies ?? {};
		this.eventHandler.toolResultEvent.subscribe(({ event, context }) =>
			this.handleToolResult(event, context),
		);
		this.eventHandler.piToolRegistrationsBecameAvailableEvent.subscribe(
			this.registerPiTools.bind(this),
		);
		this.eventHandler.sessionActivatedEvent.subscribe(
			({ context, session, lifecycleEpoch }) => {
				const hasSession = session !== undefined;
				if (!hasSession) return;
				const isCurrentContext = session.context === context;
				if (!isCurrentContext) return;
				const activationEpoch = lifecycleEpoch ?? this.getLifecycleEpoch();
				const isCurrentEpoch = activationEpoch === this.getLifecycleEpoch();
				if (!isCurrentEpoch) return;
				this.currentSession = session;
				return this.activateSession(session, activationEpoch);
			},
		);
		this.eventHandler.sessionDeactivatedEvent.subscribe(() => {
			this.currentSession = null;
			this.deactivateSession();
		});
		this.eventHandler.prMergedEvent.subscribe((event) =>
			this.recordMerge(event),
		);
	}

	private registerPiTools({
		pi,
	}: PiToolRegistrationsBecameAvailableEvent): void {
		const alreadyRegistered = this.registrationsAvailable;
		if (alreadyRegistered) return;
		this.registrationsAvailable = true;
		registerMergeProtocol(pi, this.commandDependencies());
		installStateTool(pi, {
			getSession: () => this.currentSession,
			appendState: this.appendPersistedState.bind(this),
			replaceSessionState: this.replaceSessionState.bind(this),
			refreshFooterStatuses: () => undefined,
			syncPrState: this.syncSessionState.bind(this),
		});
	}

	async activateSession(
		session: PrSession,
		activationEpoch?: number,
	): Promise<void> {
		const epoch = activationEpoch ?? this.getLifecycleEpoch();
		this.currentSession = session;
		this.generation = Math.max(
			this.generation + 1,
			this.state.operationGeneration ?? 0,
		);
		const nextState = prStateFromSession(session, this.generation);
		this.state = nextState;
		await this.emitState(nextState, {
			operationGeneration: this.generation,
			sessionId: session.sessionId,
		});
		const isCurrentActivation =
			this.currentSession === session && epoch === this.getLifecycleEpoch();
		if (!isCurrentActivation) return;
		this.state = nextState;
	}

	deactivateSession(): void {
		this.currentSession = null;
		this.generation = Math.max(
			this.generation + 1,
			this.state.operationGeneration ?? 0,
		);
		this.state = { operationGeneration: this.generation };
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
		const operationGeneration =
			this.state.operationGeneration ?? this.generation;
		const request: OriginRequest = {
			operationGeneration,
			lifecycleEpoch: this.getLifecycleEpoch(),
			sessionId: this.sessionState.sessionId,
		};
		if (hasRemoteOrigin) {
			const nextState = {
				...this.state,
				...stateFromWorkState(state),
				operationGeneration,
			};
			const isCurrentBeforeEmission = this.isCurrentOriginRequest(request);
			if (!isCurrentBeforeEmission) return state;
			await this.emitState(nextState, {
				remoteOrigin: state.remoteOrigin,
				operationGeneration,
				sessionId: request.sessionId,
			});
			const isCurrentAfterEmission = this.isCurrentOriginRequest(request);
			if (!isCurrentAfterEmission) return state;
			this.state = nextState;
			return state;
		}
		return this.discoverRemoteOrigin(ctx, state, {
			operationGeneration: this.state.operationGeneration ?? this.generation,
			sessionId: this.sessionState.sessionId,
			lifecycleEpoch: this.getLifecycleEpoch(),
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
		const nextWorkState = { ...state, remoteOrigin };
		const nextState = {
			...this.state,
			...stateFromWorkState(nextWorkState),
			operationGeneration: request.operationGeneration,
		};
		const originChanged = previousOrigin !== remoteOrigin;
		const shouldSkipEmission = !originChanged;
		if (shouldSkipEmission) {
			const isCurrentBeforeMutation = this.isCurrentOriginRequest(request);
			if (!isCurrentBeforeMutation) return state;
			this.state = nextState;
			return nextWorkState;
		}
		await this.emitState(nextState, {
			remoteOrigin,
			operationGeneration: request.operationGeneration,
			sessionId: request.sessionId,
		});
		const staleAfterEmission = this.isStaleOriginRequest(request);
		if (staleAfterEmission) return state;
		this.state = nextState;
		this.appendPersistedState(nextWorkState);
		return nextWorkState;
	}

	async persistPrIfAvailable(text: string): Promise<void> {
		const session = this.currentSession;
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
				lifecycleEpoch: this.getLifecycleEpoch(),
				sessionId: session.sessionId,
				session,
				identity,
			},
		);
		const isCurrentAfterOrigin = this.isSameSessionIdentity(session, identity);
		if (!isCurrentAfterOrigin) return null;
		const remoteOrigin = nextState.remoteOrigin;
		const hasRemoteOrigin = remoteOrigin !== undefined;
		if (hasRemoteOrigin) this.replaceSessionState(session, nextState);
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
		this.replaceSessionState(session, nextState);
		this.appendPersistedState(nextState);

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
		const session = this.currentSession;
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

	private appendPersistedState(
		state: PrWorkState,
		prDiscoveryDisabled?: boolean,
	): void {
		const hasPi = this.pi !== undefined;
		if (!hasPi) return;
		const shouldDisableDiscovery = prDiscoveryDisabled ?? false;
		const data = shouldDisableDiscovery
			? { ...state, prDiscoveryDisabled: true }
			: state;
		this.pi.appendEntry(C.entry.state, data);
	}

	private replaceSessionState(
		session: PrSession,
		nextState: PrWorkState,
	): void {
		const hasTaskChanged = session.state.taskRef !== nextState.taskRef;
		const hasPrChanged = session.state.prUrl !== nextState.prUrl;
		const hasWorkChanged = hasTaskChanged || hasPrChanged;
		if (hasWorkChanged) session.workRevision += 1;
		session.state = nextState;
	}

	private commandDependencies(): PrCommandOptions {
		return {
			sessionState: this.sessionState,
			eventHandler: this.eventHandler,
			exec: this.dependencies.exec,
			getSession: () => this.currentSession,
			getLifecycleEpoch: this.getLifecycleEpoch,
			getPrState: () => this.state,
			isCurrentOperation: this.isCurrentOperation.bind(this),
			enqueueSessionOperation: this.enqueueSessionOperation.bind(this),
		};
	}

	private async recordMerge(event: PrMergedEvent): Promise<void> {
		const session = this.currentSession;
		if (session === null) return;
		const isSameSession = session.sessionId === event.sessionId;
		const isSameEpoch = this.getLifecycleEpoch() === event.lifecycleEpoch;
		const isCurrentIdentity = isSameSession && isSameEpoch;
		if (!isCurrentIdentity) return;
		if (event.prUrl === null) return;
		const recordedState = recordMergedPr(
			{ ...this.state, prUrl: event.prUrl },
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
		const isCurrentAfterEmit =
			this.currentSession === session &&
			this.getLifecycleEpoch() === event.lifecycleEpoch;
		if (!isCurrentAfterEmit) return;
	}

	private async handleToolResult(
		event: Parameters<typeof handlePrToolResult>[3],
		ctx: ExtensionContext,
	): Promise<void> {
		await handlePrToolResult(
			() => this.currentSession,
			this.sessionState,
			this.state,
			event,
			ctx,
			(prUrl) => {
				const session = this.currentSession;
				if (session === null) return Promise.resolve();
				return this.eventHandler.prMergedEvent.emit({
					prUrl,
					taskMarkedAsCompleted: false,
					sessionId: session.sessionId,
					lifecycleEpoch: this.getLifecycleEpoch(),
				});
			},
			this.dependencies.exec ?? spawnExec,
		);
	}

	private isCurrentOriginRequest(request: OriginRequest): boolean {
		const isCurrentLifecycle =
			this.getLifecycleEpoch() === request.lifecycleEpoch;
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
		const currentLifecycleAndGeneration =
			isCurrentLifecycle && isCurrentGeneration;
		const currentRequest =
			currentLifecycleAndGeneration && isCurrentRootSession;
		return currentRequest && isCurrentSession;
	}

	private isStaleOriginRequest(request: OriginRequest): boolean {
		return !this.isCurrentOriginRequest(request);
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
		const activeSession = this.currentSession;
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
			(stateGeneration ?? this.generation) === operationGeneration;
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
