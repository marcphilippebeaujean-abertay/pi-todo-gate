import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExitAction } from "./types.ts";

export type PickerFocus = "submit" | "cancel" | { type: "action"; id: string };

export interface PickerState {
	readonly actionIds: readonly string[];
	readonly selectedIds: ReadonlySet<string>;
	readonly focused: PickerFocus;
}

export function initialPickerState(actionIds: readonly string[]): PickerState {
	return {
		actionIds: [...actionIds],
		selectedIds: new Set(actionIds),
		focused: "submit",
	};
}

export function toggleAction(state: PickerState, id: string): PickerState {
	if (!state.actionIds.includes(id)) return state;
	const selectedIds = new Set(state.selectedIds);
	if (selectedIds.has(id)) selectedIds.delete(id);
	else selectedIds.add(id);
	return { ...state, selectedIds };
}

export function focusAction(state: PickerState, id: string): PickerState {
	return state.actionIds.includes(id)
		? { ...state, focused: { type: "action", id } }
		: state;
}

export function focusSubmit(state: PickerState): PickerState {
	return { ...state, focused: "submit" };
}

export type ExitPickerResult = readonly string[] | null;

export class ExitActionPicker {
	private state: PickerState;
	private readonly actions: readonly ExitAction[];
	private readonly done: (result: ExitPickerResult) => void;

	constructor(
		actions: readonly ExitAction[],
		done: (result: ExitPickerResult) => void,
	) {
		this.actions = actions;
		this.state = initialPickerState(actions.map((action) => action.id));
		this.done = done;
	}

	render(width: number): string[] {
		const rows = ["Exit protocol", ""];
		for (const action of this.actions) {
			const focused =
				typeof this.state.focused === "object" &&
				this.state.focused.id === action.id;
			const marker = focused ? ">" : " ";
			const checked = this.state.selectedIds.has(action.id) ? "x" : " ";
			rows.push(`${marker} [${checked}] ${action.label}`);
		}
		rows.push("");
		rows.push(
			`${this.state.focused === "submit" ? ">" : " "} Submit    ${this.state.focused === "cancel" ? ">" : " "} Cancel`,
		);
		return rows.map((row) => truncateToWidth(row, width, ""));
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.tab)) {
			this.moveFocus(1);
			return;
		}
		if (matchesKey(data, Key.shift("tab"))) {
			this.moveFocus(-1);
			return;
		}
		if (matchesKey(data, Key.up)) {
			this.moveFocus(-1);
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.moveFocus(1);
			return;
		}
		if (matchesKey(data, Key.space)) {
			if (typeof this.state.focused === "object")
				this.state = toggleAction(this.state, this.state.focused.id);
			return;
		}
		if (matchesKey(data, Key.enter)) {
			if (this.state.focused === "submit") {
				this.done([...this.state.selectedIds]);
			} else if (this.state.focused === "cancel") {
				this.done(null);
			} else {
				this.state = toggleAction(this.state, this.state.focused.id);
			}
			return;
		}
		if (matchesKey(data, Key.escape)) this.done(null);
	}

	private moveFocus(direction: 1 | -1): void {
		const targets: PickerFocus[] = [
			...this.actions.map((action) => ({
				type: "action" as const,
				id: action.id,
			})),
			"submit",
			"cancel",
		];
		const index = targets.findIndex((target) =>
			typeof target === "object" && typeof this.state.focused === "object"
				? target.id === this.state.focused.id
				: target === this.state.focused,
		);
		const next = targets[(index + direction + targets.length) % targets.length];
		if (next) this.state = { ...this.state, focused: next };
	}
}
