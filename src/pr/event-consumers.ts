import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createModuleStatePublisher } from "../event-publishers.ts";
import { type CommandResult, type Exec, spawnExec } from "../shared/command.ts";
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
import type { SessionState } from "../state.ts";
import { matchesPinnedPr, publishPrMerged } from "./event-publishers.ts";
import { findOpenPr, isGithubPrAvailable, mergePinnedPr } from "./git.ts";
import type { PrModuleOptions, PrSession, PrState } from "./internal-state.ts";
import { normalizePrState } from "./module-state.ts";
import { notifyMergeFailure, notifyMergeSucceeded } from "./notifications.ts";
import { githubPrUrls, recordMergedPr } from "./parsing.ts";
import { installStateTool } from "./state-tool.ts";

const STRING_TYPE = "string";
const BASH_COMMAND = "command";
const GIT_MUTATION_RE =
	/\bgit\s+(add|commit|merge|rebase|checkout|switch|cherry-pick)\b/;

function failureDetail(detail: string): string {
	return detail.replace(/\s+/g, " ").trim().slice(0, 200);
}

function bashCommand(event: ToolResultEvent): string {
	const commandValue = event.input[BASH_COMMAND];
	return typeof commandValue === STRING_TYPE
		? String(commandValue)
		: C.worktree.empty;
}

function recordGitMutation(
	session: PrSession | undefined,
	command: string,
): void {
	if (session === undefined) return;
	const isGitMutation = GIT_MUTATION_RE.test(command);
	if (isGitMutation) session.hasPerformedAnyGitMutations = true;
}

async function persistCandidate(
	sessionState: SessionState,
	publisher: ReturnType<typeof createModuleStatePublisher<"pr">>,
	exec: Exec,
	url: string,
	remoteOrigin: string,
	cwd: string,
): Promise<void> {
	const isAvailable = await isGithubPrAvailable(exec, cwd, url, remoteOrigin);
	const current = sessionState.moduleState.pr;
	const testedUrls = current.discoveryTestedUrls ?? [];
	const isTested = testedUrls.includes(url);
	const nextTestedUrls = isTested ? testedUrls : [...testedUrls, url];
	const nextState = isAvailable
		? {
				...current,
				prUrl: url,
				discoveryDisabled: true,
				discoveryTestedUrls: nextTestedUrls,
			}
		: { ...current, discoveryTestedUrls: nextTestedUrls };
	await publisher.publish(normalizePrState(nextState), { persist: true });
}

export async function handlePrToolResult(
	sessionState: SessionState,
	eventHandler: EventHandler,
	event: ToolResultEvent,
	ctx: ExtensionContext,
	exec: Exec | undefined,
	session?: PrSession,
): Promise<void> {
	const commandExec = exec ?? spawnExec;
	const shouldIgnoreEvent = event.isError || event.toolName !== C.tool.bash;
	if (shouldIgnoreEvent) return;
	const command = bashCommand(event);
	recordGitMutation(session, command);
	const prUrl = sessionState.moduleState.pr.prUrl;
	if (prUrl === undefined) return;
	const isPinnedPr = await matchesPinnedPr(
		commandExec,
		ctx.cwd,
		command,
		prUrl,
	);
	if (!isPinnedPr) return;
	await publishPrMerged(
		eventHandler,
		prUrl,
		sessionState.session.activeSessionId ?? "",
	);
}

export class PrConsumer {
	private readonly pi: ExtensionAPI | undefined;
	private readonly eventHandler: EventHandler;
	private readonly sessionState: SessionState;
	private readonly exec: Exec;
	private readonly publishState;
	private registrationsAvailable = false;

	constructor(options: PrModuleOptions) {
		this.pi = options.pi;
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
		this.exec = options.exec ?? spawnExec;
		this.publishState = createModuleStatePublisher(
			this.eventHandler,
			C.module.pr,
		);
		this.subscribeEvents();
	}

	private get state(): PrState {
		return this.sessionState.moduleState.pr;
	}

	private subscribeEvents(): void {
		this.eventHandler.toolResultEvent.subscribe(({ event, context, session }) =>
			handlePrToolResult(
				this.sessionState,
				this.eventHandler,
				event,
				context,
				this.exec,
				session,
			),
		);
		this.eventHandler.piToolRegistrationsBecameAvailableEvent.subscribe(
			this.registerPiTools.bind(this),
		);
		this.eventHandler.sessionActivatedEvent.subscribe(() =>
			this.publishState.publish(this.state, { persist: false }),
		);
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
		installStateTool(pi, {
			sessionState: this.sessionState,
			publisher: this.publishState,
		});
	}

	private cwd(): string {
		return this.sessionState.gitState.worktreeRoot ?? process.cwd();
	}

	private persistPrIfAvailable(text: string): Promise<void> {
		const current = this.state;
		const discoveryDisabled = current.discoveryDisabled;
		const hasPinnedPr = current.prUrl !== undefined;
		const shouldSkipDiscovery = discoveryDisabled || hasPinnedPr;
		if (shouldSkipDiscovery) return Promise.resolve();
		const remoteOrigin = this.sessionState.gitState.remoteOrigin;
		const hasRemoteOrigin = remoteOrigin !== undefined;
		if (!hasRemoteOrigin) return Promise.resolve();
		const requests = githubPrUrls(text, remoteOrigin)
			.filter((url) => !current.discoveryTestedUrls.includes(url))
			.map((url) =>
				persistCandidate(
					this.sessionState,
					this.publishState,
					this.exec,
					url,
					remoteOrigin,
					this.cwd(),
				),
			);
		return Promise.all(requests).then(() => undefined);
	}

	private async appendBeforeAgentPrompt(
		ctx: ExtensionContext,
		messages: string[],
		session: PrSession,
	): Promise<void> {
		const hasPerformedGitMutations = session.hasPerformedAnyGitMutations;
		if (!hasPerformedGitMutations) return;
		const branch = this.sessionState.gitState.branch;
		const remoteOrigin = this.sessionState.gitState.remoteOrigin;
		const isWorktree = this.sessionState.gitState.isWorktree === true;
		const hasBranch = branch !== null && branch !== undefined;
		const canInspectBranch = isWorktree && hasBranch;
		if (!canInspectBranch) return;
		const hasRemoteOrigin = remoteOrigin !== undefined;
		if (!hasRemoteOrigin) return;
		const result = await findOpenPr(this.exec, ctx.cwd, branch, remoteOrigin);
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
	}: InitialPrDiscoveryEvent): Promise<void> {
		const current = this.state;
		const hasPinnedPr = current.prUrl !== undefined;
		const discoveryDisabled = current.discoveryDisabled;
		const shouldSkipDiscovery = hasPinnedPr || discoveryDisabled;
		if (shouldSkipDiscovery) return Promise.resolve();
		return this.persistPrIfAvailable(branchTexts(branch).join("\n"));
	}

	private handleMessageEnd({ event }: MessageEndEventPayload): Promise<void> {
		return this.persistPrIfAvailable(textOf(event.message));
	}

	private handleBeforeAgentStart({
		context,
		session,
		messages,
	}: BeforeAgentStartEventPayload): Promise<void> {
		return this.appendBeforeAgentPrompt(context, messages, session);
	}

	public mergeActivePr(context: ExtensionContext): Promise<boolean> {
		const prUrl = this.state.prUrl;
		if (prUrl === undefined) return Promise.resolve(false);
		if (this.sessionState.session.activeSessionId === null)
			return Promise.resolve(false);
		return this.runMerge(context, prUrl);
	}

	private async runMerge(
		context: ExtensionContext,
		prUrl: string,
	): Promise<boolean> {
		let result: CommandResult;
		try {
			result = await mergePinnedPr(this.exec, context.cwd, prUrl);
		} catch (error) {
			const detail = failureDetail(
				error instanceof Error ? error.message : String(error),
			);
			notifyMergeFailure(context, detail);
			return false;
		}
		const commandFailed = result.code !== 0;
		if (commandFailed) {
			notifyMergeFailure(context, failureDetail(result.stderr));
			return false;
		}
		await publishPrMerged(
			this.eventHandler,
			prUrl,
			this.sessionState.session.activeSessionId ?? "",
		);
		notifyMergeSucceeded(context);
		return true;
	}

	private async recordMerge(event: PrMergedEvent): Promise<void> {
		if (event.prUrl === null) return;
		const recordedState = recordMergedPr(
			{ ...this.state, prUrl: event.prUrl },
			new Date().toISOString(),
		);
		const { prUrl: _activePrUrl, ...stateWithoutActivePr } = this.state;
		const nextState: PrState = {
			...stateWithoutActivePr,
			...recordedState,
		};
		await this.emitState(nextState, { persist: true });
	}

	private async emitState(
		moduleState: PrState,
		options: {
			persist: boolean;
			gitStatePatch?: Partial<import("../state.ts").GitState>;
		},
	): Promise<void> {
		await this.publishState.publish(normalizePrState(moduleState), options);
	}
}
