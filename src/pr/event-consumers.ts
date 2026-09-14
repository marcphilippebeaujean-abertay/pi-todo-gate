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
	ToolResultEvent,
} from "../shared/events.ts";
import { branchTexts, textOf } from "../shared/extension-message.ts";
import { inspectProject } from "../shared/project.ts";
import type { SessionState } from "../state.ts";
import { register as registerMergeProtocol } from "./commands.ts";
import { matchesPinnedPr, publishPrMerged } from "./event-publishers.ts";
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

const STRING_TYPE = "string";
const BASH_COMMAND = "command";
const GIT_MUTATION_RE =
	/\bgit\s+(add|commit|merge|rebase|checkout|switch|cherry-pick)\b/;

function isCurrentPrContext(
	getSession: () => PrSession | null,
	session: PrSession,
	context: ExtensionContext,
): boolean {
	const currentSession = getSession();
	return currentSession === session && session.context === context;
}

function bashCommand(event: ToolResultEvent): string {
	const commandValue = event.input[BASH_COMMAND];
	return typeof commandValue === STRING_TYPE
		? String(commandValue)
		: C.worktree.empty;
}

export function isCurrentMerge(
	sessionState: SessionState,
	prState: PrState,
	session: PrSession,
	workRevision: number,
	expectedSessionId: string,
	taskRef: string | undefined,
	prUrl: string,
): boolean {
	const activeSessionId = sessionState.session.activeSessionId;
	const hasSameRootSession = activeSessionId === expectedSessionId;
	const hasSameRevision = session.workRevision === workRevision;
	const hasSameTask = sessionState.moduleState.todoist.taskRef === taskRef;
	const hasSamePr = prState.prUrl === prUrl;
	const sameMergeIdentity = hasSameTask && hasSamePr;
	const sameSessionAndRevision = hasSameRevision && hasSameRootSession;
	const identityChecks = [sameSessionAndRevision, sameMergeIdentity];
	return identityChecks.every(Boolean);
}

async function emitCurrentMerge(
	getSession: () => PrSession | null,
	sessionState: SessionState,
	prState: PrState,
	session: PrSession,
	context: ExtensionContext,
	workRevision: number,
	expectedSessionId: string,
	taskRef: string | undefined,
	prUrl: string,
	emitMerged: (prUrl: string) => Promise<void>,
): Promise<void> {
	const isCurrentContext = isCurrentPrContext(getSession, session, context);
	if (!isCurrentContext) return;
	const currentMerge = isCurrentMerge(
		sessionState,
		prState,
		session,
		workRevision,
		expectedSessionId,
		taskRef,
		prUrl,
	);
	if (currentMerge) await emitMerged(prUrl);
}

export async function handlePrToolResult(
	getSession: () => PrSession | null,
	sessionState: SessionState,
	prState: PrState,
	expectedSessionId: string,
	event: ToolResultEvent,
	ctx: ExtensionContext,
	emitMerged: (prUrl: string) => Promise<void>,
	exec?: Exec,
): Promise<void> {
	const commandExec = exec ?? spawnExec;
	const shouldIgnoreEvent = event.isError || event.toolName !== C.tool.bash;
	if (shouldIgnoreEvent) return;
	const session = getSession();
	const hasSession = session !== null;
	if (!hasSession) return;
	const isCurrentContext = isCurrentPrContext(getSession, session, ctx);
	if (!isCurrentContext) return;
	const command = bashCommand(event);
	const isGitMutation = GIT_MUTATION_RE.test(command);
	if (isGitMutation) session.hasPerformedAnyGitMutations = true;
	const prUrl = prState.prUrl;
	if (prUrl === undefined) return;
	const taskRef = sessionState.moduleState.todoist.taskRef;
	const isPinnedPr = await matchesPinnedPr(
		commandExec,
		ctx.cwd,
		command,
		prUrl,
	);
	const isCurrentAfterMatch =
		sessionState.session.activeSessionId === expectedSessionId;
	const shouldIgnoreResult = !isCurrentAfterMatch || !isPinnedPr;
	if (shouldIgnoreResult) return;
	await emitCurrentMerge(
		getSession,
		sessionState,
		prState,
		session,
		ctx,
		session.workRevision,
		expectedSessionId,
		taskRef,
		prUrl,
		emitMerged,
	);
}

export class PrConsumer {
	private readonly promptQueue: PromptQueue;
	private readonly pi: ExtensionAPI | undefined;
	private readonly eventHandler: EventHandler;
	private readonly sessionState: SessionState;
	private currentSession: PrSession | null = null;
	private readonly dependencies: PrModuleDependencies;
	private registrationsAvailable = false;
	private state: PrState;
	private readonly publishState;

	constructor(options: PrModuleOptions) {
		this.promptQueue = options.promptQueue;
		this.pi = options.pi;
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
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
			async ({ context, session, sessionId }) => {
				const hasNoSession = session === undefined;
				if (hasNoSession) return;
				const expectedSessionId = sessionId;
				const activeSessionId = this.sessionState.session.activeSessionId;
				const isDifferentActiveSession = activeSessionId !== expectedSessionId;
				const isCurrentContext = session.context === context;
				if (!isCurrentContext) return;
				if (isDifferentActiveSession) return;
				this.currentSession = session;
				await this.activateSession(session);
				const latestActiveSessionId = this.sessionState.session.activeSessionId;
				const isStaleActivation = latestActiveSessionId !== expectedSessionId;
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

	private async activateSession(session: PrSession): Promise<void> {
		this.currentSession = session;
		const nextState = prStateFromSession(
			this.sessionState.moduleState.pr,
			this.sessionState.moduleState.pr.discoveryDisabled === true,
			this.sessionState.moduleState.pr.discoveryTestedUrls ?? [],
		);
		this.state = nextState;
		await this.emitState(nextState, { persist: false });
		const activeSessionId = this.sessionState.session.activeSessionId;
		const hasCurrentSessionId = activeSessionId === session.sessionId;
		const hasCurrentSession = this.currentSession === session;
		const isCurrentActivation = hasCurrentSession && hasCurrentSessionId;
		if (!isCurrentActivation) return;
		this.state = nextState;
	}

	private deactivateSession(): void {
		this.currentSession = null;
		this.state = {
			...this.sessionState.moduleState.pr,
			discoveryDisabled: true,
			discoveryTestedUrls: [],
			mergedPrs: [],
		};
	}

	private async syncSessionState(session: PrSession): Promise<void> {
		const isCurrent = this.isCurrentSession(session, session.sessionId);
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
		const request: OriginRequest = {
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
		const sessionId = session.sessionId;
		const remoteOrigin = await this.ensureRemoteOrigin(session, sessionId);
		if (remoteOrigin === null) return;
		const exec = this.dependencies.exec ?? spawnExec;
		for (const url of githubPrUrls(text, remoteOrigin)) {
			const persisted = await this.persistCandidate(
				session,
				url,
				remoteOrigin,
				exec,
				sessionId,
			);
			if (persisted) return;
		}
	}

	private async ensureRemoteOrigin(
		session: PrSession,
		sessionId: string,
	): Promise<string | null> {
		const knownOrigin = this.sessionState.gitState.remoteOrigin;
		if (knownOrigin !== undefined) return knownOrigin;
		const identity = this.captureSessionIdentity(session, sessionId);
		const isCurrentBeforeDiscovery = this.isSameSessionIdentity(
			session,
			identity,
		);
		if (!isCurrentBeforeDiscovery) return null;
		const remoteOrigin = await this.discoverRemoteOrigin(session.context, {
			sessionId,
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
		sessionId: string,
	): Promise<boolean> {
		const alreadyTested =
			this.state.discoveryTestedUrls?.includes(url) === true;
		if (alreadyTested) return false;
		const identity = this.captureSessionIdentity(session, sessionId);
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
		sessionId: string,
	): boolean {
		const isCurrentSession = this.currentSession === session;
		const isCurrentRootSession =
			this.sessionState.session.activeSessionId === sessionId;
		const isCurrentContext = session.context === ctx;
		const identityChecks = [
			isCurrentSession,
			isCurrentRootSession,
			isCurrentContext,
		];
		return identityChecks.every(Boolean);
	}

	private async appendBeforeAgentPrompt(
		ctx: ExtensionContext,
		messages: string[],
		expectedSession?: PrSession | null,
		expectedSessionId?: string,
	): Promise<void> {
		const session = expectedSession ?? this.currentSession;
		const sessionId = expectedSessionId ?? session?.sessionId;
		const hasNoSession = session === null;
		if (hasNoSession) return;
		const hasNoSessionId = sessionId === undefined;
		if (hasNoSessionId) return;
		const isCurrentBeforeInspection = this.isCurrentBeforeAgentRequest(
			session,
			ctx,
			sessionId,
		);
		const shouldSkipInspection = !isCurrentBeforeInspection;
		if (shouldSkipInspection) return;
		const discoveredOrigin = await this.ensureRemoteOrigin(session, sessionId);
		if (discoveredOrigin === null) return;
		const worktree = await inspectProject(
			this.dependencies.exec ?? spawnExec,
			ctx.cwd,
		);
		const isCurrentAfterInspection = this.isCurrentBeforeAgentRequest(
			session,
			ctx,
			sessionId,
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
			sessionId,
			branch,
			remoteOrigin,
		);
	}

	private async appendPrPrompt(
		ctx: ExtensionContext,
		messages: string[],
		session: PrSession,
		sessionId: string,
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
			sessionId,
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
		sessionId,
	}: InitialPrDiscoveryEvent): Promise<void> {
		const activeSessionId = this.sessionState.session.activeSessionId;
		const isCurrentSession = activeSessionId === sessionId;
		const hasPinnedPr = this.state.prUrl !== undefined;
		const isDiscoveryDisabled = this.state.discoveryDisabled;
		if (!isCurrentSession) return Promise.resolve();
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
		sessionId,
		messages,
	}: BeforeAgentStartEventPayload): Promise<void> {
		const hasPerformedGitMutations = session.hasPerformedAnyGitMutations;
		const expectedSessionId = sessionId;
		const activeSessionId = this.sessionState.session.activeSessionId;
		const hasCurrentSessionId = activeSessionId === expectedSessionId;
		const hasCurrentSession = this.currentSession === session;
		const isCurrentSession = hasCurrentSession && hasCurrentSessionId;
		if (!hasPerformedGitMutations) return Promise.resolve();
		if (!isCurrentSession) return Promise.resolve();
		return this.appendBeforeAgentPrompt(
			context,
			messages,
			session,
			expectedSessionId,
		);
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
			getPrState: () => this.state,
			isCurrentSession: this.isCurrentSession.bind(this),
			enqueueSessionOperation: this.enqueueSessionOperation.bind(this),
		};
	}

	private async recordMerge(event: PrMergedEvent): Promise<void> {
		const session = this.currentSession;
		if (session === null) return;
		const isCurrentIdentity =
			this.sessionState.session.activeSessionId === event.sessionId;
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
		const activeSessionId = this.sessionState.session.activeSessionId;
		const isCurrentAfterEmit =
			this.currentSession === session && activeSessionId === event.sessionId;
		if (!isCurrentAfterEmit) return;
	}

	private async handleToolResult(
		event: Parameters<typeof handlePrToolResult>[4],
		ctx: ExtensionContext,
	): Promise<void> {
		const expectedSessionId = this.sessionState.session.activeSessionId;
		if (expectedSessionId === null) return;
		await handlePrToolResult(
			() => this.currentSession,
			this.sessionState,
			this.state,
			expectedSessionId,
			event,
			ctx,
			(prUrl) => {
				const isCurrentAfterMatch =
					this.sessionState.session.activeSessionId === expectedSessionId;
				if (!isCurrentAfterMatch) return Promise.resolve();
				return publishPrMerged(this.eventHandler, prUrl, expectedSessionId);
			},
			this.dependencies.exec ?? spawnExec,
		);
	}

	private isCurrentOriginRequest(request: OriginRequest): boolean {
		const isCurrentRootSession =
			request.sessionId !== null &&
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
		return isCurrentRootSession && isCurrentSession;
	}

	private captureSessionIdentity(
		session: PrSession,
		sessionId: string,
	): PrSessionIdentity {
		return {
			workRevision: session.workRevision,
			prUrl: this.state.prUrl,
			discoveryDisabled: this.state.discoveryDisabled === true,
			sessionId,
		};
	}

	private isSameSessionIdentity(
		session: PrSession,
		identity: PrSessionIdentity,
	): boolean {
		const sameSession = this.currentSession === session;
		const activeSessionId = this.sessionState.session.activeSessionId;
		const sameRootSession = activeSessionId === identity.sessionId;
		const sameWorkRevision = session.workRevision === identity.workRevision;
		const samePrUrl = this.state.prUrl === identity.prUrl;
		const sameDiscoveryEligibility =
			this.state.discoveryDisabled === identity.discoveryDisabled;
		const sameSessionAndRoot = sameSession && sameRootSession;
		const samePrIdentity = samePrUrl && sameDiscoveryEligibility;
		const currentWorkAndPr = sameWorkRevision && samePrIdentity;
		return sameSessionAndRoot && currentWorkAndPr;
	}

	private isCurrentSession(session: PrSession, sessionId: string): boolean {
		const identity = this.captureSessionIdentity(session, sessionId);
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
