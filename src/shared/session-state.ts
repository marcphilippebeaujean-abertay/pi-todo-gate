import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface GitState {
	remoteOrigin?: string;
	mergeCompletedAt?: string;
	branch?: string | null;
	isWorktree?: boolean;
	worktreeRoot?: string | null;
	mainRoot?: string | null;
	hasUncommittedChanges?: boolean;
}

export interface SessionMetadata {
	activeSessionId: string | null;
	inheritedFromSessionId?: string;
}

export interface MergedPrState {
	prUrl: string;
	detectedAt: string;
	reminderPending: boolean;
}

export interface PrModuleState {
	prUrl?: string;
	discoveryDisabled: boolean;
	discoveryTestedUrls: string[];
	mergedPrs: MergedPrState[];
}

export interface TodoistModuleState {
	taskRef?: string;
	taskName?: string;
	taskUrl?: string;
	todoistCompletionAttemptedAt?: string;
	mergePromptedPrUrl?: string;
}

export interface HerdrModuleState {
	claimInProgress?: boolean;
	herdrClaimReturnedSuccessfully?: string;
}

export interface WorktreeModuleState {
	initialHead?: string;
	initialStatus?: string;
}

export interface FooterStatusState {
	footerType: string;
	isLoading: boolean;
	text: string;
	isVisible: boolean;
}

export interface FooterModuleState {
	footers: Record<string, FooterStatusState>;
}

export interface ExitProtocolModuleState {
	active: boolean;
}

export interface ModuleState {
	pr: PrModuleState;
	todoist: TodoistModuleState;
	herdr: HerdrModuleState;
	worktree: WorktreeModuleState;
	footer: FooterModuleState;
	exitProtocol: ExitProtocolModuleState;
}

export type ModuleId = keyof ModuleState;

export interface SessionState {
	session: SessionMetadata;
	gitState: GitState;
	moduleState: ModuleState;
}

export type SessionStateSnapshot = SessionState;

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue | undefined };

export interface ModuleStateDescriptor<K extends ModuleId> {
	id: K;
	createInitialState(): ModuleState[K];
	restore(value: unknown): ModuleState[K];
	serialize(state: ModuleState[K]): JsonValue;
}

export type ModuleStateDescriptors = {
	[K in ModuleId]: ModuleStateDescriptor<K>;
};

export interface SessionRecord {
	context: ExtensionContext;
	project: {
		codingRoot: string;
		todoistProjectRef: string;
		triggersOnlyOnWorktree?: boolean;
	};
	hasPendingHandoffContext: boolean;
	hasPerformedAnyGitMutations: boolean;
	workRevision: number;
	operationGeneration: number;
	operationQueue: Promise<void>;
}

export interface SessionReader {
	getBranch(): unknown[];
	getSessionId(): string;
	getCwd(): string;
}
