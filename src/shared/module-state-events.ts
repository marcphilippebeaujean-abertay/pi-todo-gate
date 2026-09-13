import type { ModuleStateChangedEvent } from "./events.ts";
import type { GitState, ModuleId, ModuleState } from "./session-state.ts";

type ModuleStatePublisherOptions = {
	persist: boolean;
	gitStatePatch?: Partial<GitState>;
};

type ModuleStateBuilders = {
	[K in ModuleId]: (
		moduleState: ModuleState[K],
		options: ModuleStatePublisherOptions,
	) => Extract<ModuleStateChangedEvent, { moduleId: K }>;
};

const moduleStateBuilders: ModuleStateBuilders = {
	pr: (moduleState, options) => ({
		moduleId: "pr",
		moduleState,
		...options,
	}),
	todoist: (moduleState, options) => ({
		moduleId: "todoist",
		moduleState,
		...options,
	}),
	herdr: (moduleState, options) => ({
		moduleId: "herdr",
		moduleState,
		...options,
	}),
	worktree: (moduleState, options) => ({
		moduleId: "worktree",
		moduleState,
		...options,
	}),
	footer: (moduleState, options) => ({
		moduleId: "footer",
		moduleState,
		...options,
	}),
	exitProtocol: (moduleState, options) => ({
		moduleId: "exitProtocol",
		moduleState,
		...options,
	}),
};

export function createModuleStateUpdate<K extends ModuleId>(
	moduleId: K,
	moduleState: ModuleState[K],
	options: ModuleStatePublisherOptions,
): Extract<ModuleStateChangedEvent, { moduleId: K }> {
	return moduleStateBuilders[moduleId](moduleState, options);
}
