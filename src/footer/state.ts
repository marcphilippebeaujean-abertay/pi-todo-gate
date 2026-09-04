import { isFooterUpdate } from "./events.ts";
import type { FooterState, FooterUpdate } from "./types.ts";

export function emptyFooterState(): FooterState {
	return { footers: {} };
}

export function isFooterState(value: unknown): value is FooterState {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const footers = (value as { footers?: unknown }).footers;
	if (typeof footers !== "object" || footers === null || Array.isArray(footers))
		return false;
	return Object.entries(footers).every(
		([key, event]) => isFooterUpdate(event) && key === event.footerType,
	);
}

export function applyFooterUpdate(
	state: FooterState,
	event: FooterUpdate,
): FooterState {
	return {
		footers: {
			...state.footers,
			[event.footerType]: event,
		},
	};
}
