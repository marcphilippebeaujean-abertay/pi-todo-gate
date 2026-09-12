export const EXIT_SUBMIT_KEY = "submit";
export const EXIT_CANCEL_KEY = "cancel";
export const EXIT_ACTION_KEY = "action";
export const EXIT_ACTION_FAILED = "Exit action failed: ";
export const EXIT_TITLE = "Exit protocol";
const EXIT_TEXT = { empty: "" } as const;
export const EXIT_EMPTY = EXIT_TEXT.empty;
export const EXIT_TAB_KEY = "tab";
export const EXIT_SUBMIT_LABEL = "Submit";
export const EXIT_CANCEL_LABEL = "Cancel";
const EXIT_MARKERS = {
	selected: "x",
	unselected: " ",
	focused: ">",
	unfocused: " ",
} as const;
export const EXIT_SELECTED = EXIT_MARKERS.selected;
export const EXIT_UNSELECTED = EXIT_MARKERS.unselected;
export const EXIT_FOCUSED = EXIT_MARKERS.focused;
export const EXIT_UNFOCUSED = EXIT_MARKERS.unfocused;
export const EXIT_PRESENT_PHASE = "present";
export const EXIT_TUI_MODE = "tui";
