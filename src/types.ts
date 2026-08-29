export interface TodoistProjectMapping {
	projects: Record<string, string>;
}

export interface ResolvedProject {
	codingRoot: string;
	todoistProjectRef: string;
}

export interface WorkState {
	prUrl?: string;
	taskUrl?: string;
	taskRef?: string;
	inheritedFrom?: string;
	mergeCompletedAt?: string;
	todoistCompletionAttemptedAt?: string;
}
