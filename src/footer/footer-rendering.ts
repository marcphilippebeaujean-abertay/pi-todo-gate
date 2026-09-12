import {
	hyperlink,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import {
	FOOTER_ACCENT_COLOR,
	FOOTER_DIM,
	FOOTER_HTTP_PROTOCOL,
	FOOTER_HTTPS_PROTOCOL,
	FOOTER_MUTED_COLOR,
	FOOTER_NO_PR_LABEL,
	FOOTER_NONE_TEXT,
	FOOTER_OPEN_TASK_LABEL,
	FOOTER_PR_LINK_LABEL,
	FOOTER_PR_SEPARATOR,
	FOOTER_SPINNER_FRAMES,
	FOOTER_SPINNER_INTERVAL_MS,
	FOOTER_TASK_NONE_LABEL,
	FOOTER_TASK_SEPARATOR,
	FOOTER_TEXT_COLOR,
	FOOTER_TODOIST_TASK_LABEL,
} from "./constants.ts";
import type { FooterUpdateEvent } from "./events.ts";
import type {
	FooterAnimation as Animation,
	FooterData,
	FooterEntry,
	FooterFactory,
	FooterRenderState,
	FooterState,
	FooterTheme,
	FooterTui,
	FooterSessionContext as SessionContext,
	TodoistFooterTheme,
} from "./state.ts";

export class Footer implements FooterEntry {
	private value = "";
	isVisible = false;

	constructor(
		public readonly footerType: string,
		private readonly prefix: string,
	) {}

	update(event: FooterUpdateEvent): void {
		const isMatchingFooter = event.footerType === this.footerType;
		if (!isMatchingFooter) return;
		this.value = event.text;
		this.isVisible = event.isVisible;
	}

	render(): string {
		return `${this.prefix}${this.value}`;
	}
}

export function renderFooter(footers: readonly FooterEntry[]): string {
	return `|${footers
		.filter((footer) => footer.isVisible)
		.map((footer) => footer.render())
		.join("|")}`;
}

function loadingText(text: string, frame: string): string {
	for (const spinner of FOOTER_SPINNER_FRAMES) {
		const hasSpinner = text.includes(spinner);
		if (hasSpinner) return text.replace(spinner, frame);
	}
	return text;
}

export class FooterDisplay {
	private context: SessionContext | null = null;
	private state: FooterState = { footers: {} };
	private renderedFooterTypes = new Set<string>();
	private animations = new Map<string, Animation>();
	private readonly footers = new Map<string, Footer>();

	start(context: SessionContext, state: FooterState): void {
		this.clear();
		this.context = context;
		this.state = state;
		for (const event of Object.values(state.footers))
			this.syncEvent(context, event);
	}

	update(state: FooterState, event: FooterUpdateEvent): void {
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
		this.footers.clear();
	}

	deactivate(): void {
		this.clear();
		this.context = null;
		this.state = { footers: {} };
	}

	private footer(footerType: string): Footer {
		const existing = this.footers.get(footerType);
		if (existing !== undefined) return existing;
		const created = new Footer(footerType, "");
		this.footers.set(footerType, created);
		return created;
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

	private syncEvent(context: SessionContext, event: FooterUpdateEvent): void {
		this.stopAnimation(event.footerType);
		this.renderedFooterTypes.add(event.footerType);
		const footer = this.footer(event.footerType);
		footer.update(event);
		const isHidden = !footer.isVisible;
		const visibleText = isHidden ? undefined : footer.render();
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
		const isLoading = current.isLoading;
		const isVisible = current.isVisible;
		switch (true) {
			case !isCurrent:
			case !isLoading:
			case !isVisible:
				this.stopAnimation(animation.event.footerType);
				return;
			default:
				break;
		}
		animation.frameIndex =
			(animation.frameIndex + 1) % FOOTER_SPINNER_FRAMES.length;
		const frame = FOOTER_SPINNER_FRAMES[animation.frameIndex];
		const text = loadingText(this.footer(current.footerType).render(), frame);
		try {
			context.ui.setStatus(current.footerType, text);
		} catch {
			// Headless modes may not expose status UI.
		}
	}
}

function normalizedPrUrl(value: string | undefined): string | null {
	const hasValue = value !== undefined;
	if (!hasValue) return null;
	try {
		const url = new URL(value);
		const isHttps = url.protocol === FOOTER_HTTPS_PROTOCOL;
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

function linkText(text: string, theme?: FooterTheme): string {
	const colored =
		theme?.fg(FOOTER_ACCENT_COLOR, text) ?? `\u001b[34m${text}\u001b[39m`;
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
	theme?: FooterTheme,
): string {
	const normalized = normalizedPrUrl(url);
	const number = prNumber(url);
	const hasNoPr = normalized === null || number === null;
	if (hasNoPr) return FOOTER_NO_PR_LABEL;
	return hyperlink(
		linkText(`PR #${boundedPrNumber(number)}`, theme),
		normalized,
	);
}

export function renderPrStatus(
	url: string | undefined,
	theme?: FooterTheme,
	hasUncommittedChanges?: boolean,
): string {
	const isUncommitted = hasUncommittedChanges ?? false;
	const normalized = normalizedPrUrl(url);
	const number = prNumber(url);
	const muted = (text: string) => theme?.fg(FOOTER_MUTED_COLOR, text) ?? text;
	const value = (text: string) => theme?.fg(FOOTER_TEXT_COLOR, text) ?? text;
	const hasNoPr = normalized === null || number === null;
	if (hasNoPr)
		return `${muted(FOOTER_PR_LINK_LABEL)}${value("none")}${muted(FOOTER_PR_SEPARATOR)}`;
	const dirtyMarker = isUncommitted ? "*" : "";
	return `${muted(FOOTER_PR_LINK_LABEL)}${hyperlink(linkText(`#${boundedPrNumber(number)}${dirtyMarker}`, theme), normalized)}${muted(FOOTER_PR_SEPARATOR)}`;
}

function taskLinkText(text: string, theme?: TodoistFooterTheme): string {
	const colored =
		theme?.fg(FOOTER_ACCENT_COLOR, text) ?? `\u001b[34m${text}\u001b[39m`;
	return `\u001b[4m${colored}\u001b[24m`;
}

function displayTaskName(
	taskName: string | undefined,
	id: string | undefined,
): string {
	const name = taskName?.replace(/\s+/g, " ").trim();
	const hasId = id !== undefined;
	if (name === undefined) return hasId ? `#${id}` : FOOTER_OPEN_TASK_LABEL;
	const hasName = name !== "";
	const exceedsNameLimit = name.length > 15;
	if (hasName) return exceedsNameLimit ? `${name.slice(0, 15)}...` : name;
	return hasId ? `#${id}` : FOOTER_OPEN_TASK_LABEL;
}

export function renderTaskLabel(
	url: string | undefined,
	theme?: TodoistFooterTheme,
	taskName?: string,
): string {
	const hasUrl = Boolean(url);
	if (!hasUrl) return FOOTER_TASK_NONE_LABEL;
	const inputUrl = url ?? "";
	try {
		const parsed = new URL(inputUrl);
		const protocol = parsed.protocol;
		const isSupportedProtocol =
			protocol === FOOTER_HTTP_PROTOCOL || protocol === FOOTER_HTTPS_PROTOCOL;
		if (!isSupportedProtocol) return FOOTER_TASK_NONE_LABEL;
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return `${FOOTER_TODOIST_TASK_LABEL}${hyperlink(taskLinkText(displayTaskName(taskName, id), theme), inputUrl)}`;
	} catch {
		return FOOTER_TASK_NONE_LABEL;
	}
}

function renderTaskStatusValue(
	url: string | undefined,
	theme: TodoistFooterTheme | undefined,
	taskName: string | undefined,
	includeSeparator: boolean,
): string {
	const muted = (text: string) => theme?.fg(FOOTER_MUTED_COLOR, text) ?? text;
	const value = (text: string) => theme?.fg(FOOTER_TEXT_COLOR, text) ?? text;
	const createTaskLabel = (taskValue: string): string => {
		const suffix = includeSeparator ? muted(FOOTER_TASK_SEPARATOR) : "";
		return `${muted(FOOTER_TODOIST_TASK_LABEL)}${taskValue}${suffix}`;
	};
	const hasUrl = Boolean(url);
	if (!hasUrl) return createTaskLabel(value(FOOTER_NONE_TEXT));
	const inputUrl = url ?? "";
	try {
		const parsed = new URL(inputUrl);
		const protocol = parsed.protocol;
		const isSupportedProtocol =
			protocol === FOOTER_HTTP_PROTOCOL || protocol === FOOTER_HTTPS_PROTOCOL;
		if (!isSupportedProtocol) return createTaskLabel(value(FOOTER_NONE_TEXT));
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return createTaskLabel(
			hyperlink(taskLinkText(displayTaskName(taskName, id), theme), inputUrl),
		);
	} catch {
		return createTaskLabel(value(FOOTER_NONE_TEXT));
	}
}

export function renderTaskStatus(
	url: string | undefined,
	theme?: TodoistFooterTheme,
	taskName?: string,
): string {
	return renderTaskStatusValue(url, theme, taskName, true);
}

export function renderTaskStatusCompact(
	url: string | undefined,
	theme?: TodoistFooterTheme,
	taskName?: string,
): string {
	return renderTaskStatusValue(url, theme, taskName, false);
}

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
	const footers = parts.map((text, index) => {
		const footer = new Footer(String(index), "");
		footer.update({
			footerType: String(index),
			isLoading: false,
			text,
			isVisible: true,
		});
		return footer;
	});
	const line = theme.fg(FOOTER_DIM, renderFooter(footers));
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
