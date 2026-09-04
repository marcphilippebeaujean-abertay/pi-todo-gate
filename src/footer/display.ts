import {
	FOOTER_SPINNER_FRAMES,
	FOOTER_SPINNER_INTERVAL_MS,
} from "./constants.ts";
import type { FooterState, FooterUpdate } from "./types.ts";

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

export class FooterDisplay {
	private context: SessionContext | null = null;
	private state: FooterState = { footers: {} };
	private renderedFooterTypes = new Set<string>();
	private animations = new Map<string, Animation>();

	start(context: SessionContext, state: FooterState): void {
		this.clear();
		this.context = context;
		this.state = state;
		for (const event of Object.values(state.footers))
			this.syncEvent(context, event);
	}

	update(state: FooterState, event: FooterUpdate): void {
		this.state = state;
		if (this.context === null) return;
		this.syncEvent(this.context, event);
	}

	clear(): void {
		for (const footerType of this.animations.keys())
			this.stopAnimation(footerType);
		if (this.context === null) return;
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
		if (this.context === null) return;
		try {
			this.context.ui.setStatus(footerType, text);
		} catch {
			// Headless modes may not expose status UI.
		}
	}

	private syncEvent(context: SessionContext, event: FooterUpdate): void {
		this.stopAnimation(event.footerType);
		this.renderedFooterTypes.add(event.footerType);
		const visibleText = event.isVisible ? event.text : undefined;
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
