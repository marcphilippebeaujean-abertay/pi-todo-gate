import {
	hyperlink,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import {
	FOOTER_SPINNER_FRAMES,
	FOOTER_SPINNER_INTERVAL_MS,
} from "./constants.ts";
import type {
	FooterUpdate,
	FooterState as PersistedFooterState,
} from "./data.ts";

type SessionContext = {
	ui: {
		setStatus(key: string, text: string | undefined): void;
	};
};
type AnimationTimer = ReturnType<typeof setInterval>;
type Animation = {
	timer: AnimationTimer | null;
	event: FooterUpdate;
	frameIndex: number;
};

function loadingText(text: string, frame: string): string {
	for (const spinner of FOOTER_SPINNER_FRAMES) {
		const hasSpinner = text.includes(spinner);
		if (hasSpinner) return text.replace(spinner, frame);
	}
	return text;
}

function eventText(event: FooterUpdate): string | undefined {
	const isVisible = event.isVisible;
	if (!isVisible) return undefined;
	return event.text;
}

export class FooterDisplay {
	private context: SessionContext | null = null;
	private state: PersistedFooterState = { footers: {} };
	private renderedFooterTypes = new Set<string>();
	private animations = new Map<string, Animation>();

	start(context: SessionContext, state: PersistedFooterState): void {
		this.clear();
		this.context = context;
		this.state = state;
		for (const event of Object.values(state.footers))
			this.syncEvent(context, event);
	}

	update(state: PersistedFooterState, event: FooterUpdate): void {
		this.state = state;
		if (this.context === null) return;
		this.syncEvent(this.context, event);
	}

	clear(): void {
		for (const footerType of this.animations.keys())
			this.stopAnimation(footerType);
		const hasContext = this.context !== null;
		if (!hasContext) return;
		for (const footerType of this.renderedFooterTypes)
			this.setStatus(footerType, undefined);
		this.renderedFooterTypes = new Set<string>();
	}

	deactivate(): void {
		this.clear();
		this.context = null;
		this.state = { footers: {} };
	}

	private stopAnimation(footerType: string): void {
		const animation = this.animations.get(footerType);
		const hasAnimation = animation !== undefined;
		if (!hasAnimation) return;
		if (animation.timer !== null) clearInterval(animation.timer);
		this.animations.delete(footerType);
	}

	private setStatus(footerType: string, text: string | undefined): void {
		const context = this.context;
		const hasContext = context !== null;
		if (!hasContext) return;
		try {
			context.ui.setStatus(footerType, text);
		} catch {
			// Headless modes may not expose status UI.
		}
	}

	private syncEvent(context: SessionContext, event: FooterUpdate): void {
		this.stopAnimation(event.footerType);
		this.renderedFooterTypes.add(event.footerType);
		const visibleText = eventText(event);
		this.setStatus(event.footerType, visibleText);
		const shouldAnimate = event.isLoading && event.isVisible;
		if (!shouldAnimate) return;
		const animation: Animation = {
			timer: null,
			event,
			frameIndex: 0,
		};
		animation.timer = setInterval(
			this.advanceAnimation.bind(this, animation, context),
			FOOTER_SPINNER_INTERVAL_MS,
		);
		this.animations.set(event.footerType, animation);
	}

	private advanceAnimation(
		animation: Animation,
		context: SessionContext,
	): void {
		const current = this.state.footers[animation.event.footerType];
		const isCurrent = current === animation.event;
		if (!isCurrent) {
			this.stopAnimation(animation.event.footerType);
			return;
		}
		const isLoading = current.isLoading;
		if (!isLoading) {
			this.stopAnimation(animation.event.footerType);
			return;
		}
		const isVisible = current.isVisible;
		if (!isVisible) {
			this.stopAnimation(animation.event.footerType);
			return;
		}
		animation.frameIndex =
			(animation.frameIndex + 1) % FOOTER_SPINNER_FRAMES.length;
		const frame = FOOTER_SPINNER_FRAMES[animation.frameIndex];
		const text = loadingText(current.text, frame);
		try {
			context.ui.setStatus(current.footerType, text);
		} catch {
			// Headless modes may not expose status UI.
		}
	}
}

const DIM = "dim";
const STATUS_SEPARATOR = " | ";

export interface FooterRenderState {
	prUrl?: string;
	taskUrl?: string;
	taskName?: string;
	branch?: string | null;
}

export interface FooterTheme {
	fg(color: string, text: string): string;
}

export interface FooterData {
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getGitBranch?(): string | null | undefined;
	onBranchChange(listener: () => void): () => void;
}

export interface FooterTui {
	requestRender(): void;
}

export interface FooterComponent {
	dispose(): void;
	invalidate(): void;
	render(width: number): string[];
}

export type FooterFactory = (
	tui: FooterTui,
	theme: FooterTheme,
	footerData: FooterData,
) => FooterComponent;

export function renderFooterLine(
	state: FooterRenderState,
	width: number,
	theme: FooterTheme,
	statuses: ReadonlyMap<string, string>,
): string {
	const hasNoWidth: boolean = !!(width <= 0);
	if (hasNoWidth) return "";
	const parts = [
		renderPrLabel(state.prUrl, theme),
		renderTaskLabel(state.taskUrl, theme, state.taskName),
	];
	const hasBranch: boolean = !!state.branch;
	if (hasBranch) parts.push(`branch: ${state.branch}`);
	for (const status of statuses.values()) {
		const hasStatus: boolean = !!status;
		if (hasStatus) parts.push(status);
	}
	const line = theme.fg(DIM, parts.join(STATUS_SEPARATOR));
	const fitsWidth: boolean = !!(visibleWidth(line) <= width);
	if (fitsWidth) return line;
	return truncateToWidth(line, width, "", false);
}

function noop(): void {}

function requestRender(tui: FooterTui): () => void {
	return () => tui.requestRender();
}

function renderFooterComponent(
	state: () => FooterRenderState,
	footerData: FooterData,
	theme: FooterTheme,
	width: number,
): string[] {
	const currentState = state();
	const branch = currentState.branch ?? footerData.getGitBranch?.();
	return [
		renderFooterLine(
			{ ...currentState, branch },
			width,
			theme,
			footerData.getExtensionStatuses(),
		),
	];
}

export function createFooterFactory(
	state: () => FooterRenderState,
): FooterFactory {
	return (tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(requestRender(tui));
		return {
			dispose: unsubscribe,
			invalidate: noop,
			render: renderFooterComponent.bind(null, state, footerData, theme),
		};
	};
}

const NONE_TEXT = "none";
const ACCENT_COLOR = "accent";
const MUTED_COLOR = "muted";
const TEXT_COLOR = "text";
const PR_LINK_LABEL = "| PR Link: ";
const NO_PR_LABEL = "PR: none";
const PR_FOOTER_SEPARATOR = " |";
const HTTPS_PROTOCOL = "https:";

interface PrFooterTheme {
	fg(color: string, text: string): string;
}

function normalizedPrUrl(value: string | undefined): string | null {
	const hasValue = value !== undefined;
	if (!hasValue) return null;
	try {
		const url = new URL(value);
		const isHttps = url.protocol === HTTPS_PROTOCOL;
		if (!isHttps) return null;
		const isGithub = url.hostname.toLowerCase() === "github.com";
		if (!isGithub) return null;
		const match = url.pathname.match(/^\/[^/]+\/[^/]+\/pull\/([1-9]\d*)\/?$/);
		const hasMatch = match !== null;
		return hasMatch
			? `https://github.com${url.pathname.replace(/\/$/, "")}`
			: null;
	} catch {
		return null;
	}
}

function linkText(text: string, theme?: PrFooterTheme): string {
	const colored =
		theme?.fg(ACCENT_COLOR, text) ?? `\u001b[34m${text}\u001b[39m`;
	return `\u001b[4m${colored}\u001b[24m`;
}

function prNumber(url: string | undefined): string | null {
	const normalized = normalizedPrUrl(url);
	return normalized?.match(/\/pull\/(\d+)$/)?.[1] ?? null;
}

function boundedPrNumber(number: string): string {
	const exceedsNumberLimit = number.length > 6;
	return exceedsNumberLimit ? `${number.slice(0, 5)}…` : number;
}

export function renderPrLabel(
	url: string | undefined,
	theme?: PrFooterTheme,
): string {
	const normalized = normalizedPrUrl(url);
	const number = prNumber(url);
	const hasNoPr = normalized === null || number === null;
	if (hasNoPr) return NO_PR_LABEL;
	return hyperlink(
		linkText(`PR #${boundedPrNumber(number)}`, theme),
		normalized,
	);
}

export function renderPrStatus(
	url: string | undefined,
	theme?: PrFooterTheme,
	hasUncommittedChanges = false,
): string {
	const normalized = normalizedPrUrl(url);
	const number = prNumber(url);
	const muted = (text: string) => theme?.fg(MUTED_COLOR, text) ?? text;
	const value = (text: string) => theme?.fg(TEXT_COLOR, text) ?? text;
	const hasNoPr = normalized === null || number === null;
	if (hasNoPr)
		return `${muted(PR_LINK_LABEL)}${value(NONE_TEXT)}${muted(PR_FOOTER_SEPARATOR)}`;
	const dirtyMarker = hasUncommittedChanges ? "*" : "";
	return `${muted(PR_LINK_LABEL)}${hyperlink(linkText(`#${boundedPrNumber(number)}${dirtyMarker}`, theme), normalized)}${muted(PR_FOOTER_SEPARATOR)}`;
}

const OPEN_TASK_LABEL = "open";
const TODOIST_TASK_LABEL = "Todoist Task: ";
const TASK_NONE_LABEL = "Todoist Task: none";
const TASK_FOOTER_SEPARATOR = " |";
const HTTP_PROTOCOL = "http:";
const TASK_HTTPS_PROTOCOL = "https:";

export interface TodoistFooterTheme {
	fg(color: string, text: string): string;
}

function taskLinkText(text: string, theme?: TodoistFooterTheme): string {
	const colored =
		theme?.fg(ACCENT_COLOR, text) ?? `\u001b[34m${text}\u001b[39m`;
	return `\u001b[4m${colored}\u001b[24m`;
}

function displayTaskName(
	taskName: string | undefined,
	id: string | undefined,
): string {
	const name = taskName?.replace(/\s+/g, " ").trim();
	const hasId = id !== undefined;
	if (name === undefined) return hasId ? `#${id}` : OPEN_TASK_LABEL;
	const hasName = name !== "";
	const exceedsNameLimit = name.length > 15;
	if (hasName) return exceedsNameLimit ? `${name.slice(0, 15)}...` : name;
	return hasId ? `#${id}` : OPEN_TASK_LABEL;
}

export function renderTaskLabel(
	url: string | undefined,
	theme?: TodoistFooterTheme,
	taskName?: string,
): string {
	const hasUrl = Boolean(url);
	if (!hasUrl) return TASK_NONE_LABEL;
	const inputUrl = url ?? "";
	try {
		const parsed = new URL(inputUrl);
		const protocol = parsed.protocol;
		const isSupportedProtocol =
			protocol === HTTP_PROTOCOL || protocol === TASK_HTTPS_PROTOCOL;
		if (!isSupportedProtocol) return TASK_NONE_LABEL;
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return `${TODOIST_TASK_LABEL}${hyperlink(taskLinkText(displayTaskName(taskName, id), theme), inputUrl)}`;
	} catch {
		return TASK_NONE_LABEL;
	}
}

function renderTaskStatusValue(
	url: string | undefined,
	theme: TodoistFooterTheme | undefined,
	taskName: string | undefined,
	includeSeparator: boolean,
): string {
	const muted = (text: string) => theme?.fg(MUTED_COLOR, text) ?? text;
	const value = (text: string) => theme?.fg(TEXT_COLOR, text) ?? text;
	const createTaskLabel = (taskValue: string): string => {
		const suffix = includeSeparator ? muted(TASK_FOOTER_SEPARATOR) : "";
		return `${muted(TODOIST_TASK_LABEL)}${taskValue}${suffix}`;
	};
	const hasUrl = Boolean(url);
	if (!hasUrl) return createTaskLabel(value(NONE_TEXT));
	const inputUrl = url ?? "";
	try {
		const parsed = new URL(inputUrl);
		const protocol = parsed.protocol;
		const isSupportedProtocol =
			protocol === HTTP_PROTOCOL || protocol === TASK_HTTPS_PROTOCOL;
		if (!isSupportedProtocol) return createTaskLabel(value(NONE_TEXT));
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return createTaskLabel(
			hyperlink(taskLinkText(displayTaskName(taskName, id), theme), inputUrl),
		);
	} catch {
		return createTaskLabel(value(NONE_TEXT));
	}
}

export function renderTaskStatus(
	url: string | undefined,
	theme?: TodoistFooterTheme,
	taskName?: string,
): string {
	return renderTaskStatusValue(url, theme, taskName, false);
}

export function renderTaskStatusCompact(
	url: string | undefined,
	theme?: TodoistFooterTheme,
	taskName?: string,
): string {
	return renderTaskStatusValue(url, theme, taskName, true);
}
