import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createModuleStatePublisher } from "../event-publishers.ts";
import type { PromptQueue } from "../prompt-queue.ts";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type {
	BeforeAgentStartEventPayload,
	EventHandler,
	InitialPrDiscoveryEvent,
	MessageEndEventPayload,
	PiToolRegistrationsBecameAvailableEvent,
	PrMergedEvent,
} from "../shared/events.ts";
import { branchTexts, textOf } from "../shared/extension-message.ts";
import { inspectProject } from "../shared/project.ts";
import type { SessionState } from "../state.ts";
import { register as registerMergeProtocol } from "./commands.ts";
import { mergeProtocolSkillPath } from "./constants.ts";
import { handlePrToolResult } from "./event-consumers.ts";
import "./events.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import "./user-prompts.ts";
import { findOpenPr, isGithubPrAvailable } from "./git.ts";
import type {
	OriginRequest,
	PrCommandOptions,
	PrModuleDependencies,
	PrModuleOptions,
	PrSession,
	PrSessionIdentity,
	PrState,
} from "./internal-state.ts";
import { normalizePrState } from "./module-state.ts";
import { githubPrUrls, recordMergedPr } from "./parsing.ts";
import { installStateTool } from "./state-tool.ts";

export { register as registerMergeProtocol } from "./commands.ts";
export * from "./module-state.ts";
export type PrModule = Record<never, never>;

function prStateFromSession(
	state: PrState,
	discoveryDisabled: boolean,
	discoveryTestedUrls: readonly string[],
): PrState {
	return normalizePrState({
		...state,
		discoveryDisabled,
		discoveryTestedUrls: [...discoveryTestedUrls],
	});
}

class PrModuleImpl {
	private readonly promptQueue: PromptQueue;
	private readonly pi: ExtensionAPI | undefined;
	private readonly eventHandler: EventHandler;
	private readonly sessionState: SessionState;
	private currentSession: PrSession | null = null;
	private readonly dependencies: PrModuleDependencies;
	private readonly getLifecycleEpoch: () => number;
	private registrationsAvailable = false;
	private state: PrState;
	private generation = -1;
	private readonly publishState;

	constructor(options: PrModuleOptions) {
		this.promptQueue = options.promptQueue;
		this.pi = options.pi;
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
		this.getLifecycleEpoch = options.getLifecycleEpoch ?? (() => 0);
		this.dependencies = options.dependencies ?? {
			exec: options.exec,
		};
		this.state = structuredClone(this.sessionState.moduleState.pr);
		this.publishState = createModuleStatePublisher(
			this.eventHandler,
			C.module.pr,
		);
		this.subscribeEvents();
	}

	private subscribeEvents(): void {
		this.eventHandler.toolResultEvent.subscribe(({ event, context }) =>
			this.handleToolResult(event, context),
		);
		this.eventHandler.piToolRegistrationsBecameAvailableEvent.subscribe(
			this.registerPiTools.bind(this),
		);
		this.eventHandler.sessionActivatedEvent.subscribe(
			async ({ context, session, lifecycleEpoch }) => {
				const hasSession = session !== undefined;
				if (!hasSession) return;
				const isCurrentContext = session.context === context;
				if (!isCurrentContext) return;
				const activationEpoch = lifecycleEpoch ?? this.getLifecycleEpoch();
				const isCurrentEpoch = activationEpoch === this.getLifecycleEpoch();
				if (!isCurrentEpoch) return;
				this.currentSession = session;
				await this.activateSession(session, activationEpoch);
				const isStaleActivation = this.getLifecycleEpoch() !== activationEpoch;
				if (isStaleActivation) return;
				await this.initializeRemoteOrigin(
					context,
					this.sessionState.gitState.remoteOrigin,
				);
			},
		);
		this.eventHandler.sessionDeactivatedEvent.subscribe(() => {
			this.currentSession = null;
			this.deactivateSession();
		});
		this.eventHandler.initialPrDiscoveryEvent.subscribe((event) =>
			this.handleInitialPrDiscovery(event),
		);
		this.eventHandler.messageEndEvent.subscribe((event) =>
			this.handleMessageEnd(event),
		);
		this.eventHandler.beforeAgentStartEvent.subscribe((event) =>
			this.handleBeforeAgentStart(event),
		);
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
			getPrState: () => this.state,
			getRemoteOrigin: () => this.sessionState.gitState.remoteOrigin,
			updatePrState: this.updatePrState.bind(this),
			syncPrState: this.syncSessionState.bind(this),
		});
	}

	private async activateSession(
		session: PrSession,
		activationEpoch?: number,
	): Promise<void> {
		const epoch = activationEpoch ?? this.getLifecycleEpoch();
		this.currentSession = session;
		this.generation += 1;
		const nextState = prStateFromSession(
			this.sessionState.moduleState.pr,
			this.sessionState.moduleState.pr.discoveryDisabled === true,
			this.sessionState.moduleState.pr.discoveryTestedUrls ?? [],
		);
		this.state = nextState;
		await this.emitState(nextState, { persist: false });
		const isCurrentActivation =
			this.currentSession === session && epoch === this.getLifecycleEpoch();
		if (!isCurrentActivation) return;
		this.state = nextState;
	}

	private deactivateSession(): void {
		this.currentSession = null;
		this.generation += 1;
		this.state = {
			...this.sessionState.moduleState.pr,
			discoveryDisabled: true,
			discoveryTestedUrls: [],
			mergedPrs: [],
		};
	}

	private async syncSessionState(session: PrSession): Promise<void> {
		const isCurrent = this.isCurrentSession(session, this.generation);
		if (!isCurrent) return;
		this.state = prStateFromSession(
			this.sessionState.moduleState.pr,
			this.sessionState.moduleState.pr.discoveryDisabled === true,
			this.sessionState.moduleState.pr.discoveryTestedUrls ?? [],
		);
		await this.emitState(this.state, { persist: false });
	}

	private async initializeRemoteOrigin(
		ctx: ExtensionContext,
		remoteOrigin?: string,
	): Promise<string | undefined> {
		const operationGeneration = this.generation;
		const request: OriginRequest = {
			operationGeneration,
			lifecycleEpoch: this.getLifecycleEpoch(),
			sessionId: this.sessionState.session.activeSessionId,
		};
		const hasRemoteOrigin = remoteOrigin !== undefined;
		if (hasRemoteOrigin) {
			const isCurrentRequest = this.isCurrentOriginRequest(request);
			if (!isCurrentRequest) return remoteOrigin;
			await this.emitState(this.state, {
				persist: false,
				gitStatePatch: { remoteOrigin },
			});
			return remoteOrigin;
		}
		return this.discoverRemoteOrigin(ctx, request);
	}

	private async discoverRemoteOrigin(
		ctx: ExtensionContext,
		request: OriginRequest,
	): Promise<string | undefined> {
		const project = await inspectProject(
			this.dependencies.exec ?? spawnExec,
			ctx.cwd,
		);
		const isCurrentRequest = this.isCurrentOriginRequest(request);
		if (!isCurrentRequest) return undefined;
		const remoteOrigin = project.remoteOrigin ?? undefined;
		const hasNoRemoteOrigin = remoteOrigin === undefined;
		if (hasNoRemoteOrigin) return undefined;
		await this.emitState(this.state, {
			persist: true,
			gitStatePatch: { remoteOrigin },
		});
		return remoteOrigin;
	}

	private async persistPrIfAvailable(text: string): Promise<void> {
		const session = this.currentSession;
		const hasSession = session !== null;
		if (!hasSession) return;
		const canDiscover = !this.state.discoveryDisabled;
		const hasPinnedPr = this.state.prUrl !== undefined;
		const shouldSkipDiscovery = !canDiscover || hasPinnedPr;
		if (shouldSkipDiscovery) return;
		const operationGeneration = this.generation;
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
		const knownOrigin = this.sessionState.gitState.remoteOrigin;
		if (knownOrigin !== undefined) return knownOrigin;
		const identity = this.captureSessionIdentity(session, operationGeneration);
		const isCurrentBeforeDiscovery = this.isSameSessionIdentity(
			session,
			identity,
		);
		if (!isCurrentBeforeDiscovery) return null;
		const remoteOrigin = await this.discoverRemoteOrigin(session.context, {
			operationGeneration,
			lifecycleEpoch: this.getLifecycleEpoch(),
			sessionId: this.sessionState.session.activeSessionId,
			session,
			identity,
		});
		const isCurrentAfterDiscovery = this.isSameSessionIdentity(
			session,
			identity,
		);
		if (!isCurrentAfterDiscovery) return null;
		return remoteOrigin ?? null;
	}

	private async recordTestedUrl(
		session: PrSession,
		url: string,
		identity: PrSessionIdentity,
	): Promise<void> {
		const isCurrent = this.isSameSessionIdentity(session, identity);
		if (!isCurrent) return;
		const alreadyTested =
			this.state.discoveryTestedUrls?.includes(url) === true;
		if (alreadyTested) return;
		this.state = {
			...this.state,
			discoveryTestedUrls: [...(this.state.discoveryTestedUrls ?? []), url],
		};
		await this.emitState(this.state, { persist: true });
	}

	private async persistCandidate(
		session: PrSession,
		url: string,
		remoteOrigin: string,
		exec: Exec,
		operationGeneration: number,
	): Promise<boolean> {
		const alreadyTested =
			this.state.discoveryTestedUrls?.includes(url) === true;
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
		const canDiscover = !this.state.discoveryDisabled;
		const hasPinnedPr = this.state.prUrl !== undefined;
		const currentAndDiscoverable = isCurrentSession && canDiscover;
		const canPersist = currentAndDiscoverable && !hasPinnedPr;
		if (!canPersist) return false;
		const testedUrls = this.state.discoveryTestedUrls ?? [];
		const hasAlreadyTested = testedUrls.includes(url);
		const nextTestedUrls = hasAlreadyTested ? testedUrls : [...testedUrls, url];
		this.state = {
			...this.state,
			prUrl: url,
			discoveryDisabled: true,
			discoveryTestedUrls: nextTestedUrls,
		};
		await this.emitState(this.state, { persist: true });
		return true;
	}

	private async persistInitialPr(branch: readonly unknown[]): Promise<void> {
		await this.persistPrIfAvailable(branchTexts(branch).join("\n"));
	}

	private isCurrentBeforeAgentRequest(
		session: PrSession,
		ctx: ExtensionContext,
		epoch: number,
		generation: number,
	): boolean {
		const isCurrentSession = this.currentSession === session;
		const isCurrentGeneration = this.generation === generation;
		const isCurrentEpoch = this.getLifecycleEpoch() === epoch;
		const isCurrentContext = session.context === ctx;
		if (!isCurrentSession) return false;
		if (!isCurrentGeneration) return false;
		if (!isCurrentEpoch) return false;
		if (!isCurrentContext) return false;
		return true;
	}

	private async appendBeforeAgentPrompt(
		ctx: ExtensionContext,
		messages: string[],
		expectedSession?: PrSession | null,
		expectedEpoch?: number,
		expectedGeneration?: number,
	): Promise<void> {
		const session = expectedSession ?? this.currentSession;
		const epoch = expectedEpoch ?? this.getLifecycleEpoch();
		const generation = expectedGeneration ?? this.generation;
		if (session === null) return;
		const isCurrentBeforeInspection = this.isCurrentBeforeAgentRequest(
			session,
			ctx,
			epoch,
			generation,
		);
		if (!isCurrentBeforeInspection) return;
		const discoveredOrigin = await this.ensureRemoteOrigin(session, generation);
		if (discoveredOrigin === null) return;
		const worktree = await inspectProject(
			this.dependencies.exec ?? spawnExec,
			ctx.cwd,
		);
		const isCurrentAfterInspection = this.isCurrentBeforeAgentRequest(
			session,
			ctx,
			epoch,
			generation,
		);
		if (!isCurrentAfterInspection) return;
		const branch = worktree.branch;
		const remoteOrigin = discoveredOrigin ?? worktree.remoteOrigin;
		const hasWorktreeBranch = worktree.isWorktree && branch !== null;
		if (!hasWorktreeBranch) return;
		const hasRemoteOrigin = remoteOrigin !== null;
		if (!hasRemoteOrigin) return;
		await this.appendPrPrompt(
			ctx,
			messages,
			session,
			epoch,
			generation,
			branch,
			remoteOrigin,
		);
	}

	private async appendPrPrompt(
		ctx: ExtensionContext,
		messages: string[],
		session: PrSession,
		epoch: number,
		generation: number,
		branch: string,
		remoteOrigin: string,
	): Promise<void> {
		const result = await findOpenPr(
			this.dependencies.exec ?? spawnExec,
			ctx.cwd,
			branch,
			remoteOrigin,
		);
		const isCurrentAfterDiscovery = this.isCurrentBeforeAgentRequest(
			session,
			ctx,
			epoch,
			generation,
		);
		if (!isCurrentAfterDiscovery) return;
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

	private handleInitialPrDiscovery({
		branch,
		lifecycleEpoch,
	}: InitialPrDiscoveryEvent): Promise<void> {
		const isCurrentEpoch = lifecycleEpoch === this.getLifecycleEpoch();
		const hasPinnedPr = this.state.prUrl !== undefined;
		const isDiscoveryDisabled = this.state.discoveryDisabled;
		if (!isCurrentEpoch) return Promise.resolve();
		if (hasPinnedPr) return Promise.resolve();
		if (isDiscoveryDisabled) return Promise.resolve();
		return this.persistInitialPr(branch);
	}

	private handleMessageEnd({ event }: MessageEndEventPayload): Promise<void> {
		return this.persistPrIfAvailable(textOf(event.message));
	}

	private handleBeforeAgentStart({
		context,
		session,
		lifecycleEpoch,
		messages,
	}: BeforeAgentStartEventPayload): Promise<void> {
		const hasPerformedGitMutations = session.hasPerformedAnyGitMutations;
		const isCurrentSession = this.currentSession === session;
		const isCurrentEpoch = lifecycleEpoch === this.getLifecycleEpoch();
		if (!hasPerformedGitMutations) return Promise.resolve();
		if (!isCurrentSession) return Promise.resolve();
		if (!isCurrentEpoch) return Promise.resolve();
		return this.appendBeforeAgentPrompt(
			context,
			messages,
			session,
			lifecycleEpoch,
			this.generation,
		);
	}

	private isCurrentOperation(_session: PrSession, generation: number): boolean {
		return this.generation === generation;
	}

	private enqueueSessionOperation<T>(
		_session: PrSession,
		operation: () => Promise<T>,
	): Promise<T> {
		return this.promptQueue
			.enqueue(() => operation())
			.then((result) => result as T);
	}

	private async updatePrState(
		nextState: PrState,
		persist: boolean,
	): Promise<void> {
		const normalizedState = normalizePrState(nextState);
		this.state = normalizedState;
		await this.publishState.publish(normalizedState, { persist });
	}

	private commandDependencies(): PrCommandOptions {
		return {
			sessionState: this.sessionState,
			eventHandler: this.eventHandler,
			exec: this.dependencies.exec,
			getSession: () => this.currentSession,
			getLifecycleEpoch: this.getLifecycleEpoch,
			getPrState: () => this.state,
			getOperationGeneration: () => this.generation,
			isCurrentOperation: this.isCurrentOperation.bind(this),
			enqueueSessionOperation: this.enqueueSessionOperation.bind(this),
		};
	}

	private async recordMerge(event: PrMergedEvent): Promise<void> {
		const session = this.currentSession;
		if (session === null) return;
		const isSameSession =
			this.sessionState.session.activeSessionId === event.sessionId;
		const isSameEpoch = this.getLifecycleEpoch() === event.lifecycleEpoch;
		const isCurrentIdentity = isSameSession && isSameEpoch;
		if (!isCurrentIdentity) return;
		if (event.prUrl === null) return;
		const recordedState = recordMergedPr(
			{ ...this.state, prUrl: event.prUrl },
			new Date().toISOString(),
		);
		const nextState = { ...this.state, ...recordedState };
		const changed = nextState !== this.state;
		if (!changed) return;
		this.state = nextState;
		await this.emitState(this.state, { persist: true });
		const isCurrentAfterEmit =
			this.currentSession === session &&
			this.getLifecycleEpoch() === event.lifecycleEpoch;
		if (!isCurrentAfterEmit) return;
	}

	private async handleToolResult(
		event: Parameters<typeof handlePrToolResult>[5],
		ctx: ExtensionContext,
	): Promise<void> {
		await handlePrToolResult(
			() => this.currentSession,
			this.sessionState,
			this.state,
			this.generation,
			this.generation,
			event,
			ctx,
			(prUrl) => {
				const session = this.currentSession;
				if (session === null) return Promise.resolve();
				return this.eventHandler.prMergedEvent.emit({
					prUrl,
					taskMarkedAsCompleted: false,
					sessionId: this.sessionState.session.activeSessionId ?? "",
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
			this.sessionState.session.activeSessionId === request.sessionId;
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

	private captureSessionIdentity(
		session: PrSession,
		operationGeneration: number,
	): PrSessionIdentity {
		return {
			workRevision: session.workRevision,
			prUrl: this.state.prUrl,
			discoveryDisabled: this.state.discoveryDisabled === true,
			operationGeneration,
		};
	}

	private isSameSessionIdentity(
		session: PrSession,
		identity: PrSessionIdentity,
	): boolean {
		const sameSession = this.currentSession === session;
		const sameRootSession = this.sessionState.session.activeSessionId !== null;
		const sameGeneration = this.generation === identity.operationGeneration;
		const sameWorkRevision = session.workRevision === identity.workRevision;
		const samePrUrl = this.state.prUrl === identity.prUrl;
		const sameDiscoveryEligibility =
			this.state.discoveryDisabled === identity.discoveryDisabled;
		const sameSessionAndRoot = sameSession && sameRootSession;
		const samePrIdentity = samePrUrl && sameDiscoveryEligibility;
		const currentSessionAndGeneration = sameSessionAndRoot && sameGeneration;
		const currentWorkAndPr = sameWorkRevision && samePrIdentity;
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
			persist?: boolean;
			gitStatePatch?: Partial<import("../state.ts").GitState>;
		},
	): Promise<void> {
		const currentEmission = this.sessionState.session.activeSessionId !== null;
		if (!currentEmission) return;
		await this.publishState.publish(normalizePrState(moduleState), {
			persist: options?.persist ?? false,
			...(options?.gitStatePatch === undefined
				? {}
				: { gitStatePatch: options.gitStatePatch }),
		});
	}
}

export function createPrModule(options: PrModuleOptions): PrModule {
	return new PrModuleImpl(options);
}

export { mergeProtocolSkillPath };
