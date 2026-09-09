import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExitPickerResult } from "./picker.ts";
import { ExitActionPicker } from "./tui-picker.ts";
import type { ExitAction } from "./types.ts";

type CustomUI = NonNullable<ExtensionContext["ui"]["custom"]>;
type CustomFactory = Parameters<CustomUI>[0];
type PickerTUI = Parameters<CustomFactory>[0];

class PickerWidget {
	private readonly picker: ExitActionPicker;
	private readonly tui: PickerTUI;

	constructor(
		tui: PickerTUI,
		actions: readonly ExitAction[],
		done: (result: ExitPickerResult) => void,
	) {
		this.tui = tui;
		this.picker = new ExitActionPicker(actions, done);
	}

	render(width: number): string[] {
		return this.picker.render(width);
	}

	handleInput(data: string): void {
		this.picker.handleInput(data);
		this.tui.requestRender();
	}

	invalidate(): void {}
}

export function pickWithCustomUI(
	custom: CustomUI,
	actions: readonly ExitAction[],
): Promise<ExitPickerResult> {
	return custom<ExitPickerResult>(
		(tui, _theme, _keybindings, done) => new PickerWidget(tui, actions, done),
	);
}
