import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SharedEvents } from "../shared/events.ts";
import { ExitActionPicker, type ExitPickerResult } from "./picker.ts";

export interface ExitProtocolModule {
	sessionStart(ctx: ExtensionContext): void;
	deactivate(): void;
}

export function createExitProtocolModule(
	events: SharedEvents,
): ExitProtocolModule {
	let context: ExtensionContext | null = null;
	let operationGeneration = 0;
	let promptQueue = Promise.resolve();

	const present = async (
		request: Parameters<Parameters<SharedEvents["on"]>[1]>[0],
		generation: number,
	): Promise<void> => {
		if (!context || generation !== operationGeneration || !context.hasUI)
			return;
		const actions = [...request.actions];
		if (actions.length === 0) return;

		let selected: ExitPickerResult;
		if (context.mode === "tui" && typeof context.ui.custom === "function") {
			selected = await context.ui.custom<ExitPickerResult>(
				(tui, _theme, _keybindings, done) => {
					const picker = new ExitActionPicker(actions, done);
					return {
						render: (width: number) => picker.render(width),
						handleInput: (data: string) => {
							picker.handleInput(data);
							tui.requestRender();
						},
						invalidate: () => undefined,
					};
				},
			);
		} else {
			const selectedIds: string[] = [];
			for (const action of actions) {
				if (await context.ui.confirm("Exit protocol", action.label))
					selectedIds.push(action.id);
			}
			selected = selectedIds;
		}
		if (selected === null || generation !== operationGeneration || !context)
			return;

		const selectedIds = new Set(selected);
		for (const action of actions) {
			if (!selectedIds.has(action.id)) continue;
			try {
				await action.execute();
			} catch (error) {
				try {
					context.ui.notify(
						`Exit action failed: ${
							error instanceof Error ? error.message : String(error)
						}`,
						"warning",
					);
				} catch {
					// Headless or torn-down UI.
				}
			}
		}
	};

	const enqueue = (
		request: Parameters<Parameters<SharedEvents["on"]>[1]>[0],
	): Promise<void> => {
		const generation = operationGeneration;
		const next = promptQueue.then(
			() => present(request, generation),
			() => present(request, generation),
		);
		promptQueue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	};

	events.on("prMerged", (request) => enqueue(request), "present");
	events.on(
		"sessionWillClose",
		(request) => {
			if (request.payload.reason !== "quit") return;
			return enqueue(request);
		},
		"present",
	);

	return {
		sessionStart(nextContext) {
			++operationGeneration;
			context = nextContext;
		},
		deactivate() {
			++operationGeneration;
			context = null;
		},
	};
}
